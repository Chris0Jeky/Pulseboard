import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assets } from '../src/assets.mjs';
import { makeProductDemo, makeProductEventsDemo } from '../public/desk-demo.mjs';
import { requestProduct, requestProductEvents, assertProduct, assertProductEvents, assertProps, propertyBreakdown, vitalRating, rankQuantile,
  PRODUCT_SCHEMA, PRODUCT_EVENTS_SCHEMA } from '../public/desk-product.mjs';
import { alibiPuzzles, ALIBI_EVENT_NAMES } from '../public/products/alibi.mjs';
import { PRODUCT_PANELS, productPanel } from '../public/products/index.mjs';

const now = Date.parse('2026-09-25T12:00:00Z');
const session = n => `0000000${n}-0000-4000-8000-000000000000`;
const summary = () => ({
  schema: PRODUCT_SCHEMA, project: 'alibi', generatedAt: now,
  window: { startDay: '2026-09-19', endDay: '2026-09-25', days: 7, timezone: 'UTC', partialToday: true },
  collectionAdmitted: true, population: 'opted-in browser sessions', limitations: ['Sessions are browser tabs, not people.'],
  total: 5,
  totals: { names: [{ name: 'puzzle.started', n: 3 }, { name: 'web.vital', n: 2 }], routes: [{ route: 'puzzle', n: 5 }],
    releases: [{ release: '0.13.0', n: 5 }], days: [{ day: '2026-09-24', n: 1 }, { day: '2026-09-25', n: 4 }],
    truncated: { names: false, routes: false, releases: false } },
  sessions: { n: 2, medianEvents: 1, medianDurationMs: 0 },
  journeys: [{ session: session(1), startedAt: now - 1000, durationMs: 0, steps: ['puzzle.started'], stepsTruncated: false }],
  exits: [{ name: 'puzzle.started', n: 2 }],
  vitals: [{ metric: 'INP', route: 'puzzle', p75: 240, n: 2 }],
  errors: [{ kind: 'TypeError', message: 'x is undefined', n: 1, lastSeen: now - 5000 }],
});
const raw = (name, props, overrides = {}) => ({ received: now - 1000, day: '2026-09-25', session: session(1), seq: 1, name, route: 'puzzle', release: '0.13.0',
  ms: 500, props, redacted: 0, country: 'GB', region: 'GB-ENG', browser: 'chrome', os: 'windows', device: 'desktop', ...overrides });
const eventsRead = events => ({ schema: PRODUCT_EVENTS_SCHEMA, project: 'alibi', generatedAt: now, window: summary().window, name: 'puzzle.started',
  limit: 100, truncated: false, events });

test('the product summary contract accepts its documented shape', () => {
  const s = summary();
  assert.equal(assertProduct(s, 7, 'alibi'), s);
  assert.equal(assertProduct({ ...summary(), sessions: { n: 0, medianEvents: null, medianDurationMs: null }, journeys: [], exits: [] }, 7, 'alibi').sessions.n, 0);
  const capped = summary(); capped.totals.truncated.names = true; capped.totals.names.pop();
  assert.equal(assertProduct(capped, 7, 'alibi'), capped, 'a capped list may fall short of the total');
  const long = summary(); long.journeys[0].steps = Array(200).fill('puzzle.started'); long.journeys[0].stepsTruncated = true;
  assert.equal(assertProduct(long, 7, 'alibi'), long);
  const piped = summary(); piped.errors.push({ kind: 'Type|Error', message: 'x', n: 1, lastSeen: now }, { kind: 'Type', message: 'Error|x', n: 1, lastSeen: now });
  assert.equal(assertProduct(piped, 7, 'alibi'), piped, "'|' inside a kind or message cannot collide");
  const wide = summary(); wide.errors[0].kind = 'k'.repeat(64); wide.errors[0].message = '\u{1F600}'.repeat(80);
  assert.equal(assertProduct(wide, 7, 'alibi'), wide, 'lengths are JS string units');
});

test('the product summary contract refuses each malformed shape', () => {
  const broken = [
    s => { s.schema = 'pulseboard.product/2'; },
    s => { s.project = 'mdviewer'; },
    s => { s.visitors = 3; },
    s => { s.mode = 'live'; },
    s => { s.window.days = 8; },
    s => { s.window.startDay = '2026-09-20'; },
    s => { s.total = 6; },
    s => { s.totals.names[0].n = 2; },
    s => { s.totals.names[0].name = 'Puzzle Started'; },
    s => { s.totals.routes[0].route = 'a/b'; },
    s => { s.totals.releases.push({ release: '0.13.0', n: 0 }); },
    s => { s.totals.days[0].day = '2026-09-01'; },
    s => { s.totals.extra = []; },
    s => { delete s.totals.truncated; },
    s => { s.totals.truncated.days = false; },
    s => { s.totals.truncated.names = 'yes'; },
    s => { s.totals.truncated.names = true; s.totals.names[0].n += 1; },
    s => { s.totals.truncated.routes = true; s.totals.days[0].n -= 1; },
    s => { s.totals.names = Array.from({ length: 513 }, (_, i) => ({ name: `e${i}`, n: 1 })); s.totals.truncated.names = true; },
    s => { delete s.journeys[0].stepsTruncated; },
    s => { s.journeys[0].stepsTruncated = 1; },
    s => { s.journeys[0].steps = Array(201).fill('puzzle.started'); },
    s => { s.errors[0].kind = 'k'.repeat(65); },
    s => { s.errors.push({ ...s.errors[0] }); },
    s => { s.sessions.medianEvents = -1; },
    s => { s.sessions.users = 2; },
    s => { s.sessions = { n: 0, medianEvents: 1, medianDurationMs: null }; s.exits = []; s.journeys = []; },
    s => { s.journeys[0].session = 'user-42'; },
    s => { s.journeys[0].steps = []; },
    s => { s.journeys[0].steps = ['<b>'] ; },
    s => { s.journeys[0].email = 'a@b.c'; },
    s => { s.journeys = Array.from({ length: 101 }, (_, i) => ({ ...s.journeys[0], session: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000` })); },
    s => { s.journeys.push({ ...s.journeys[0], session: session(2) }, { ...s.journeys[0], session: session(3) }); },
    s => { s.exits[0].n = 1; },
    s => { s.vitals[0].metric = 'FID'; },
    s => { s.vitals[0].p75 = Number.NaN; },
    s => { s.vitals[0].mean = 200; },
    s => { s.vitals.push({ ...s.vitals[0] }); },
    s => { s.errors[0].message = 'x'.repeat(161); },
    s => { s.errors[0].message = 'line\nbreak'; },
    s => { s.errors[0].n = 0; },
    s => { s.errors[0].stack = 'at x'; },
    s => { s.limitations = 'none'; },
  ];
  for (const [i, change] of broken.entries()) {
    const copy = summary(); change(copy);
    assert.throws(() => assertProduct(copy, 7, 'alibi'), TypeError, `mutation ${i} should be refused`);
  }
  assert.throws(() => assertProduct(summary(), 14, 'alibi'), TypeError, 'a read for another window is refused');
});

test('the raw events contract is ordered, filtered by name and bounded', () => {
  const good = eventsRead([raw('puzzle.started', { puzzle: 'castle-1', nested: { a: [1, 2] } }), raw('puzzle.started', { puzzle: 'castle-2' }, { received: now - 2000, session: null })]);
  assert.equal(assertProductEvents(good, 7, 'alibi', 'puzzle.started'), good);
  const broken = [
    r => { r.name = 'puzzle.completed'; },
    r => { r.events[0].name = 'puzzle.completed'; },
    r => { r.events.reverse(); },
    r => { r.limit = 1; },
    r => { r.limit = 5001; },
    r => { r.events[0].props = null; },
    r => { r.events[0].props = { 'bad key': 1 }; },
    r => { r.events[0].props = { a: { b: { c: { d: { e: 1 } } } } }; },
    r => { r.events[0].props = { s: 'x'.repeat(301) }; },
    r => { r.events[0].props = { n: Number.POSITIVE_INFINITY }; },
    r => { r.events[0].seq = 0; },
    r => { r.events[0].ms = 86_400_001; },
    r => { r.events[0].day = '2026-09-24'; },
    r => { r.events[0].session = 'abc'; },
    r => { r.events[0].device = 'phone'; },
    r => { r.events[0].ip = '1.2.3.4'; },
    r => { r.users = []; },
  ];
  for (const [i, change] of broken.entries()) {
    const copy = structuredClone(good); change(copy);
    assert.throws(() => assertProductEvents(copy, 7, 'alibi', 'puzzle.started'), TypeError, `mutation ${i} should be refused`);
  }
  assert.throws(() => assertProps(Array.from({ length: 33 }, () => 1)), TypeError);
  assert.equal(assertProps({ s: 'x'.repeat(300) }), undefined, 'redaction slack up to 300 characters');
  assert.throws(() => assertProps(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]))), TypeError);
});

test('product reads are bounded and credential-safe', () => {
  const seen = [];
  const fetcher = (url, init) => { seen.push({ url, init }); };
  requestProduct(fetcher, { project: 'alibi', token: 't', days: 90 });
  requestProductEvents(fetcher, { project: 'alibi', token: 't', days: 30, name: 'puzzle.completed', limit: 5000 });
  assert.deepEqual(seen.map(x => x.url), ['/v1/product/alibi?days=90', '/v1/product/alibi/events?days=30&name=puzzle.completed&limit=5000']);
  for (const { init } of seen) { assert.deepEqual(init.headers, { authorization: 'Bearer t' }); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); }
  for (const bad of [{ project: '../x', days: 7 }, { project: 'alibi', days: 3 }]) assert.throws(() => requestProduct(fetcher, { token: 't', ...bad }), TypeError);
  for (const bad of [{ name: 'a&b=c' }, { name: 'A' }, { limit: 0 }, { limit: 5001 }, { limit: 1.5 }])
    assert.throws(() => requestProductEvents(fetcher, { project: 'alibi', token: 't', days: 7, name: 'x.y', ...bad }), TypeError);
  for (const path of ['/desk-product.mjs', '/products/index.mjs', '/products/alibi.mjs']) assert.ok(assets.has(path), path);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /href="#product" data-view="product"/);
});

test('web vitals take the web.dev boundaries, inclusive of good', () => {
  assert.equal(vitalRating('LCP', 2500), 'good'); assert.equal(vitalRating('LCP', 2501), 'needs-improvement'); assert.equal(vitalRating('LCP', 4001), 'poor');
  assert.equal(vitalRating('INP', 200), 'good'); assert.equal(vitalRating('INP', 500), 'needs-improvement'); assert.equal(vitalRating('INP', 501), 'poor');
  assert.equal(vitalRating('CLS', 0.1), 'good'); assert.equal(vitalRating('CLS', 0.2), 'needs-improvement'); assert.equal(vitalRating('CLS', 0.3), 'poor');
  assert.equal(vitalRating('FCP', 1800), 'good'); assert.equal(vitalRating('TTFB', 1801), 'poor');
  assert.equal(vitalRating('FID', 10), 'unknown');
  assert.equal(rankQuantile([1, 2, 3, 4], 0.5), 2); assert.equal(rankQuantile([1, 2, 3, 4], 0.75), 3); assert.equal(rankQuantile([], 0.5), null);
});

test('property breakdown flattens, counts strings and booleans, and summarises numbers', () => {
  const events = [
    { props: { puzzle: 'castle-1', seconds: 10, solved: true, meta: { theme: 'dark', size: { w: 3 } }, tags: ['a', 'b'] } },
    { props: { puzzle: 'castle-1', seconds: 20, solved: false, meta: { theme: 'light' }, tags: ['a'] } },
    { props: { puzzle: 'castle-2', seconds: 30, solved: true, mixed: 1 } },
    { props: { seconds: 40, mixed: 'one', nothing: null } },
    { props: {} },
  ];
  const rows = Object.fromEntries(propertyBreakdown(events).map(r => [r.key, r]));
  assert.deepEqual(Object.keys(rows), ['seconds', 'puzzle', 'solved', 'meta.theme', 'mixed', 'tags[]', 'meta.size.w', 'nothing']);
  assert.equal(rows.seconds.kind, 'number'); assert.equal(rows.seconds.present, 4);
  assert.deepEqual({ ...rows.seconds.numeric, histogram: undefined }, { n: 4, min: 10, median: 20, p90: 40, max: 40, histogram: undefined });
  assert.equal(rows.seconds.numeric.histogram.length, 4);
  assert.equal(rows.seconds.numeric.histogram.reduce((s, b) => s + b.n, 0), 4);
  assert.deepEqual(rows.puzzle.values, [{ value: 'castle-1', n: 2 }, { value: 'castle-2', n: 1 }]);
  assert.equal(rows.solved.kind, 'boolean'); assert.deepEqual(rows.solved.values, [{ value: 'true', n: 2 }, { value: 'false', n: 1 }]);
  assert.equal(rows.mixed.kind, 'mixed');
  assert.deepEqual(rows['tags[]'].values, [{ value: 'a', n: 2 }, { value: 'b', n: 1 }]);
  assert.equal(rows['tags[]'].present, 2, 'present counts events, not array items');
  assert.equal(rows.nothing.kind, 'string'); assert.deepEqual(rows.nothing.values, [{ value: 'null', n: 1 }]);
  const one = propertyBreakdown([{ props: { v: 5 } }, { props: { v: 5 } }])[0].numeric;
  assert.deepEqual(one.histogram, [{ lo: 5, hi: 5, n: 2 }]);
  const proto = Object.fromEntries(propertyBreakdown([{ props: JSON.parse('{"constructor":"a","toString":1,"valueOf":true,"__proto__":{"x":"y"}}') }]).map(r => [r.key, r]));
  assert.deepEqual(Object.keys(proto).sort(), ['__proto__.x', 'constructor', 'toString', 'valueOf']);
  assert.deepEqual(proto.constructor.values, [{ value: 'a', n: 1 }]); assert.equal(proto.toString.numeric.n, 1);
  const extreme = propertyBreakdown([{ props: { v: -1e308 } }, { props: { v: 1e308 } }, { props: { v: 0 } }])[0].numeric;
  assert.deepEqual(extreme.histogram, [{ lo: -1e308, hi: 1e308, n: 3 }], 'an overflowing span falls back to one bin');
  const ties = propertyBreakdown([...'abcdefghijkl'].map(k => ({ props: { k } })).concat([{ props: { k: 'z' } }, { props: { k: 'z' } }]))[0];
  assert.deepEqual(ties.values.map(v => v.value), ['z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']); assert.equal(ties.otherValues, 3);
  const many = propertyBreakdown(Array.from({ length: 30 }, (_, i) => ({ props: { k: `v${i}`, x: i } })), { top: 10 });
  assert.equal(many.find(r => r.key === 'k').values.length, 10); assert.equal(many.find(r => r.key === 'k').otherValues, 20);
  assert.equal(many.find(r => r.key === 'x').numeric.histogram.length, 10);
});

test('the Alibi panel counts puzzles and finds give-ups within a session', () => {
  const x = (name, id, props, s = 1) => ({ name, session: s === null ? null : session(s), props: { puzzle: id, ...props } });
  const model = alibiPuzzles([
    x('puzzle.started', 'castle-1', {}, 1), x('hint.requested', 'castle-1', {}, 1), x('puzzle.completed', 'castle-1', { seconds: 100, hints: 1, attempts: 2 }, 1),
    x('puzzle.started', 'castle-1', {}, 2), x('puzzle.failed', 'castle-1', { attempts: 3 }, 2),
    x('puzzle.started', 'castle-1', {}, 3), x('puzzle.completed', 'castle-1', { seconds: 300 }, 3),
    x('puzzle.started', 'castle-3', {}, 4), x('hint.requested', 'castle-3', {}, 4), x('hint.requested', 'castle-3', {}, 4),
    x('puzzle.started', 'castle-3', {}, 5), x('puzzle.completed', 'castle-1', { seconds: 200 }, 5),
    x('puzzle.started', 'castle-3', {}, null),
    { name: 'puzzle.started', session: session(6), props: {} }, { name: 'puzzle.completed', session: session(6), props: { puzzle: 7 } },
  ]);
  const c1 = model.puzzles.find(r => r.puzzle === 'castle-1'), c3 = model.puzzles.find(r => r.puzzle === 'castle-3');
  assert.deepEqual([c1.starts, c1.completions, c1.failures, c1.hints], [3, 3, 1, 1]);
  assert.equal(c1.completionRate, 1);
  assert.deepEqual(c1.solve, { n: 3, median: 200, p90: 300 });
  assert.equal(c1.medianAttempts, 2);
  assert.deepEqual([c3.starts, c3.completions, c3.hints, c3.completionRate], [3, 0, 2, 0]);
  assert.deepEqual(c3.solve, { n: 0, median: null, p90: null });
  assert.equal(model.unattributed, 2);
  assert.equal(model.sessionless, 1);
  // castle-1: session 2 failed without completing; castle-3: sessions 4 and 5 started without completing it (5 completed castle-1 instead).
  assert.deepEqual(model.giveUps, [{ puzzle: 'castle-3', sessions: 2, of: 2, share: 1 }, { puzzle: 'castle-1', sessions: 1, of: 3, share: 1 / 3 }]);
  assert.deepEqual(model.puzzles.map(r => r.puzzle), ['castle-1', 'castle-3']);
  assert.deepEqual(alibiPuzzles([]), { puzzles: [], giveUps: [], unattributed: 0, sessionless: 0, events: 0 });
});

test('the plugin registry maps ids to panels and nothing else', () => {
  assert.equal(productPanel('alibi'), PRODUCT_PANELS.alibi);
  assert.deepEqual(productPanel('alibi').names, ALIBI_EVENT_NAMES);
  for (const id of ['mdviewer', 'constructor', '__proto__', 'toString']) assert.equal(productPanel(id), null);
  for (const panel of Object.values(PRODUCT_PANELS)) {
    assert.equal(typeof panel.compute, 'function'); assert.equal(typeof panel.render, 'function'); assert.ok(panel.names.length > 0);
  }
});

test('synthetic product data is deterministic, marked and passes both contracts', () => {
  assert.deepEqual(makeProductDemo(7, now, 'alibi'), makeProductDemo(7, now, 'alibi'));
  assert.notDeepEqual(makeProductDemo(7, now, 'alibi'), makeProductDemo(14, now, 'alibi'));
  for (const project of ['alibi', 'mdviewer']) for (const days of [1, 7, 14, 30, 90]) {
    const demo = makeProductDemo(days, now, project);
    assert.equal(demo.mode, 'demo'); assert.match(demo.limitations[0], /SYNTHETIC/);
    assert.equal(assertProduct(demo, days, project), demo);
    assert.ok(demo.journeys.length > 0 && demo.vitals.length > 0);
    for (const { name, n } of demo.totals.names) {
      const read = makeProductEventsDemo(days, now, project, name, 5000);
      assert.equal(assertProductEvents(read, days, project, name), read);
      assert.equal(read.events.length, n, `${project} ${days}d ${name}: the explorer read agrees with the summary`);
    }
  }
  const alibi = makeProductDemo(7, now, 'alibi');
  for (const name of ALIBI_EVENT_NAMES) assert.ok(alibi.totals.names.some(r => r.name === name), name);
  const events = ALIBI_EVENT_NAMES.flatMap(name => makeProductEventsDemo(7, now, 'alibi', name, 5000).events);
  const model = alibiPuzzles(events);
  assert.equal(model.unattributed, 0);
  assert.ok(model.puzzles.length >= 4 && model.giveUps.length > 0);
  const limited = makeProductEventsDemo(90, now, 'alibi', 'web.vital', 10);
  assert.equal(limited.events.length, 10); assert.equal(limited.truncated, true);
  assert.throws(() => makeProductDemo(3, now, 'alibi'), RangeError);
});
