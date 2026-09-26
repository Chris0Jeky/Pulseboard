import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readStatistics, AGGREGATE_RETENTION_DAYS } from '../src/statistics.mjs';
import { handle } from '../src/worker.mjs';

function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}

test('aggregate reader excludes legacy rows and other days', async t => {
  const db = database(t);
  const now = Date.parse('2026-09-25T12:00:00Z');
  for (const [day, event, n] of [
    ['2026-09-25', 'page.view', 2],
    ['2026-09-24', 'puzzle.started', 3],
    ['2026-09-18', 'page.view', 9],
  ]) await db.prepare(`INSERT INTO statistics(project,day,event,route,release,n,received)
    VALUES ('alibi',?,?,?,?,?,?)`).bind(day, event, 'puzzle', '0.12.0', n, now).run();
  await db.prepare(`INSERT INTO events(project,id,received,session,seq,event,route,release,value)
    VALUES ('alibi','legacy',?,'session',1,'page.view','home','0.11.6',NULL)`).bind(now).run();
  const result = await readStatistics(db, { days: 7, now, admitted: true });
  assert.equal(result.schema, 'pulseboard.statistics/4');
  assert.equal(result.total, 5);
  assert.deepEqual(result.events, [
    { event: 'page.view', n: 2 }, { event: 'puzzle.started', n: 3 },
  ]);
  assert.deepEqual(result.daily, [
    { day: '2026-09-24', n: 3 }, { day: '2026-09-25', n: 2 },
  ]);
  assert.deepEqual(result.routes, [{ route: 'puzzle', n: 5 }]);
  assert.deepEqual(result.releases, [{ release: '0.12.0', n: 5 }]);
  assert.deepEqual(result.eventDaily, [
    { day: '2026-09-24', event: 'puzzle.started', n: 3 }, { day: '2026-09-25', event: 'page.view', n: 2 },
  ]);
  // Counts from before schema 3 carry no dimension rows: each dimension shows them as unknown, never guessed.
  assert.deepEqual(Object.keys(result.dimensions), ['country', 'region', 'browser', 'os', 'language', 'hour',
    'device', 'source', 'visit', 'scheme', 'referrer', 'campaign']);
  for (const name of Object.keys(result.dimensions)) assert.deepEqual(result.dimensions[name], [{ value: 'unknown', n: 5 }]);
  assert.equal(result.window.startDay, '2026-09-19');
  assert.match(result.limitations.join(' '), /separate from the legacy opt-in portfolio/);
  assert.match(result.limitations.join(' '), /kept for 14 UTC days/);
  assert.equal(AGGREGATE_RETENTION_DAYS, 14, 'becomes 400 only once no deployed host shows the 14-day notice (#105)');
});

test('statistics endpoint authenticates and validates its closed window', async t => {
  const db = database(t);
  const env = { DB: db, READ_TOKEN: 'x'.repeat(32), COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi' };
  const request = (path, token = env.READ_TOKEN) => new Request(`https://desk.test${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal((await handle(request('/v1/statistics/alibi', 'wrong'), env)).status, 401);
  for (const path of ['/v1/statistics/alibi?days=3', '/v1/statistics/alibi?days=7&days=14',
    '/v1/statistics/alibi?project=alibi', '/v1/statistics/alibi?days=07', '/v1/statistics/alibi?days=60', '/v1/statistics/alibi?days=090']) {
    assert.equal((await handle(request(path), env)).status, 400);
  }
  for (const days of [30, 90]) assert.equal((await (await handle(request('/v1/statistics/alibi?days=' + days), env)).json()).window.days, days);
  const response = await handle(request('/v1/statistics/alibi?days=1'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.collectionAdmitted, false);
  assert.deepEqual(body.events, []);
  assert.equal(body.total, 0);
  assert.equal((await handle(new Request('https://desk.test/v1/statistics/alibi', { method: 'POST' }), env)).status, 404);
});
