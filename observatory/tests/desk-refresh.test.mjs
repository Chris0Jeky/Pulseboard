import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from '../public/desk-demo.mjs';
import { buildSignals, monitorDisplay } from '../public/desk-model.mjs';
import { assets } from '../src/assets.mjs';
import { readFileSync } from 'node:fs';

const now = Date.UTC(2026, 8, 17, 12);

test('failed refresh signals identify last-good evidence and missing current readings', () => {
  const snapshot = makeDemo('release', { now, phase: 1 });
  snapshot.mode = 'live';
  const signals = buildSignals(snapshot, now, true);
  const refresh = signals.find(signal => signal.rule === 'snapshot.refresh_failed');
  assert.ok(refresh, 'a failed refresh must create a portfolio warning');
  assert.match(refresh.detail, /current readings are unknown/i);
  const down = signals.find(signal => signal.rule === 'monitor.down');
  assert.ok(down, 'the fixture must retain its last-known failure');
  assert.match(`${down.title} ${down.detail}`, /last[- ]known/i);
  assert.equal(down.evidence.lastKnown, true);

  const fresh = buildSignals(snapshot, now, false);
  assert.equal(fresh.some(signal => signal.rule === 'snapshot.refresh_failed'), false);
  assert.equal(Object.hasOwn(fresh.find(signal => signal.rule === 'monitor.down').evidence, 'lastKnown'), false);
});

test('prolonged failed refresh retains an old recorded failure and also reports its stale age', () => {
  const snapshot = makeDemo('release', { now, phase: 1 });
  snapshot.mode = 'live';
  const project = snapshot.projects.find(item => item.monitor.state === 'down');
  // Cross STALE_AFTER deliberately: raw failure evidence and reading age must remain separate facts.
  project.monitor.checked = now - 31 * 60_000;

  const failedRefresh = buildSignals(snapshot, now, true);
  const down = failedRefresh.find(signal => signal.project === project.id && signal.rule === 'monitor.down');
  const stale = failedRefresh.find(signal => signal.project === project.id && signal.rule === 'monitor.stale');
  assert.ok(down, 'raw down evidence must survive after its timestamp becomes stale');
  assert.ok(stale, 'the same reading must still be qualified as old');
  assert.equal(down.evidence.state, 'down');
  assert.equal(down.evidence.freshness, 'stale');
  assert.equal(down.evidence.lastKnown, true);
  assert.deepEqual(monitorDisplay(project, now, true), { state: 'down', freshness: 'stale', lastKnown: true });

  const freshRead = buildSignals(snapshot, now, false);
  assert.equal(freshRead.some(signal => signal.project === project.id && signal.rule === 'monitor.down'), false);
  assert.ok(freshRead.some(signal => signal.project === project.id && signal.rule === 'monitor.stale'));
  assert.deepEqual(monitorDisplay(project, now, false), { state: 'stale', freshness: 'stale', lastKnown: false });
});

test('overview attention count uses the same refresh-aware signal set as the inbox', () => {
  const source = readFileSync(new URL('../public/dashboard.mjs', import.meta.url), 'utf8');
  assert.match(source, /stat\('Needs a look', count\(signalSet\(\)\.filter/);
  assert.doesNotMatch(source, /stat\('Needs a look', count\(buildSignals\(s\)\.filter/);
});

test('authenticated portfolio requests pin privacy, redirect and timeout policy', async () => {
  const network = await import('../public/desk-network.mjs').catch(() => ({}));
  assert.equal(typeof network.requestPortfolio, 'function', 'requestPortfolio helper must exist');
  assert.equal(network.READ_TIMEOUT_MS, 10_000);
  const controller = new AbortController();
  const expected = new Response('{}', { status: 200 });
  let call;
  const result = await network.requestPortfolio(async (url, init) => {
    call = { url, init };
    return expected;
  }, { token: 't'.repeat(32), days: 14, signal: controller.signal });
  assert.equal(result, expected);
  assert.equal(call.url, '/v1/portfolio?days=14');
  assert.deepEqual(call.init.headers, { authorization: `Bearer ${'t'.repeat(32)}` });
  assert.equal(call.init.cache, 'no-store');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.signal, controller.signal);
  assert.equal(assets.has('/desk-network.mjs'), true, 'the helper must be served by both runtimes');
});
