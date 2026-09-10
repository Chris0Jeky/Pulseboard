// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { validBatch, sourcesFrom, boundedBody, DAY } from '../watch/contracts.mjs';
import { handleWatch, withWatch } from '../watch/api.mjs';
import { ingest, snapshot, maintain, ready, coverage } from '../watch/store.mjs';
const NOW = Date.parse('2026-09-10T12:00:00Z');
const TOKEN = 'a'.repeat(40), READ = 'r'.repeat(40);
const source = () => ({ id: 'alibi-app', project: 'alibi', environment: 'preview', kind: 'app', token: TOKEN,
  assets: ['login', 'puzzle', 'unknown'], allowedKinds: ['http.request', 'http.error', 'auth.failure', 'waf.block',
    'access.denied', 'rate_limited', 'exposure.unexpected', 'check.ok', 'check.error', 'scan.finding', 'host.unexpected', 'egress.unexpected'],
  heartbeatSeconds: 60, dailyLimit: 1000, enabled: true });
const event = (overrides = {}) => ({ id: crypto.randomUUID(), at: NOW - 1000, kind: 'http.request',
  asset: 'puzzle', method: 'GET', status: 200, ...overrides });
const simple = (kind, asset = 'login') => ({ id: crypto.randomUUID(), at: NOW - 1000, kind, asset });
const beat = (overrides = {}) => ({ id: crypto.randomUUID(), at: NOW - 1000, kind: 'sensor.heartbeat', sampling: 'full', dropped: 0, ...overrides });
const batch = (...events) => ({ schema: 'pulseboard.security-events/1', events });
function setup(t, overrides = {}) {
  const DB = openDatabase(); DB.exec(readFileSync(new URL('../watch/schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return { DB, WATCH_ENABLED: 'true', WATCH_READ_TOKEN: READ, WATCH_SOURCES_JSON: JSON.stringify([source()]), ...overrides };
}
const request = (body, token = TOKEN, extra = {}) => new Request('https://watch.example/v1/watch/events/alibi-app', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra }, body: JSON.stringify(body) });
const get = (path = '/snapshot', token = READ) => new Request(`https://watch.example/v1/watch${path}`, { headers: { Authorization: `Bearer ${token}` } });

test('source registry is closed, scoped and never silently accepts bad configuration', async t => {
  for (const patch of [{ project: 'https://leak.example' }, { extra: true }, { token: 'tiny' }, { assets: ['x', 'x'] },
    { heartbeatSeconds: 0 }, { dailyLimit: 20001 }, { kind: 'browser' }, { allowedKinds: ['made.up'] }, { enabled: 'true' }]) {
    await t.test(JSON.stringify(patch), () => assert.throws(() => sourcesFrom({ WATCH_SOURCES_JSON: JSON.stringify([{ ...source(), ...patch }]) })));
  }
  assert.throws(() => sourcesFrom({ WATCH_SOURCES_JSON: JSON.stringify([source(), source()]) }));
  assert.throws(() => sourcesFrom({ WATCH_SOURCES_JSON: JSON.stringify([source()]), WATCH_READ_TOKEN: TOKEN }));
  assert.deepEqual(sourcesFrom({}), []);
});
test('closed event contract rejects private, raw and out-of-scope fields', async t => {
  for (const patch of [{ body: 'secret' }, { ip: '1.2.3.4' }, { url: '/puzzle?token=x' }, { headers: {} },
    { message: '<script>bad()</script>' }, { project: 'other' }, { asset: 'unregistered' }, { status: '200' },
    { status: 600 }, { at: NOW - DAY - 1 }, { at: NOW + 30001 }, { durationMs: Infinity }, { id: 'not-uuid' },
    { kind: 'auth.failure' }, { method: 'CONNECT' }]) {
    await t.test(JSON.stringify(patch), () => assert.equal(validBatch(batch(event(patch)), source(), NOW), false));
  }
  assert.equal(validBatch(batch(event()), source(), NOW), true);
  assert.equal(validBatch(batch(beat()), source(), NOW), true);
  assert.equal(validBatch(batch(beat({ status: 200 })), source(), NOW), false);
  assert.equal(validBatch({ ...batch(event()), mode: 'synthetic' }, source(), NOW), false);
  assert.equal(validBatch(batch(...Array.from({ length: 26 }, () => event())), source(), NOW), false);
  const e = event(); assert.equal(validBatch(batch(e, e), source(), NOW), false);
});
test('read and ingest credentials are separate; authentication precedes all DB reads', async () => {
  const env = { DB: { prepare() { throw new Error('must not read'); } }, WATCH_READ_TOKEN: READ,
    WATCH_ENABLED: 'true', WATCH_SOURCES_JSON: JSON.stringify([source()]) };
  for (const token of ['', 'wrong', TOKEN]) assert.equal((await handleWatch(get('/snapshot', token), env, NOW)).status, 401);
  assert.equal((await handleWatch(request(batch(event()), READ), env, NOW)).status, 401);
});
test('admission, duplicate IDs, strict receipts and minimised snapshots use real SQLite', async t => {
  const env = setup(t), e = event();
  let r = await handleWatch(request(batch(e, beat())), env, NOW); assert.equal(r.status, 202);
  assert.equal((await r.json()).inserted, 2);
  r = await handleWatch(request(batch(e)), env, NOW + 1); assert.equal((await r.json()).inserted, 0);
  const s = await (await handleWatch(get(), env, NOW + 2)).json();
  assert.equal(s.sources[0].coverage, 'reporting'); assert.equal(s.events.length, 2);
  assert.equal(s.sources[0].budgetUsed, 3); assert.equal(s.aggregates.find(x => x.kind === 'http.request').n, 1);
  for (const forbidden of [TOKEN, READ, 'authorization', 'WATCH_SOURCES_JSON']) assert.equal(JSON.stringify(s).includes(forbidden), false);
});
test('same event ID cannot replace evidence or freshen a heartbeat', async t => {
  const env = setup(t), b = beat();
  await ingest(env.DB, source(), [b], NOW);
  await ingest(env.DB, source(), [{ ...b, at: NOW + 10000 }], NOW + 10000);
  await ingest(env.DB, source(), [b], NOW + 20000);
  const s = await snapshot(env.DB, [source()], true, NOW + 190000);
  assert.equal(s.sources[0].sensor.observed, b.at); assert.equal(s.sources[0].sensor.received, NOW);
  assert.equal(s.sources[0].coverage, 'stale');
});
test('daily budget is transactional, including the first oversized batch and concurrent reservations', async t => {
  const env = setup(t); const s = { ...source(), dailyLimit: 2 }; env.WATCH_SOURCES_JSON = JSON.stringify([s]);
  assert.equal((await handleWatch(request(batch(event(), event(), event())), env, NOW)).status, 429);
  assert.equal((await snapshot(env.DB, [s], true, NOW + 1)).events.length, 0);
  const results = await Promise.all([handleWatch(request(batch(event(), event())), env, NOW), handleWatch(request(batch(event())), env, NOW)]);
  assert.deepEqual(results.map(r => r.status).sort(), [202, 429]);
  assert.equal((await snapshot(env.DB, [s], true, NOW + 1)).events.length, 2);
});
test('credential scope cannot select another source, route or event category', async t => {
  const env = setup(t), other = { ...source(), id: 'other-app', token: 'b'.repeat(40), allowedKinds: ['http.request'] };
  env.WATCH_SOURCES_JSON = JSON.stringify([source(), other]);
  const wrong = new Request('https://watch.example/v1/watch/events/other-app', request(batch(event())));
  assert.equal((await handleWatch(wrong, env, NOW)).status, 401);
  assert.equal(validBatch(batch(simple('auth.failure')), other, NOW), false);
});
test('disabled ingestion, Origin, methods, media types and query errors are explicit', async t => {
  const env = setup(t, { WATCH_ENABLED: 'false' });
  assert.equal((await handleWatch(request(batch(event())), env, NOW)).status, 503);
  const s = await (await handleWatch(get(), env, NOW)).json(); assert.equal(s.sources[0].coverage, 'disabled');
  env.WATCH_ENABLED = 'true';
  assert.equal((await handleWatch(request(batch(event()), TOKEN, { Origin: 'https://alibi.example' }), env, NOW)).status, 403);
  assert.equal((await handleWatch(request(batch(event()), TOKEN, { 'Content-Type': 'text/plain' }), env, NOW)).status, 415);
  assert.equal((await handleWatch(get('/snapshot?source=x'), env, NOW)).status, 400);
  assert.equal((await handleWatch(new Request('https://watch.example/v1/watch/snapshot', { method: 'POST', headers: { Authorization: `Bearer ${READ}` } }), env, NOW)).status, 405);
});
test('bounded streamed bodies reject dishonest lengths, oversize, invalid UTF-8 and hanging streams', async () => {
  await assert.rejects(() => boundedBody(new Request('https://x.test', { method: 'POST', body: 'x'.repeat(17000) })));
  await assert.rejects(() => boundedBody(new Request('https://x.test', { method: 'POST', headers: { 'content-length': '1' }, body: 'x'.repeat(17000) })));
  await assert.rejects(() => boundedBody(new Request('https://x.test', { method: 'POST', body: new Uint8Array([255, 254]) })));
  const stream = new ReadableStream({ start() {}, cancel() {} });
  await assert.rejects(() => boundedBody(new Request('https://x.test', { method: 'POST', body: stream, duplex: 'half' }), 10));
});
test('missing, stale, partial, disabled and future sensor states never become reporting', () => {
  const s = source(), sensor = { observed: NOW - 100, received: NOW, sampling: 'full', dropped: 0 };
  assert.equal(coverage(s, null, NOW), 'missing');
  assert.equal(coverage(s, { ...sensor, observed: NOW - 180001 }, NOW), 'stale');
  assert.equal(coverage(s, { ...sensor, dropped: 1 }, NOW), 'partial');
  assert.equal(coverage(s, { ...sensor, sampling: 'unknown' }, NOW), 'partial');
  assert.equal(coverage(s, { ...sensor, observed: NOW + 1 }, NOW), 'clock-skew');
  assert.equal(coverage({ ...s, enabled: false }, sensor, NOW), 'disabled');
});
test('threshold rules preserve source, route, count and window; old events do not trigger burst rules', async t => {
  const env = setup(t), s = source();
  const events = Array.from({ length: 10 }, () => simple('auth.failure'));
  await ingest(env.DB, s, [...events, beat()], NOW);
  let view = await snapshot(env.DB, [s], true, NOW + 1);
  let finding = view.findings.find(f => f.rule === 'auth.failure');
  assert.equal(finding.count, 10); assert.equal(finding.windowSeconds, 300); assert.equal(finding.state, 'observation');
  view = await snapshot(env.DB, [s], true, NOW + 301000);
  assert.equal(view.findings.some(f => f.rule === 'auth.failure'), false);
});
test('HTTP failure fraction uses the same source and asset denominator, not all telemetry events', async t => {
  const env = setup(t), s = source();
  await ingest(env.DB, s, Array.from({ length: 20 }, (_, i) => event({ status: i < 5 ? 500 : 200 })), NOW);
  await ingest(env.DB, s, Array.from({ length: 20 }, () => simple('auth.failure')), NOW);
  const view = await snapshot(env.DB, [s], true, NOW + 1), f = view.findings.find(x => x.rule === 'http.errors');
  assert.equal(f.count, 5); assert.equal(f.denominator, 20);
});
test('scan/check observations stay observations and retain a one-day window', async t => {
  const env = setup(t), s = source();
  await ingest(env.DB, s, [{ ...simple('exposure.unexpected'), status: 200, at: NOW - 3600000 }], NOW);
  const f = (await snapshot(env.DB, [s], true, NOW + 1)).findings.find(x => x.rule === 'exposure.unexpected');
  assert.equal(f.windowSeconds, 86400); assert.match(f.next, /SPA/); assert.equal(f.state, 'observation');
});
test('ledger is bounded and the UTC read window excludes future events', async t => {
  const env = setup(t), s = source();
  for (let i = 0; i < 9; i++) await ingest(env.DB, s, Array.from({ length: 25 }, () => event()), NOW);
  await ingest(env.DB, s, [event({ at: NOW + 1000 })], NOW);
  const view = await snapshot(env.DB, [s], true, NOW);
  assert.equal(view.events.length, 200); assert.equal(view.aggregates[0].n, 225);
});
test('retention deletes receipts, budgets and heartbeats even when ingestion is disabled', async t => {
  const env = setup(t), s = source(); await ingest(env.DB, s, [event(), beat()], NOW);
  await maintain(env.DB, NOW + 8 * DAY);
  for (const table of ['watch_events', 'watch_budget', 'watch_sensors']) assert.equal((await env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0);
});
test('schema readiness fails closed and the wrapper preserves unrelated routes and scheduling', async t => {
  const env = setup(t); let calls = 0;
  const base = { fetch: async () => new Response('legacy'), scheduled: async () => { calls++; } };
  const wrapper = withWatch(base);
  assert.equal(await (await wrapper.fetch(new Request('https://x.test/healthz'), env)).text(), 'legacy');
  await wrapper.scheduled({}, env, {}); assert.equal(calls, 1);
  env.DB.exec('DROP TABLE watch_sensors');
  assert.equal((await handleWatch(get('/readyz'), env, NOW)).status, 503);
  await assert.rejects(() => ready(env.DB));
  await wrapper.scheduled({}, env, {}); assert.equal(calls, 2);
});
test('security responses are private and do not opt into CORS', async t => {
  const r = await handleWatch(get(), setup(t), NOW);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('Watch staging preserves the authorized probe schedule and same-account service bindings', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.vars.COLLECT_ENABLED, 'false');
  assert.equal(config.vars.WATCH_ENABLED, 'false');
  assert.deepEqual(config.triggers.crons, ['*/15 * * * *']);
  assert.deepEqual(config.services.map(s => s.binding).sort(), ['ALIBI', 'COMMITATLAS']);
  assert.equal(config.main, 'src/entry.mjs');
  assert.deepEqual(config.env.preview.triggers.crons, []);
  assert.notEqual(config.d1_databases[0].database_id, config.env.preview.d1_databases[0].database_id);
});
