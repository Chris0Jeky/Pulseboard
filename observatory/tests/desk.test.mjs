import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { handle } from '../src/worker.mjs';
import { makeDemo } from '../public/desk-demo.mjs';
import { DAY, buildSignals, compareReleases, fraction, wilson, monitorState, reviewState, makeBrief, makeHandoff } from '../public/desk-model.mjs';
const now = Date.UTC(2026, 8, 10, 12);
const config = { p: { label: 'Project', origin: 'https://example.test', probe: {}, dailyLimit: 1000 } };
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close()); return db;
}
let seq = 0;
async function event(db, options = {}) {
  const e = { project: 'p', id: `e-${++seq}`, received: now - 1000, session: 'private-session', seq: 1,
    event: 'page.view', route: 'home', release: 'v1', value: null, ...options };
  await db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(e.project, e.id, e.received, e.session, e.seq, e.event, e.route, e.release, e.value).run();
}
const read = db => readPortfolio(db, { now, projects: config });

test('empty stores distinguish unknown monitors, no samples and disabled collection', async t => {
  const s = await read(database(t));
  assert.equal(s.collectionEnabled, false); assert.equal(s.projects[0].probeSamples.value, null);
  assert.equal(s.projects[0].flow.value, null); assert.equal(s.projects[0].totals.last, null);
  assert.equal(monitorState(s.projects[0], now), 'unknown');
});
test('time range is start inclusive and end exclusive, including future exclusion', async t => {
  const db = database(t);
  for (const received of [now - 7 * DAY - 1, now - 7 * DAY, now - 1, now, now + 1000]) await event(db, { received });
  assert.equal((await read(db)).projects[0].totals.events, 2);
});
test('route/release boundaries prevent unrelated completions from satisfying a flow', async t => {
  const db = database(t);
  await event(db, { event: 'action.requested', seq: 3 });
  for (const attrs of [{ route: 'elsewhere' }, { release: 'v2' }, { session: 'another' }, { seq: 2 }]) {
    await event(db, { event: 'action.completed', seq: 4, ...attrs });
  }
  assert.deepEqual((await read(db)).projects[0].flow, fraction(0, 1));
  await event(db, { event: 'action.completed', seq: 4 });
  assert.deepEqual((await read(db)).projects[0].flow, fraction(1, 1));
});
test('a session contributes one started flow per route/release, not one per click', async t => {
  const db = database(t);
  for (const seq of [1, 2, 3]) await event(db, { event: 'action.requested', seq });
  await event(db, { event: 'action.completed', seq: 4 });
  assert.equal((await read(db)).projects[0].flow.denominator, 1);
});
test('out-of-window completion cannot satisfy an in-window start', async t => {
  const db = database(t);
  await event(db, { event: 'action.requested' });
  await event(db, { event: 'action.completed', seq: 2, received: now + 1 });
  assert.equal((await read(db)).projects[0].flow.numerator, 0);
});
test('p95 uses the nearest rank within each release; it never averages quantiles', async t => {
  const db = database(t);
  for (let value = 1; value <= 100; value++) await event(db, { event: 'duration.ms', value });
  await event(db, { event: 'duration.ms', release: 'v2', value: 5000 });
  const releases = (await read(db)).projects[0].releases;
  assert.equal(releases.find(r => r.release === 'v1').duration.p95, 95);
  assert.equal(releases.find(r => r.release === 'v1').duration.mean, 50.5);
  assert.equal(releases.find(r => r.release === 'v2').duration.p95, 5000);
});
test('probe samples and budget preserve numerator, denominator and UTC day', async t => {
  const db = database(t);
  for (const [checked, ok] of [[now - 1, 1], [now - 2, 0], [now + 1, 0]]) await db.prepare('INSERT INTO probe_history VALUES(?,?,?,?)').bind('p', checked, ok, 1).run();
  await db.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('p', '2026-09-10', 912, 'receipt').run();
  const p = (await read(db)).projects[0];
  assert.equal(p.probeSamples.value, 0.5); assert.equal(p.probeSamples.denominator, 2);
  assert.equal(p.budget.used, 912); assert.equal(p.budget.day, '2026-09-10');
});
test('snapshot never serializes session IDs, event IDs or receipt strings', async t => {
  const db = database(t); await event(db, { id: 'do-not-export-this-event', session: 'do-not-export-this-session' });
  const text = JSON.stringify(await read(db)); assert.ok(!text.includes('do-not-export'));
});
test('read model rejects unbounded or invalid windows', async t => {
  const db = database(t);
  for (const days of [0, 2, 15, 365, NaN, '7']) await assert.rejects(() => readPortfolio(db, { now, days }));
});
test('configured local projects do not become missing external monitors', () => {
  const s = makeDemo('release', { now });
  assert.equal(monitorState(s.projects.find(p => p.id === 'taskdeck'), now), 'local');
  assert.ok(!buildSignals(s, now).some(s => s.project === 'taskdeck'));
});
test('stale and future probe timestamps never become healthy', () => {
  const p = makeDemo('release', { now }).projects[1];
  for (const checked of [now - 31 * 60000, now + 1]) { p.monitor.checked = checked; assert.equal(monitorState(p, now), 'stale'); }
});
test('zero and invalid Wilson samples abstain', () => {
  for (const args of [[0, 0], [2, 1], [-1, 1], [1.5, 2], [NaN, 3]]) assert.equal(wilson(...args), null);
  assert.equal(fraction(0, 0).value, null);
});
test('Wilson interval bounds a valid proportion', () => {
  const [lo, hi] = wilson(50, 100); assert.ok(lo < 0.5 && hi > 0.5); assert.ok(Math.abs(lo - 0.4038) < 0.001);
});
test('release comparisons abstain below sample floor and on unattributed/equal labels', () => {
  const a = { release: 'v1', completed: 19, failed: 0 };
  const b = { release: 'v2', completed: 90, failed: 10 };
  assert.equal(compareReleases(a, b).supported, false); assert.equal(compareReleases(a, b).delta, null);
  assert.equal(compareReleases(a, a).supported, false);
  assert.equal(compareReleases({ ...a, release: 'unattributed' }, b).supported, false);
});
test('release comparison preserves event denominators and percentage-point difference', () => {
  const result = compareReleases({ release: 'v1', completed: 90, failed: 10 }, { release: 'v2', completed: 70, failed: 30 });
  assert.equal(result.baseline.denominator, 100); assert.ok(Math.abs(result.delta - 0.2) < 1e-10);
});
test('demo scenarios are deterministic and total daily counts exactly reconcile', () => {
  for (const name of ['release', 'quiet', 'blind', 'pressure']) {
    const s = makeDemo(name, { now }); assert.deepEqual(s, makeDemo(name, { now }));
    for (const p of s.projects) assert.equal(p.daily.reduce((n, d) => n + d.n, 0), p.totals.events);
  }
});
test('replay changes the invented incident without touching the clock or a database', () => {
  const before = buildSignals(makeDemo('release', { now, phase: 0 }), now);
  const after = buildSignals(makeDemo('release', { now, phase: 1 }), now);
  assert.ok(!before.some(s => s.rule === 'monitor.down')); assert.ok(after.some(s => s.rule === 'monitor.down'));
});
test('signal order is deterministic with critical evidence first', () => {
  const s = makeDemo('release', { now }); const signals = buildSignals(s, now);
  assert.equal(signals[0].severity, 'critical'); assert.deepEqual(signals, buildSignals(s, now));
});
test('acknowledgements are scoped by evidence fingerprint and demo/live mode', () => {
  const s = makeDemo('release', { now }); const signal = buildSignals(s, now)[0];
  const reviews = { [signal.key]: { state: 'acknowledged', until: now + 1000 } };
  assert.equal(reviewState(signal, reviews, now), 'acknowledged');
  assert.equal(reviewState(signal, reviews, now + 1001), 'open');
  s.mode = 'live'; assert.equal(reviewState(buildSignals(s, now)[0], reviews, now), 'open');
});
test('brief and handoff retain synthetic markings and review-only boundaries', () => {
  const s = makeDemo('release', { now }), signals = buildSignals(s, now);
  assert.match(makeBrief(s, signals), /SYNTHETIC DEMO/);
  const packet = makeHandoff(s, signals[0]); assert.equal(packet.mode, 'demo');
  assert.ok(packet.boundaries.includes('No automatic task creation or execution.'));
});
test('portfolio endpoint authenticates before querying', async () => {
  const r = await handle(new Request('https://desk.test/v1/portfolio'), { READ_TOKEN: 'x'.repeat(32) });
  assert.equal(r.status, 401); assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('portfolio endpoint rejects wrong/short credentials and POST', async () => {
  const req = token => new Request('https://desk.test/v1/portfolio', { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await handle(req('wrong'), { READ_TOKEN: 'x'.repeat(32) })).status, 401);
  assert.equal((await handle(req('short'), { READ_TOKEN: 'short' })).status, 401);
  assert.equal((await handle(new Request('https://desk.test/v1/portfolio', { method: 'POST' }), {})).status, 404);
});
test('authorized portfolio request works with real SQLite, while invalid windows fail closed', async t => {
  const env = { DB: database(t), READ_TOKEN: 'x'.repeat(32), COLLECT_ENABLED: 'false' };
  const request = query => new Request(`https://desk.test/v1/portfolio${query}`, { headers: { authorization: `Bearer ${env.READ_TOKEN}` } });
  const r = await handle(request('?days=7'), env); assert.equal(r.status, 200);
  assert.equal((await r.json()).collectionEnabled, false);
  for (const query of ['?days=365', '?days=7&days=14', '?days=07', '?days=NaN']) assert.equal((await handle(request(query), env)).status, 400);
});
test('new static assets carry CSP; traversal is not routed to the asset binding', async () => {
  let calls = 0;
  const env = { ASSETS: { fetch: async () => { calls++; return new Response('asset'); } } };
  const r = await handle(new Request('https://desk.test/desk-model.mjs'), env);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.ok(!r.headers.get('content-security-policy').includes('unsafe-inline'));
  assert.equal((await handle(new Request('https://desk.test/secret.env'), env)).status, 404); assert.equal(calls, 1);
  assert.equal(await (await handle(new Request('https://desk.test/', { method: 'HEAD' }), env)).text(), '');
});
