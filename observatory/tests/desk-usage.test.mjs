import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readStatistics } from '../src/statistics.mjs';
import { assets } from '../src/assets.mjs';
import { requestStatistics, assertStatistics, usageReading, usageQuestions, makeStatisticsDemo, STATISTICS_SCHEMA } from '../public/desk-usage.mjs';

const now = Date.parse('2026-09-25T12:00:00Z');
async function reader(t, rows) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  for (const [day, event, route, release, n] of rows) await db.prepare(`INSERT INTO statistics(project,day,event,route,release,n,received)
    VALUES ('alibi',?,?,?,?,?,?)`).bind(day, event, route, release, n, now).run();
  return readStatistics(db, { days: 7, now, admitted: true });
}

test('the Desk accepts what the aggregate reader produces', async t => {
  const stats = await reader(t, [
    ['2026-09-25', 'page.view', 'home', '0.12.0', 20], ['2026-09-25', 'puzzle.started', 'puzzle', '0.12.0', 12],
    ['2026-09-24', 'puzzle.completed', 'puzzle', '0.12.0', 4], ['2026-09-24', 'hint.requested', 'puzzle', '0.11.6', 15],
    ['2026-09-23', 'app.error', 'castle', '0.11.6', 2],
  ]);
  assert.equal(assertStatistics(stats, 7), stats);
  assert.equal(stats.schema, STATISTICS_SCHEMA);
  const r = usageReading(stats);
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.series.all.slice(-3), [2, 19, 32]);
  assert.equal(r.completedPerStart, 4 / 12);
  assert.equal(r.errorsPer100Views, 10);
  assert.deepEqual(r.busiest, { day: '2026-09-25', n: 32 });
  const text = usageQuestions(stats, r).map(q => q.text).join(' ');
  assert.match(text, /4 completions against 12 starts/);
  assert.match(text, /15 hint requests against 12 starts/);
  assert.match(text, /2 app errors/);
  assert.match(text, /2 releases reported counts/);
});

test('the Desk refuses a statistics read that disagrees with itself or its window', async t => {
  const stats = await reader(t, [['2026-09-25', 'page.view', 'home', '0.12.0', 3]]);
  const broken = [
    s => { s.schema = 'pulseboard.statistics/1'; },
    s => { s.total = 4; },
    s => { s.routes[0].n = 2; },
    s => { s.events[0].event = 'Page View'; },
    s => { s.daily[0].day = '2026-09-01'; },
    s => { s.window.startDay = '2026-09-20'; },
    s => { s.events[0].n = -1; },
    s => { s.limitations = 'none'; },
  ];
  for (const change of broken) {
    const copy = structuredClone(stats); change(copy);
    assert.throws(() => assertStatistics(copy, 7), TypeError);
  }
  assert.throws(() => assertStatistics(stats, 14), TypeError, 'a read for another window is refused');
});

test('empty and unadmitted readings say what a zero cannot mean', async t => {
  const stats = await reader(t, []);
  assert.match(usageQuestions(stats).map(q => q.text).join(' '), /no counts arrived/);
  assert.match(usageQuestions({ ...stats, collectionAdmitted: false }).map(q => q.text).join(' '), /says nothing about traffic/);
  const r = usageReading(stats);
  assert.equal(r.completedPerStart, null);
  assert.equal(r.busiest, null);
});

test('synthetic usage passes the same contract and is marked', () => {
  for (const days of [1, 7, 14]) {
    const demo = makeStatisticsDemo(days, now);
    assert.equal(demo.mode, 'demo');
    assert.equal(assertStatistics(demo, days), demo);
    assert.match(demo.limitations[0], /SYNTHETIC/);
  }
});

test('the statistics read is bounded and credential-safe', () => {
  let seen;
  requestStatistics((url, init) => { seen = { url, init }; }, { token: 't', days: 14, signal: null });
  assert.equal(seen.url, '/v1/statistics/alibi?days=14');
  assert.deepEqual(seen.init.headers, { authorization: 'Bearer t' });
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.ok(assets.has('/desk-usage.mjs'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="#usage" data-view="usage"/);
});
