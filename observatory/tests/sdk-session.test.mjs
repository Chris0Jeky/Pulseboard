import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard } from '../sdk/pulseboard-sdk.mjs';
import { config, makeRuntime, storage, settle } from './sdk-fakes.mjs';

const WINDOW = 10 * 60 * 1000;
const start = (journeys = false, decided = true) => {
  const local = storage(decided ? { 'pulseboard:consent:v3:demo': JSON.stringify({
    counts: true, diagnostics: false, journeys, decided: true, month: '2026-09',
  }) } : {});
  const h = makeRuntime({ local });
  const sdk = createPulseboard(config(), h.runtime);
  sdk.mount();
  return { ...h, sdk };
};

test('success resets consecutive failures independently for both endpoints', async () => {
  const h = start(true);
  for (const status of [403, 202, 403, 202, 403, 202]) {
    h.tick(10000);
    h.runtime.status = status;
    assert.equal(h.sdk.count('app.ready'), true);
    assert.equal(h.sdk.track('step.done'), true);
    h.sdk.flush();
    await settle();
    assert.deepEqual(h.sdk.status().open, { counts: false, product: false });
  }
  assert.equal(h.counts().length, 6);
  assert.equal(h.products().length, 6);
});

test('definitive failures back off future batches without retrying the failed items', async () => {
  const h = start();
  h.sdk.flush();
  await settle();
  for (const delay of [2000, 4000]) {
    h.runtime.status = 503;
    h.sdk.count('thing.done');
    h.sdk.flush();
    await settle();
    const before = h.counts().length;
    assert.equal(h.sdk.count('app.ready'), true);
    assert.equal(h.sdk.flush(), 0);
    h.tick(delay - 1);
    assert.equal(h.sdk.flush(), 0);
    h.tick(1);
    // The second iteration's first flush delivers the batch admitted after this failure.
    if (delay === 2000) continue;
    h.runtime.status = 202;
    assert.equal(h.sdk.flush(), 1);
    await settle();
    assert.equal(h.counts().length, before + 1);
    assert.deepEqual(h.counts().at(-1).body.counts.map(row => row.event), ['app.ready']);
  }
  // A successful batch resets the next failure's delay to 2 seconds.
  h.runtime.status = 503;
  h.sdk.count('thing.done'); h.sdk.flush(); await settle();
  h.sdk.count('app.ready');
  h.tick(2000);
  assert.equal(h.sdk.flush(), 1);
});

test('request allowance expires individually at ten minutes, across both endpoints', async () => {
  const h = start(true);
  h.sdk.flush(); await settle();
  for (let i = 0; i < 58; i++) { h.sdk.count('app.ready'); h.sdk.flush(); await settle(); }
  h.tick(WINDOW / 2);
  for (let i = 0; i < 60; i++) { h.sdk.track('step.done'); h.sdk.flush(); await settle(); }
  assert.equal(h.sdk.status().requests, 120);
  assert.equal(h.sdk.count('app.ready'), false);
  assert.equal(h.sdk.track('step.done'), false);
  h.tick(WINDOW / 2 - 1);
  assert.equal(h.sdk.count('app.ready'), false);
  h.tick(1);
  for (let i = 0; i < 60; i++) { assert.equal(h.sdk.count('app.ready'), true); h.sdk.flush(); await settle(); }
  assert.equal(h.sdk.status().requests, 180, 'lifetime diagnostics stay cumulative');
  assert.equal(h.sdk.count('app.ready'), false, 'the second half of the original window still counts');
  h.tick(WINDOW / 2);
  assert.equal(h.sdk.track('step.done'), true);
  assert.equal(h.sdk.flush(), 1);
});

test('a long mounted session keeps delivering within the rolling request allowance', async () => {
  const h = start();
  h.sdk.flush(); await settle();
  for (let i = 0; i < 360; i++) {
    h.tick(5000);
    assert.equal(h.sdk.count('app.ready'), true, `batch ${i}`);
    assert.equal(h.sdk.flush(), 1);
    await settle();
  }
  assert.equal(h.counts().length, 361);
  assert.equal(h.sdk.status().dropped, 0);
});

test('the region hint spends the same rolling allowance as collection requests', async () => {
  const h = start(false, false);
  await settle();
  h.sdk.flush(); await settle();
  for (let i = 0; i < 118; i++) { h.sdk.count('app.ready'); h.sdk.flush(); await settle(); }
  assert.equal(h.calls.length, 120);
  assert.equal(h.sdk.count('app.ready'), false);
  h.tick(WINDOW);
  assert.equal(h.sdk.count('app.ready'), true);
  assert.equal(h.sdk.flush(), 1);
  assert.equal(h.calls.length, 121);
});

test('expired request timestamps cannot allow more than 120 unresolved requests', async () => {
  const h = start();
  h.runtime.hold = true;
  h.sdk.flush();
  for (let i = 0; i < 119; i++) { h.sdk.count('app.ready'); h.sdk.flush(); }
  assert.equal(h.counts().length, 120);
  h.tick(WINDOW);
  assert.equal(h.sdk.count('app.ready'), false);
  h.counts()[0].release({ ok: true }); await settle();
  assert.equal(h.sdk.count('app.ready'), true);
  assert.equal(h.sdk.flush(), 1);
  assert.equal(h.counts().length, 121);
});
