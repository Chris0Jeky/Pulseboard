import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { handle } from '../src/worker.mjs';
import { projects } from '../src/projects.mjs';
import { readStatistics } from '../src/statistics.mjs';

const DAY = 86_400_000;
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}
function post(project, origin = projects[project].origin) {
  return new Request(`https://collector.example/v1/collect-stat/${project}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, counts: [
      { event: 'page.view', route: 'home', release: 'unattributed', n: 1 },
    ] }),
  });
}
const env = db => ({ DB: db, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi,mdviewer' });

for (const project of ['alibi', 'mdviewer']) {
  test(`${project}: inserts and upserts keep only UTC-day receipt precision without changing hour counts`, async t => {
    const db = database(t);
    let now = Date.parse('2026-10-07T09:12:34.567Z');
    t.mock.method(Date, 'now', () => now);
    assert.equal((await handle(post(project), env(db))).status, 202);
    const first = await db.prepare('SELECT day,n,received FROM statistics').first();
    assert.equal(first.received, Math.floor(now / DAY) * DAY);
    now = Date.parse('2026-10-07T21:59:59.999Z');
    assert.equal((await handle(post(project), env(db))).status, 202);
    const second = await db.prepare('SELECT day,n,received FROM statistics').first();
    assert.deepEqual({ ...second }, { day: '2026-10-07', n: 2, received: first.received });
    const hours = (await db.prepare("SELECT value,n FROM statistics_dimensions WHERE dimension='hour' ORDER BY value").all()).results;
    assert.deepEqual(hours.map(row => ({ ...row })), [{ value: '09', n: 1 }, { value: '21', n: 1 }]);
    assert.equal((await db.prepare('SELECT used FROM budget').first()).used, 2);
    const before = await readStatistics(db, { project, days: 1, now, admitted: true });
    assert.equal(before.total, 2);
    assert.equal((await handle(post(project, 'https://wrong.example'), env(db))).status, 403);
    assert.deepEqual(await readStatistics(db, { project, days: 1, now, admitted: true }), before);
    now = Date.parse('2026-10-08T00:00:00.001Z');
    assert.equal((await handle(post(project), env(db))).status, 202);
    const rows = (await db.prepare('SELECT day,n,received FROM statistics ORDER BY day').all()).results;
    assert.deepEqual(rows.map(row => ({ ...row })), [
      { day: '2026-10-07', n: 2, received: Date.parse('2026-10-07T00:00:00Z') },
      { day: '2026-10-08', n: 1, received: Date.parse('2026-10-08T00:00:00Z') },
    ]);
  });
}

test('touching a historical aggregate removes its precise time, not other rows or counts', async t => {
  const db = database(t);
  const now = Date.parse('2026-10-07T12:34:56.789Z');
  t.mock.method(Date, 'now', () => now);
  await db.prepare("INSERT INTO statistics VALUES('alibi','2026-10-07','page.view','home','unattributed',7,?)").bind(now - 111).run();
  await db.prepare("INSERT INTO statistics VALUES('alibi','2026-10-06','page.view','home','unattributed',4,?)").bind(now - DAY).run();
  assert.equal((await handle(post('alibi'), env(db))).status, 202);
  const rows = (await db.prepare('SELECT n,received FROM statistics ORDER BY day').all()).results;
  assert.deepEqual(rows.map(row => ({ ...row })), [
    { n: 4, received: now - DAY }, { n: 8, received: Math.floor(now / DAY) * DAY },
  ]);
});
