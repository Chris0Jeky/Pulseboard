// Round-1 review fixes for PR #118: M1 landing page.view, M2 cross-tab withdrawal, M3 session age,
// L5 no persistence under GPC/DNT, L6 session-bearing flights are journeys, L7 builder version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPulseboard, SDK_VERSION } from '../sdk/pulseboard-sdk.mjs';
import { buildSdk } from '../adapters/build-sdk.mjs';
import { config, makeRuntime, storage, byClass, settle } from './sdk-fakes.mjs';

const CONSENT = 'pulseboard:consent:v3:demo';
const record = (counts, diagnostics, journeys) => JSON.stringify({ counts, diagnostics, journeys, decided: true, month: '2026-09' });
const start = (options = {}) => {
  const h = makeRuntime(options);
  const sdk = createPulseboard(config(), h.runtime);
  sdk.mount();
  return { ...h, sdk };
};
const journeyViews = h => h.products().flatMap(c => c.body.events).filter(e => e.name === 'page.view');

test('M1: the landing page.view reaches Journeys once when Journeys turns on after mount', async () => {
  // The region hint resolves to `other` after mount.
  const other = start({ region: 'other' });
  await settle();
  other.fire();
  await settle();
  assert.equal(journeyViews(other).length, 1);
  assert.equal(journeyViews(other)[0].route, 'home');
  // An EEA visitor clicks OK; toggling Journeys off and on again does not resend it.
  const eea = start({ region: 'eea' });
  await settle();
  eea.sdk.route('puzzle');
  byClass(eea.body, 'pb-ok')[0].emit('click');
  eea.fire();
  await settle();
  eea.sdk.consent.set({ journeys: false });
  eea.sdk.consent.set({ journeys: true });
  eea.fire();
  await settle();
  assert.deepEqual(journeyViews(eea).map(e => e.route), ['puzzle']);
  // Journeys already on at mount: exactly one, not two.
  const on = start({ local: storage({ [CONSENT]: record(true, false, true) }) });
  on.sdk.consent.set({ journeys: true });
  on.fire();
  await settle();
  assert.equal(journeyViews(on).length, 1);
});

test('M2: a choice recorded in another tab is applied here: disabled, cleared, dropped and aborted', async () => {
  const local = storage({ [CONSENT]: record(true, true, true) });
  const a = start({ local });
  const b = start({ local });
  b.runtime.hold = true;
  b.sdk.track('step.done');
  b.fire();
  await settle();
  const inflight = b.posts();
  assert.ok(inflight.length >= 1);
  b.sdk.track('step.done', { n: 2 });
  b.sdk.count('app.ready');
  byClass(a.body, 'pb-pill')[0].emit('click');
  byClass(a.body, 'pb-off')[0].emit('click');
  b.runtime.emit('storage', { key: CONSENT, newValue: local.map.get(CONSENT) });
  const c = b.sdk.consent.get();
  assert.deepEqual([c.counts, c.diagnostics, c.journeys], [false, false, false]);
  assert.ok(inflight.every(call => call.aborted), 'in-flight requests aborted');
  assert.deepEqual(b.sdk.status().queued, { counts: 0, product: 0 });
  assert.equal(b.runtime.sessionStorage.map.has('pulseboard:session:demo'), false);
  assert.equal(local.map.has('pulseboard:visit:demo'), false);
  // Unrelated keys are ignored, and a later opt-in elsewhere applies too.
  b.runtime.emit('storage', { key: 'something:else' });
  local.map.set(CONSENT, record(true, false, false));
  b.runtime.emit('storage', { key: CONSENT });
  assert.equal(b.sdk.consent.get().counts, true);
});

test('M3: a session id rotates after 30 minutes idle or 24 hours in total', async () => {
  let wall = Date.UTC(2026, 8, 26, 9);
  const h = start({ local: storage({ [CONSENT]: record(false, false, true) }) });
  h.runtime.Date = { now: () => wall };
  const ids = [];
  const step = async () => { h.sdk.track('step.done'); h.fire(); await settle(); ids.push(h.products().at(-1).body.session); };
  await step();
  wall += 29 * 60 * 1000; await step();
  assert.equal(ids[1], ids[0], 'within 30 minutes of activity');
  wall += 31 * 60 * 1000; await step();
  assert.notEqual(ids[2], ids[1], 'new id after 30 minutes idle');
  const stored = JSON.parse(h.runtime.sessionStorage.map.get('pulseboard:session:demo'));
  assert.deepEqual(Object.keys(stored).sort(), ['id', 'last', 'seq', 'started']);
  for (let i = 0; i < 24 * 4; i++) { wall += 15 * 60 * 1000; h.sdk.track('tick'); }
  h.fire(); await settle();
  assert.notEqual(h.products().at(-1).body.session, ids[2], 'new id after 24 hours even with steady activity');
  // Every batch carries one session: events are never relabelled with a session they were not tracked in.
  for (const call of h.products()) assert.equal(typeof call.body.session, 'string');
  // A restored tab with an old stored record starts fresh.
  const restored = start({ local: storage({ [CONSENT]: record(false, false, true) }),
    session: storage({ 'pulseboard:session:demo': JSON.stringify({ id: '00000000-0000-4000-8000-00000000abcd', seq: 5, started: 0, last: 0 }) }) });
  restored.sdk.track('step.done'); restored.fire(); await settle();
  assert.notEqual(restored.products()[0].body.session, '00000000-0000-4000-8000-00000000abcd');
});

test('L5: under GPC or DNT a decision is never written and an earlier stored choice survives', async () => {
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const earlier = record(true, true, true);
    const h = start({ nav, local: storage({ [CONSENT]: earlier }) });
    byClass(h.body, 'pb-pill')[0].emit('click');
    byClass(h.body, 'pb-off')[0].emit('click');
    h.sdk.consent.set({ counts: false });
    assert.equal(h.runtime.localStorage.map.get(CONSENT), earlier);
    assert.equal(h.runtime.localStorage.writes.includes(CONSENT), false);
    const fresh = start({ nav });
    byClass(fresh.body, 'pb-pill')[0].emit('click');
    byClass(fresh.body, 'pb-off')[0].emit('click');
    assert.equal(fresh.runtime.localStorage.map.has(CONSENT), false);
  }
});

test('L6: a product request carrying a session id is aborted when Journeys is withdrawn', async () => {
  const h = start({ local: storage({ [CONSENT]: record(false, true, true) }) });
  h.fire();
  await settle();
  const before = h.products().length;
  h.runtime.hold = true;
  h.runtime.emit('error', { message: 'x', filename: 'a.js', lineno: 1 });
  h.fire();
  await settle();
  const flights = h.products().slice(before);
  assert.ok(flights.length >= 1);
  assert.ok(flights.every(c => c.body.session && c.body.events.every(e => e.name === 'js.error')), 'diagnostics only, but session-bearing');
  h.sdk.consent.set({ journeys: false });
  assert.ok(flights.every(c => c.aborted), 'every session-bearing request aborted');
  const diagOnly = start({ local: storage({ [CONSENT]: record(false, true, true) }) });
  diagOnly.runtime.hold = true;
  diagOnly.sdk.consent.set({ journeys: false });
  diagOnly.runtime.emit('error', { message: 'y', filename: 'a.js', lineno: 1 });
  diagOnly.fire();
  await settle();
  const plain = diagOnly.products().filter(c => c.body.session === null);
  assert.ok(plain.length >= 1);
  diagOnly.sdk.consent.set({ counts: true });
  assert.ok(plain.every(c => !c.aborted));
});

test('L7: the artifact header version is the source SDK_VERSION', () => {
  const code = buildSdk('mdviewer');
  assert.match(code, new RegExp('pulseboard-sdk ' + SDK_VERSION.replaceAll('.', '\\.') + ' for mdviewer'));
  const builder = readFileSync(new URL('../adapters/build-sdk.mjs', import.meta.url), 'utf8');
  assert.equal(/const VERSION = '/.test(builder), false, 'no second hard-coded version');
});

test('Codex P2: a timed-out request is unknown, not failed, so three slow responses do not open the circuit', async () => {
  const h = start({ local: storage({ [CONSENT]: record(true, false, false) }) });
  h.runtime.hold = true;
  for (let i = 0; i < 4; i++) {
    h.sdk.count('app.ready');
    h.fire();
    await settle();
    h.fire(10000); // the request timeout aborts the held fetch
    await settle();
  }
  const aborted = h.counts().filter(c => c.aborted);
  assert.ok(aborted.length >= 3);
  assert.equal(h.sdk.status().open.counts, false);
  assert.equal(h.sdk.count('app.ready'), true);
});

test('Codex P2: route() returns true when only the journeys page.view was queued', async () => {
  const h = start({ local: storage({ [CONSENT]: record(false, false, true) }) });
  assert.equal(h.sdk.route('puzzle'), true);
  const none = start({ local: storage({ [CONSENT]: record(false, false, false) }) });
  assert.equal(none.sdk.route('puzzle'), false);
});
