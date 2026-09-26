import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readStatistics } from '../src/statistics.mjs';
import { assets } from '../src/assets.mjs';
import { requestStatistics, assertStatistics, usageReading, usageQuestions, makeStatisticsDemo, foldTop, hourSeries, STATISTICS_SCHEMA, STATISTICS_LEGACY_SCHEMA, USAGE_DIMENSIONS } from '../public/desk-usage.mjs';
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
  // The reader moves from schema 3 to 4 in the collector slice; the Desk reads both until then.
  assert.ok([STATISTICS_SCHEMA, STATISTICS_LEGACY_SCHEMA].includes(stats.schema), stats.schema);
  const r = usageReading(stats);
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.series.all.slice(-3), [2, 19, 32]);
  assert.equal(r.completedPerStart, 4 / 12);
  assert.equal(r.errorsPer100Views, 10);
  assert.deepEqual(r.busiest, { day: '2026-09-25', n: 32 });
  const text = usageQuestions(stats, r).map(q => q.text).join(' ');
  assert.match(text, /4 completions against 12 puzzle starts/);
  assert.match(text, /15 hint requests against 12 starts/);
  assert.match(text, /2 app errors/);
  assert.match(text, /2 release labels/);
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
    s => { s.visitors = 3; },
    s => { s.events[0].country = 'GB'; },
    s => { s.events.push({ ...s.events[0], n: 0 }); },
    s => { s.window.extra = 1; },
    s => { delete s.dimensions; },
    s => { s.dimensions.country[0].n += 1; },
    s => { s.dimensions.device = [{ value: 'phone', n: 3 }]; },
    s => { s.dimensions.country = [{ value: 'gb', n: 3 }]; },
    s => { s.dimensions.extra = []; },
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
  for (const project of ['alibi', 'mdviewer']) for (const days of [1, 7, 14, 30, 90]) {
    const demo = makeStatisticsDemo(days, now, project);
    assert.equal(demo.mode, 'demo');
    assert.equal(assertStatistics(demo, days, project), demo);
    assert.match(demo.limitations[0], /SYNTHETIC/);
  }
  assert.equal(usageReading(makeStatisticsDemo(7, now, 'alibi')).journey, 'puzzle');
  assert.equal(usageReading(makeStatisticsDemo(7, now, 'mdviewer')).journey, 'action');
});

test('a read for one project is refused as another project', async t => {
  const stats = await reader(t, [['2026-09-25', 'page.view', 'home', '0.12.0', 3]]);
  assert.throws(() => assertStatistics(stats, 7, 'mdviewer'), TypeError);
  const md = { ...structuredClone(stats), project: 'mdviewer' };
  assert.equal(assertStatistics(md, 7, 'mdviewer'), md);
  const r = usageReading({ ...md, events: [{ event: 'action.requested', n: 2 }, { event: 'page.view', n: 1 }] });
  assert.equal(r.journey, 'action');
  assert.equal(usageReading(stats).journey, 'puzzle', 'Alibi keeps its puzzle journey even in a window without puzzle events');
  assert.equal(r.started, 2);
});

test('the statistics read is bounded and credential-safe', () => {
  let seen;
  requestStatistics((url, init) => { seen = { url, init }; }, { token: 't', days: 14, signal: null });
  assert.equal(seen.url, '/v1/statistics/alibi?days=14');
  let other; requestStatistics((url) => { other = url; }, { project: 'commitatlas', token: 't', days: 1, signal: null });
  assert.equal(other, '/v1/statistics/commitatlas?days=1');
  for (const project of ['../x', 'Alibi', '', 'a?b']) assert.throws(() => requestStatistics(() => {}, { project, token: 't', days: 7 }), TypeError);
  assert.throws(() => requestStatistics(() => {}, { project: 'alibi', token: 't', days: 3 }), TypeError);
  let wide; requestStatistics((url) => { wide = url; }, { token: 't', days: 90, signal: null });
  assert.equal(wide, '/v1/statistics/alibi?days=90');
  assert.deepEqual(seen.init.headers, { authorization: 'Bearer t' });
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.ok(assets.has('/desk-usage.mjs'));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="#usage" data-view="usage"/);
});

test('schema 4 carries twelve closed dimensions, each summing to the total', () => {
  const demo = makeStatisticsDemo(30, now, 'alibi');
  assert.equal(demo.schema, 'pulseboard.statistics/4');
  assert.deepEqual(Object.keys(demo.dimensions).sort(), [...USAGE_DIMENSIONS].sort());
  const accepted = [
    s => { s.dimensions.region[0].value = 'other'; },
    s => { s.dimensions.language[0].value = 'other'; },
    s => { s.dimensions.referrer[0].value = 'other'; },
    s => { s.dimensions.campaign[0].value = 'unknown'; },
    s => { s.dimensions.referrer[1].value = 'sub.example-host.co.uk'; },
  ];
  for (const change of accepted) { const copy = structuredClone(demo); change(copy); assert.equal(assertStatistics(copy, 30), copy); }
  const broken = [
    s => { delete s.dimensions.hour; },
    s => { s.dimensions.hour[0].value = '24'; },
    s => { s.dimensions.hour[0].value = '7'; },
    s => { s.dimensions.region[0].value = 'England'; },
    s => { s.dimensions.language[0].value = 'en-GB'; },
    s => { s.dimensions.browser[0].value = 'netscape'; },
    s => { s.dimensions.os[0].value = 'beos'; },
    s => { s.dimensions.scheme[0].value = 'sepia'; },
    s => { s.dimensions.referrer[1].value = 'localhost'; },
    s => { s.dimensions.referrer[1].value = 'https://github.com/x'; },
    s => { s.dimensions.campaign[0].value = 'Launch Week'; },
    s => { s.dimensions.referrer[0].n += 1; },
    s => { s.dimensions.hour = s.dimensions.hour.concat(s.dimensions.hour.slice(0, 1).map(r => ({ ...r, n: 0 }))); },
    s => { s.schema = 'pulseboard.statistics/3'; },
  ];
  for (const [i, change] of broken.entries()) {
    const copy = structuredClone(demo); change(copy);
    assert.throws(() => assertStatistics(copy, 30), TypeError, `mutation ${i} should be refused`);
  }
  const legacy = { ...structuredClone(demo), schema: 'pulseboard.statistics/3' };
  legacy.dimensions = { country: demo.dimensions.country, device: demo.dimensions.device, source: demo.dimensions.source, visit: demo.dimensions.visit };
  assert.equal(assertStatistics(legacy, 30), legacy, 'schema 3 keeps its four dimensions');
  assert.throws(() => assertStatistics({ ...legacy, schema: 'pulseboard.statistics/4' }, 30), TypeError, 'schema 4 must carry all twelve');
});

test('display folding keeps the top ten and one remainder; the hour chart has 24 buckets', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ value: `v${i}`, n: 20 - i }));
  const folded = foldTop(rows);
  assert.deepEqual(folded.rows.map(r => r.value), ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9']);
  assert.deepEqual(folded.other, { values: 4, n: 10 + 9 + 8 + 7 });
  assert.equal(foldTop(rows.slice(0, 3)).other, null);
  assert.deepEqual(foldTop([{ value: 'b', n: 1 }, { value: 'a', n: 1 }]).rows.map(r => r.value), ['a', 'b']);
  const series = hourSeries([{ value: '00', n: 2 }, { value: '23', n: 5 }, { value: 'unknown', n: 3 }]);
  assert.equal(series.hours.length, 24); assert.equal(series.hours[0], 2); assert.equal(series.hours[23], 5); assert.equal(series.unknown, 3);
  const demo = makeStatisticsDemo(7, now, 'alibi');
  assert.equal(hourSeries(demo.dimensions.hour).hours.reduce((a, b) => a + b, 0), demo.total);
});
