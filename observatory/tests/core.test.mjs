import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { validateEvent, validateBatch, readBounded, interval, monitorTransition, monitorState, STALE_AFTER } from '../src/contracts.mjs';
import { handle, summary, maintain, probeAll } from '../src/worker.mjs';
const event = (extra = {}) => ({ v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq: 1,
  event: 'page.view', route: 'home', release: 'unattributed', ...extra });
function db() { const value = openDatabase(); value.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')); return value; }
const request = (events, extra = {}) => new Request('https://collector.example/v1/collect/mdviewer', { method: 'POST', headers: { Origin: projects.mdviewer.origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ events }) });
const env = DB => ({ DB, COLLECT_ENABLED: 'true', READ_TOKEN: 'a'.repeat(64) });
const withDB = fn => async () => { const database = db(); try { await fn(database); } finally { database.close(); } };
test('closed contract accepts only the documented envelope', () => { assert.equal(validateEvent(event(), projects.mdviewer), true); });
for (const [name, extra] of Object.entries({ 'free text': { message: 'PRIVATE' }, url: { url: 'https://private.test/?token=SECRET' }, identity: { user: 'alice' }, route: { route: '/private/123' }, release: { release: 'email@example.com' }, event: { event: 'arbitrary.secret' }, version: { v: 2 }, uuid: { id: 'not-a-uuid' }, sequence: { seq: 0 }, value: { value: 1 }, infinity: { event: 'duration.ms', value: Infinity }, negative: { event: 'duration.ms', value: -1 } })) {
  test('rejects ' + name, () => assert.equal(validateEvent(event(extra), projects.mdviewer), false));
}
test('timing is bounded and explicitly named', () => { assert.equal(validateEvent(event({ event: 'duration.ms', value: 34.2 }), projects.mdviewer), true); });
test('batches are bounded and reject extra top-level fields', () => {
  assert.equal(validateBatch({ events: [] }, projects.mdviewer), false);
  assert.equal(validateBatch({ events: Array.from({ length: 21 }, () => event()) }, projects.mdviewer), false);
  assert.equal(validateBatch({ events: [event()], token: 'secret' }, projects.mdviewer), false);
});
test('bounded body reader also rejects chunked oversized bodies', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(17000)); c.close(); } });
  await assert.rejects(readBounded(new Request('https://x.test', { method: 'POST', body: stream, duplex: 'half' })));
});
test('reader rejects false content lengths and malformed JSON', async () => {
  await assert.rejects(readBounded(new Request('https://x.test', { method: 'POST', headers: { 'Content-Length': '90000' }, body: '{}' })));
  await assert.rejects(readBounded(new Request('https://x.test', { method: 'POST', body: '{broken' })));
});
test('empty instance is unknown rather than healthy', withDB(async DB => {
  const d = await summary(DB); assert.ok(d.projects.every(p => p.sessions === 0 && p.monitor.state === 'unknown'));
}));
test('collector disabled by default', withDB(async DB => { assert.equal((await handle(request([event()]), { DB })).status, 503); }));
test('valid batches persist and retries deduplicate IDs', withDB(async DB => {
  const e = event(); assert.equal((await handle(request([e]), env(DB))).status, 202);
  assert.equal((await handle(request([e]), env(DB))).status, 202);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 1);
  assert.equal((await DB.prepare('SELECT used FROM budget').first()).used, 2);
}));
test('invalid event poisons the whole batch, with no persistence', withDB(async DB => {
  assert.equal((await handle(request([event(), event({ email: 'x@y.z' })]), env(DB))).status, 400);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
}));
test('origin, media type and method checks', withDB(async DB => {
  assert.equal((await handle(request([event()], { Origin: 'https://other.test' }), env(DB))).status, 403);
  assert.equal((await handle(request([event()], { 'Content-Type': 'text/plain' }), env(DB))).status, 415);
  assert.equal((await handle(new Request('https://x.test/v1/collect/mdviewer', { headers: { Origin: projects.mdviewer.origin } }), env(DB))).status, 405);
}));
test('preflight has exact origin and never grants credentials', withDB(async DB => {
  const r = await handle(new Request('https://x.test/v1/collect/mdviewer', { method: 'OPTIONS', headers: { Origin: projects.mdviewer.origin } }), env(DB));
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), projects.mdviewer.origin); assert.equal(r.headers.get('Access-Control-Allow-Credentials'), null);
}));
test('local-first Taskdeck collection is rejected even with a spoofed origin', withDB(async DB => {
  const r = new Request('https://x.test/v1/collect/taskdeck', { method: 'POST', headers: { Origin: 'https://taskdeck.example' } });
  assert.equal((await handle(r, env(DB))).status, 403);
}));
test('daily reservation and event insertion are atomic at the boundary', withDB(async DB => {
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('mdviewer', new Date().toISOString().slice(0, 10), 999, 'old').run();
  assert.equal((await handle(request([event(), event()]), env(DB))).status, 429);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
  assert.equal((await DB.prepare('SELECT used FROM budget').first()).used, 999);
  assert.equal((await handle(request([event()]), env(DB))).status, 202);
  assert.equal((await handle(request([event()]), env(DB))).status, 429);
}));
test('SQL batch rolls back partial work on failure', withDB(async DB => {
  await assert.rejects(DB.batch([DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('x', 'today', 1, 'y'), DB.prepare('SELECT * FROM nonexistent')]));
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM budget').first()).n, 0);
}));
test('summary requires a sufficiently long bearer secret', withDB(async DB => {
  const req = token => new Request('https://x.test/v1/summary', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal((await handle(req('a'.repeat(64)), env(DB))).status, 200);
  assert.equal((await handle(req('wrong'), env(DB))).status, 401);
  assert.equal((await handle(req('tiny'), { DB, READ_TOKEN: 'tiny' })).status, 401);
}));
test('funnel counts ordered sessions, not ratios of independent event totals', withDB(async DB => {
  const session = crypto.randomUUID();
  await handle(request([event({ session, seq: 1, event: 'action.completed' }), event({ session, seq: 2, event: 'action.requested' })]), env(DB));
  let s = (await summary(DB)).projects.find(p => p.id === 'mdviewer'); assert.equal(s.funnel.started, 1); assert.equal(s.funnel.completed, 0);
  await handle(request([event({ session, seq: 3, event: 'action.completed' })]), env(DB));
  s = (await summary(DB)).projects.find(p => p.id === 'mdviewer'); assert.equal(s.funnel.completed, 1); assert.equal(s.sessions, 1);
}));
test('retention removes old rows and keeps current records', withDB(async DB => {
  await handle(request([event()]), env(DB)); const now = Date.now();
  await DB.prepare('UPDATE events SET received=?').bind(now - 15 * 86400000).run();
  await handle(request([event()]), env(DB)); await maintain(env(DB), now);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 1);
}));
test('monitor debounces failures and recovery', () => {
  let s; s = monitorTransition(s, false, 1); assert.equal(s.state, 'unknown');
  s = monitorTransition(s, false, 2); s = monitorTransition(s, false, 3); assert.equal(s.state, 'down'); assert.equal(s.opened, 3);
  s = monitorTransition(s, true, 4); assert.equal(s.state, 'down');
  s = monitorTransition(s, true, 5); assert.equal(s.state, 'up'); assert.equal(s.opened, null);
});
test('real probe pipeline persists status and bounded content checks', withDB(async DB => {
  const transport = async url => new Response(Object.values(projects).find(p => p.probe?.url === url).probe.marker);
  await probeAll(env(DB), transport, Date.now() - 1000); await probeAll(env(DB), transport, Date.now());
  const s = await summary(DB); assert.equal(s.projects.filter(p => p.monitor.state === 'up').length, 7);
  await probeAll(env(DB), async () => new Response('unexpected content'), Date.now() + 1);
  assert.ok((await DB.prepare('SELECT * FROM probes').all()).results.every(p => p.failures === 1));
}));
test('stale monitoring is not presented as up', withDB(async DB => {
  await DB.prepare('INSERT INTO probes VALUES(?,?,?,?,?,?,?,?)').bind('mdviewer', 'up', 0, 2, null, Date.now() - 3600000, 200, 30).run();
  assert.equal((await summary(DB)).projects[0].monitor.state, 'stale');
}));
// A clock skew or a hand-edited row must not let a reading that has not happened yet stand in for current state.
test('a future-dated reading is stale, up or down', withDB(async DB => {
  const insert = state => DB.prepare('INSERT OR REPLACE INTO probes VALUES(?,?,?,?,?,?,?,?)').bind('mdviewer', state, 0, 2, null, Date.now() + 3600000, 200, 30).run();
  await insert('up'); assert.equal((await summary(DB)).projects[0].monitor.state, 'stale');
  await insert('down'); assert.equal((await summary(DB)).projects[0].monitor.state, 'stale');
  assert.equal(monitorState({ state: 'up', checked: 1000 }, 1000), 'up');
  assert.equal(monitorState({ state: 'up', checked: 1001 }, 1000), 'stale');
  assert.equal(monitorState({ state: 'up', checked: -STALE_AFTER }, 1), 'stale');
  assert.equal(monitorState(null, 1000), 'unknown');
}));
test('Wilson interval has a defined zero-data state', () => { assert.equal(interval(0, 0), null); const [low, high] = interval(5, 10); assert.ok(low < .5 && high > .5); });
test('slow body reads have a deadline', async () => {
  const stream = new ReadableStream({ start() {} });
  await assert.rejects(readBounded(new Request('https://x.test', { method: 'POST', body: stream, duplex: 'half' }), 5), /timeout/);
});
test('readiness fails on an unmigrated database', async () => {
  const DB = openDatabase();
  try { assert.equal((await handle(new Request('https://x.test/readyz'), env(DB))).status, 503); } finally { DB.close(); }
});
test('readiness reports the schema version and fails on a partially migrated database', withDB(async DB => {
  const response = await handle(new Request('https://x.test/readyz'), env(DB));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ready: true, schema: 1 });
  DB.exec('DROP TABLE probe_history');
  assert.equal((await handle(new Request('https://x.test/readyz'), env(DB))).status, 503);
}));
test('readiness fails when a column is missing or the recorded schema version is older', withDB(async DB => {
  DB.exec('ALTER TABLE probes DROP COLUMN duration');
  assert.equal((await handle(new Request('https://x.test/readyz'), env(DB))).status, 503);
  DB.exec('ALTER TABLE probes ADD COLUMN duration REAL NOT NULL DEFAULT 0');
  assert.equal((await handle(new Request('https://x.test/readyz'), env(DB))).status, 200);
  DB.exec('UPDATE schema_version SET version=0');
  assert.equal((await handle(new Request('https://x.test/readyz'), env(DB))).status, 503);
}));
