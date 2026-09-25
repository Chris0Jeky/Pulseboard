import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle, maintain } from '../src/worker.mjs';
import { validateStatBatch, statAdmission } from '../src/stat-contract.mjs';

const ALIBI_ORIGIN = projects.alibi.origin;
const day = () => new Date(Date.now()).toISOString().slice(0, 10);

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}

const statEnv = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi' });
const statRequest = (body, extra = {}) => new Request('https://collector.example/v1/collect-stat/alibi', {
  method: 'POST',
  headers: { Origin: ALIBI_ORIGIN, 'Content-Type': 'application/json', ...extra },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const count = (event = 'puzzle.started', route = 'puzzle', release = '0.11.6', n = 1) => ({ event, route, release, n });
const validBody = () => ({ v: 1, counts: [count(), count('puzzle.completed', 'puzzle', '0.11.6')] });

test('valid aggregation writes statistics with zero raw events', async t => {
  const DB = database(t);
  const response = await handle(statRequest(validBody()), statEnv(DB));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, meaning: 'stat batch admitted; repeated requests count repeatedly' });
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
  const rows = (await DB.prepare('SELECT project,day,event,route,release,n FROM statistics ORDER BY event').all()).results;
  assert.deepEqual(rows.map(row => ({ ...row })), [
    { project: 'alibi', day: day(), event: 'puzzle.completed', route: 'puzzle', release: '0.11.6', n: 1 },
    { project: 'alibi', day: day(), event: 'puzzle.started', route: 'puzzle', release: '0.11.6', n: 1 },
  ]);
  assert.equal((await DB.prepare('SELECT used FROM budget').first()).used, 2);
  assert.ok((await DB.prepare('SELECT received FROM statistics').first()).received > 0);
});

test('repeated requests count repeatedly: no deduplication without identifiers', async t => {
  // At-most-once client delivery: the aggregate contract carries no identifiers,
  // so the collector cannot deduplicate; each admitted POST adds its counts again.
  const DB = database(t);
  const body = { v: 1, counts: [count()] };
  assert.equal((await handle(statRequest(body), statEnv(DB))).status, 202);
  assert.equal((await handle(statRequest(body), statEnv(DB))).status, 202);
  assert.equal((await DB.prepare('SELECT n FROM statistics').first()).n, 2);
  assert.equal((await DB.prepare('SELECT used FROM budget').first()).used, 2);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
});

test('forbidden identifiers and unknown fields fail the whole batch', async t => {
  const DB = database(t);
  const badBodies = [
    { v: 1, counts: [{ ...count(), id: crypto.randomUUID() }] },
    { v: 1, counts: [{ ...count(), session: crypto.randomUUID() }] },
    { v: 1, counts: [{ ...count(), puzzleId: 'p1' }] },
    { v: 1, counts: [{ ...count(), puzzle: 'p1' }] },
    { v: 1, counts: [{ ...count(), text: 'hello' }] },
    { v: 1, counts: [{ ...count(), url: 'https://example.test/' }] },
    { v: 1, counts: [{ ...count(), ip: '127.0.0.1' }] },
    { v: 1, counts: [{ ...count(), value: 1 }] },
    { v: 1, counts: [{ event: 'puzzle.started', route: 'puzzle', release: '0.11.6' }] },
    { v: 1, counts: [count()], token: 'secret' },
    { v: 1, counts: [count()], events: [] },
  ];
  for (const body of badBodies) {
    assert.equal((await handle(statRequest(body), statEnv(DB))).status, 400, JSON.stringify(body));
  }
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM budget').first()).n, 0);
  assert.equal(validateStatBatch({ v: 1, counts: [{ ...count(), session: 'x' }] }, projects.alibi), false);
});

test('registry rejection: unsupported event, route, release and non-1 n', async t => {
  const DB = database(t);
  const bad = [
    { v: 1, counts: [count('arbitrary.secret')] },
    { v: 1, counts: [count('puzzle.started', '/private/123')] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', 'email@example.com')] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.7')] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.6', 0)] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.6', 2)] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.6', 1.5)] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.6', '1')] },
    { v: 1, counts: [count('puzzle.started', 'puzzle', '0.11.6', NaN)] },
    { v: 1, counts: [] },
    { v: 1, counts: Array.from({ length: 21 }, () => count()) },
    { v: 2, counts: [count()] },
    { v: 1 },
    { counts: [count()] },
  ];
  for (const body of bad) {
    assert.equal((await handle(statRequest(body), statEnv(DB))).status, 400, JSON.stringify(body).slice(0, 120));
  }
  // Alibi closed vocabulary still admits a registered release.
  assert.equal((await handle(statRequest({ v: 1, counts: [count('puzzle.started', 'castle', '0.12.0')] }), statEnv(DB))).status, 202);
});

test('wrong Origin is refused and other ids are not found', async t => {
  const DB = database(t);
  assert.equal((await handle(statRequest(validBody(), { Origin: 'https://other.test' }), statEnv(DB))).status, 403);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
  for (const id of ['mdviewer', 'other', 'ALIBI']) {
    const r = await handle(new Request('https://collector.example/v1/collect-stat/' + id, {
      method: 'POST', headers: { Origin: ALIBI_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(validBody()),
    }), statEnv(DB));
    assert.equal(r.status, 404, id);
  }
  const query = await handle(new Request('https://collector.example/v1/collect-stat/alibi?visitor=123', {
    method: 'POST', headers: { Origin: ALIBI_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(validBody()),
  }), statEnv(DB));
  assert.equal(query.status, 404, 'statistics endpoint refuses URL-carried values');
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
});

test('preflight, media type, method and oversized body match the existing collect rules', async t => {
  const DB = database(t);
  const preflight = await handle(new Request('https://collector.example/v1/collect-stat/alibi', {
    method: 'OPTIONS', headers: { Origin: ALIBI_ORIGIN },
  }), statEnv(DB));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ALIBI_ORIGIN);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal((await handle(statRequest(validBody(), { 'Content-Type': 'text/plain' }), statEnv(DB))).status, 415);
  assert.equal((await handle(new Request('https://collector.example/v1/collect-stat/alibi', {
    headers: { Origin: ALIBI_ORIGIN },
  }), statEnv(DB))).status, 405);
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(17000)); c.close(); } });
  const oversized = await handle(new Request('https://collector.example/v1/collect-stat/alibi', {
    method: 'POST', headers: { Origin: ALIBI_ORIGIN, 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
  }), statEnv(DB));
  assert.equal(oversized.status, 400);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
});

test('disabled switch and registry rejection both fail closed with CORS', async t => {
  const DB = database(t);
  assert.equal(statAdmission({ COLLECT_STAT_PROJECTS: 'alibi' }), true);
  for (const value of [undefined, '', 'Alibi', ' alibi', 'alibi ', 'alibi,mdviewer', 'mdviewer']) {
    const env = { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', ...(value === undefined ? {} : { COLLECT_STAT_PROJECTS: value }) };
    const r = await handle(statRequest(validBody()), env);
    assert.equal(r.status, 503, String(value));
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ALIBI_ORIGIN);
  }
  // Existing collectionAdmission must also admit alibi.
  for (const env of [
    { DB, COLLECT_ENABLED: 'false', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi' },
    { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'mdviewer', COLLECT_STAT_PROJECTS: 'alibi' },
    { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi,Alibi', COLLECT_STAT_PROJECTS: 'alibi' },
    { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: '', COLLECT_STAT_PROJECTS: 'alibi' },
  ]) {
    const r = await handle(statRequest(validBody()), env);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ALIBI_ORIGIN);
  }
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
});

test('budget failure writes no aggregate and the boundary stays atomic', async t => {
  const DB = database(t);
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi', day(), 999, 'old').run();
  assert.equal((await handle(statRequest({ v: 1, counts: [count(), count('puzzle.completed')] }), statEnv(DB))).status, 429);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
  assert.equal((await DB.prepare('SELECT used FROM budget').first()).used, 999);
  assert.equal((await handle(statRequest({ v: 1, counts: [count()] }), statEnv(DB))).status, 202);
  assert.equal((await handle(statRequest({ v: 1, counts: [count()] }), statEnv(DB))).status, 429);
  assert.equal((await DB.prepare('SELECT n FROM statistics').first()).n, 1);
});

test('the first stat batch of a day is refused when it alone exceeds the daily limit', async t => {
  const DB = database(t);
  const original = projects.alibi.dailyLimit;
  projects.alibi.dailyLimit = 1;
  try {
    const refused = await handle(statRequest({ v: 1, counts: [count(), count('puzzle.completed')] }), statEnv(DB));
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('Retry-After'), '3600');
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM budget').first()).n, 0);
    assert.equal((await handle(statRequest({ v: 1, counts: [count()] }), statEnv(DB))).status, 202);
  } finally {
    projects.alibi.dailyLimit = original;
  }
});

test('migration is idempotent and readiness tracks version 2', async t => {
  const DB = database(t);
  const ready = await handle(new Request('https://collector.example/readyz'), statEnv(DB));
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).schema, 2);
  assert.equal((await DB.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 2);
  const columns = (await DB.prepare("SELECT name FROM pragma_table_info('statistics') ORDER BY cid").all()).results.map(r => r.name);
  assert.deepEqual(columns, ['project', 'day', 'event', 'route', 'release', 'n', 'received']);

  // An unmigrated v1 database (no statistics table, version 1) is not ready.
  DB.exec('DROP TABLE statistics');
  DB.exec('UPDATE schema_version SET version=1');
  assert.equal((await handle(new Request('https://collector.example/readyz'), statEnv(DB))).status, 503);

  // The migration file heals it idempotently and preserves historical events.
  await DB.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('alibi', crypto.randomUUID(), Date.now(), crypto.randomUUID(), 1, 'page.view', 'home', 'unattributed', null).run();
  const migration = readFileSync(new URL('../migrations/0002-alibi-statistics.sql', import.meta.url), 'utf8');
  DB.exec(migration);
  DB.exec(migration);
  assert.equal((await DB.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 2);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 1);
  assert.equal((await handle(new Request('https://collector.example/readyz'), statEnv(DB))).status, 200);
  DB.exec('UPDATE schema_version SET version=3');
  DB.exec(migration);
  assert.equal((await DB.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 3,
    'an old migration cannot downgrade a newer schema marker');
});

test('aggregate retention removes old counts without touching in-window counts', async t => {
  const DB = database(t);
  const now = Date.UTC(2026, 8, 25, 12);
  for (const statDay of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-25']) {
    await DB.prepare('INSERT INTO statistics VALUES(?,?,?,?,?,?,?)')
      .bind('alibi', statDay, 'page.view', 'home', '0.11.6', 1, now).run();
  }
  await maintain({ DB }, now);
  const remaining = (await DB.prepare('SELECT day FROM statistics ORDER BY day').all()).results.map(row => row.day);
  assert.deepEqual(remaining, ['2026-09-12', '2026-09-25']);
});

test('legacy collect, summary and portfolio behavior is unchanged', async t => {
  const DB = database(t);
  const env = { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi,mdviewer', COLLECT_STAT_PROJECTS: 'alibi', READ_TOKEN: 'r'.repeat(64) };
  const legacy = { v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq: 1, event: 'page.view', route: 'home', release: 'unattributed' };
  const collected = await handle(new Request('https://collector.example/v1/collect/mdviewer', {
    method: 'POST', headers: { Origin: projects.mdviewer.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [legacy] }),
  }), env);
  assert.equal(collected.status, 202);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics').first()).n, 0);

  // The new aggregate table is not surfaced in the Desk read models in this slice.
  const summary = await (await handle(new Request('https://collector.example/v1/summary', {
    headers: { Authorization: 'Bearer ' + 'r'.repeat(64) },
  }), env)).json();
  assert.ok(!('statistics' in summary));
  const portfolio = await (await handle(new Request('https://collector.example/v1/portfolio?days=7', {
    headers: { Authorization: 'Bearer ' + 'r'.repeat(64) },
  }), env)).json();
  assert.equal(portfolio.schema, 'pulseboard.portfolio/2');
  assert.ok(!('statistics' in portfolio));
});
