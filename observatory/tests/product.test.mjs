import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle, maintain } from '../src/worker.mjs';
import { productAdmission, exactProjectList } from '../src/admission.mjs';
import { validateProductBatch, validateProps, redactProps, consentRegion, EEA } from '../src/product-contract.mjs';
import { readProduct, readProductEvents } from '../src/product.mjs';
import { startLocalRunner } from '../src/local.mjs';

const ORIGIN = projects.alibi.origin, TOKEN = 't'.repeat(32);
function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = (DB, extra = {}) => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_PRODUCT_PROJECTS: 'alibi', READ_TOKEN: TOKEN, ...extra });
const SESSION = '3b241101-e2bb-4255-8caf-4136c566a962';
const event = (extra = {}) => ({ name: 'puzzle.completed', route: 'puzzle', seq: 1, ms: 81234, props: { puzzle: 'castle-3', seconds: 212, hints: 1 }, ...extra });
const batch = (extra = {}) => ({ v: 1, session: SESSION, release: '0.13.0', context: { device: 'desktop' }, events: [event()], ...extra });
function post(body, { id = 'alibi', origin = ORIGIN, headers = {}, cf, method = 'POST', path } = {}) {
  const request = new Request('https://collector.example' + (path ?? '/v1/product/' + id), { method,
    headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}
const rows = async DB => (await DB.prepare('SELECT * FROM product_events ORDER BY rowid').all()).results.map(r => ({ ...r }));
const read = (path, token = TOKEN) => new Request('https://desk.test' + path, { headers: { authorization: 'Bearer ' + token } });

test('a product batch is stored with request-derived dimensions and no request strings', async t => {
  const DB = database(t);
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const response = await handle(post(batch({ context: { device: 'mobile' }, events: [event(), event({ name: 'hint.requested', seq: 2, ms: 90000.6, props: undefined })] }),
    { headers: { 'User-Agent': ua, 'Accept-Language': 'en-GB' }, cf: { country: 'GB', regionCode: 'SCT' } }), env(DB));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const stored = await rows(DB);
  assert.equal(stored.length, 2);
  const { received, day, ...first } = stored[0];
  assert.ok(received > 0); assert.equal(day, new Date(received).toISOString().slice(0, 10));
  assert.deepEqual(first, { project: 'alibi', session: SESSION, seq: 1, name: 'puzzle.completed', route: 'puzzle', release: '0.13.0', ms: 81234,
    props: '{"puzzle":"castle-3","seconds":212,"hints":1}', redacted: 0, country: 'GB', region: 'GB-SCT', browser: 'safari', os: 'ios', device: 'mobile' });
  assert.equal(stored[1].ms, 90001); assert.equal(stored[1].props, '{}');
  assert.ok(!JSON.stringify(stored).includes('Mozilla'));
  assert.equal((await DB.prepare("SELECT used FROM budget WHERE project='alibi:product'").first()).used, 2);
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM budget WHERE project='alibi'").first()).n, 0, 'the session budget is untouched');
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM statistics_dimensions').first()).n, 0);
  // Diagnostics-only batches carry no session.
  assert.equal((await handle(post(batch({ session: null, events: [event({ name: 'web.vital', props: { metric: 'LCP', value: 1200, rating: 'good' } })] })), env(DB))).status, 202);
  assert.equal((await rows(DB))[2].session, null);
});

test('the batch and event shapes are exact and bounded', async t => {
  const DB = database(t);
  const bad = [
    { ...batch(), v: 2 }, { ...batch(), extra: 1 }, (({ context: _c, ...b }) => b)(batch()), (({ session: _s, ...b }) => b)(batch()),
    batch({ session: 'not-a-uuid' }), batch({ session: '3b241101-e2bb-1255-8caf-4136c566a962' }), batch({ session: SESSION.toUpperCase() }), batch({ session: 7 }),
    batch({ release: '' }), batch({ release: 'x'.repeat(33) }), batch({ release: '0.13.0 beta' }), batch({ release: 13 }),
    batch({ context: {} }), batch({ context: { device: 'phone' } }), batch({ context: { device: 'desktop', scheme: 'dark' } }), batch({ context: null }),
    batch({ events: [] }), batch({ events: Array.from({ length: 21 }, (_, i) => event({ seq: i + 1 })) }), batch({ events: {} }),
    batch({ events: [event({ name: 'Puzzle' })] }), batch({ events: [event({ name: '1puzzle' })] }), batch({ events: [event({ name: 'a'.repeat(65) })] }),
    batch({ events: [event({ route: '/puzzle/3' })] }), batch({ events: [event({ route: 'x'.repeat(49) })] }), batch({ events: [event({ route: 'Puzzle' })] }),
    batch({ events: [event({ seq: 0 })] }), batch({ events: [event({ seq: 1000001 })] }), batch({ events: [event({ seq: 1.5 })] }),
    batch({ events: [event({ ms: -1 })] }), batch({ events: [event({ ms: 86400001 })] }), batch({ events: [event({ ms: '5' })] }),
    batch({ events: [event({ id: SESSION })] }), batch({ events: [event({ url: 'https://x.test/' })] }), batch({ events: [(({ route: _r, ...e }) => e)(event())] }),
    batch({ events: [event({ props: [] })] }), batch({ events: [event({ props: 'text' })] }), batch({ events: [event({ props: null })] }),
  ];
  for (const body of bad) assert.equal((await handle(post(body), env(DB))).status, 400, JSON.stringify(body).slice(0, 160));
  assert.equal((await handle(post('{not json'), env(DB))).status, 400);
  assert.equal(validateProductBatch(batch({ events: Array.from({ length: 20 }, (_, i) => event({ seq: i + 1 })) })), true);
  assert.equal(validateProductBatch(batch({ events: [event({ name: 'a:b_c.d-e', route: 'a.b_c-d', seq: 1000000, ms: 86400000 })] })), true);
  assert.equal((await rows(DB)).length, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM budget').first()).n, 0);
});

test('props bounds: depth, keys, key shape, strings, arrays, finite numbers and serialized size', () => {
  const nest = depth => depth === 1 ? { leaf: 1 } : { next: nest(depth - 1) };
  assert.equal(validateProps(nest(4)), true);
  assert.equal(validateProps(nest(5)), false);
  assert.equal(validateProps({ a: [[[1]]] }), true, 'arrays count as levels too');
  assert.equal(validateProps({ a: [[[[1]]]] }), false);
  const keys = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['k' + i, i]));
  assert.equal(validateProps(keys(32)), true); assert.equal(validateProps(keys(33)), false);
  assert.equal(validateProps({ nested: keys(33) }), false);
  for (const key of ['', 'a b', 'a/b', 'x'.repeat(49), 'é']) assert.equal(validateProps({ [key]: 1 }), false, key);
  assert.equal(validateProps({ ['A_b.c-9'.padEnd(48, 'x')]: 1 }), true);
  assert.equal(validateProps({ s: 'x'.repeat(256) }), true); assert.equal(validateProps({ s: 'x'.repeat(257) }), false);
  assert.equal(validateProps({ a: Array(32).fill(1) }), true); assert.equal(validateProps({ a: Array(33).fill(1) }), false);
  for (const value of [Infinity, -Infinity, NaN]) assert.equal(validateProps({ n: value }), false);
  assert.equal(validateProps({ t: true, f: false, z: null, n: -1.5 }), true);
  const big = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['k' + i, 'x'.repeat(240)]));
  assert.equal(validateProps(big), false, 'over 2048 bytes serialized');
  assert.equal(validateProps(Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['k' + i, 'x'.repeat(240)]))), true);
  assert.equal(validateProps(Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['k' + i, 'é'.repeat(240)]))), false, 'bytes, not characters');
  assert.equal(validateProps(JSON.parse('{"n":1e400}')), false);
});

test('personal keys and e-mail-looking strings are redacted, never rejected', async t => {
  const DB = database(t);
  const props = { puzzle: 'castle-3', name: 'castle', Email: 'a@b.co', user_name: 'x', 'first-name': 'y', 'Phone.Number': '1', nickname: 'n', displayName: 'd',
    player: 'p', PlayerName: 'q', user: 'u', handle: 'h', real_name: 'r', surname: 's', givenName: 'g',
    nested: { password: 'p', note: 'mail me at someone@example.org please', list: [{ token: 't', ok: 1 }, 'x@y.io'] }, __proto__x: 1 };
  const response = await handle(post(batch({ events: [event({ props })] })), env(DB));
  assert.equal(response.status, 202);
  const [row] = await rows(DB);
  assert.equal(row.redacted, 15);
  assert.deepEqual(JSON.parse(row.props), { puzzle: 'castle-3', name: 'castle', nested: { note: 'mail me at [email] please', list: [{ ok: 1 }, '[email]'] }, __proto__x: 1 });
  const proto = redactProps(JSON.parse('{"__proto__":{"polluted":1},"ok":1}'));
  assert.equal(proto.redacted, 0);
  assert.equal(Object.getPrototypeOf(proto.props), Object.prototype, 'a __proto__ key stays data');
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(redactProps({ apiKey: 1, 'ip-address': 2, ZIP_CODE: 3, keep: 'a@b' }), { props: { keep: 'a@b' }, redacted: 3 });
});

test('identifier and link keys are removed; IP addresses and URLs in text are reduced', async t => {
  const DB = database(t);
  const props = { userId: 1, UID: 'u', client_ip: 'x', ipAddr: 'x', remote_addr: 'x', URL: 'x', href: 'x', kind: 'TypeError',
    message: 'fetch https://user:pw@api.example.com:8443/v1/users/42?token=abc failed from 203.0.113.7 via 2001:db8::7 at 12:30:45',
    source: 'app.min.js', list: ['see http://[::1]:3000/admin', 'fe80:0000:0000:0000:0204:61ff:fe9d:f156', 'v 0.13.0', 'std::vector'] };
  assert.equal((await handle(post(batch({ events: [event({ name: 'js.error', props })] })), env(DB))).status, 202);
  const [row] = await rows(DB);
  assert.equal(row.redacted, 7);
  assert.deepEqual(JSON.parse(row.props), { kind: 'TypeError', message: 'fetch api.example.com failed from [ip] via [ip] at 12:30:45',
    source: 'app.min.js', list: ['see [ip]', '[ip]', 'v 0.13.0', 'std::vector'] });
  assert.ok(!row.props.includes('users/42') && !row.props.includes('token=abc'));
  // page.view is an ordinary product name.
  assert.equal((await handle(post(batch({ events: [event({ name: 'page.view', route: 'home', props: { from: 'https://www.search.example/q?x=1' } })] })), env(DB))).status, 202);
  assert.equal((await rows(DB))[1].props, '{"from":"www.search.example"}');
});

test('origin, id, method, media type, size and admission are checked in order with CORS after the origin', async t => {
  const DB = database(t);
  assert.equal((await handle(post(batch(), { origin: 'https://evil.test' }), env(DB))).status, 403);
  assert.equal((await handle(post(batch(), { origin: null }), env(DB))).status, 403);
  assert.equal((await handle(post(batch(), { id: 'mdviewer' }), env(DB))).status, 403, 'another project answers only its own origin');
  for (const id of ['taskdeck', 'nope', 'ALIBI']) assert.equal((await handle(post(batch(), { id }), env(DB))).status, 404, id);
  assert.equal((await handle(post(batch(), { path: '/v1/product/alibi?x=1' }), env(DB))).status, 404);
  const preflight = await handle(post(null, { method: 'OPTIONS' }), env(DB));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await handle(post(null, { method: 'PUT' }), env(DB))).status, 405);
  assert.equal((await handle(post(batch(), { headers: { 'Content-Type': 'text/plain' } }), env(DB))).status, 415);
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(17000)); c.close(); } });
  assert.equal((await handle(new Request('https://collector.example/v1/product/alibi', { method: 'POST', body: stream, duplex: 'half',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }), env(DB))).status, 400);
  for (const extra of [{ COLLECT_ENABLED: 'false' }, { COLLECT_ENABLED: undefined }, { COLLECT_PROJECTS: 'alibi,Alibi' }, { COLLECT_PRODUCT_PROJECTS: '' },
    { COLLECT_PRODUCT_PROJECTS: undefined }, { COLLECT_PRODUCT_PROJECTS: 'alibi ' }, { COLLECT_PRODUCT_PROJECTS: 'alibi,alibi' }, { COLLECT_PRODUCT_PROJECTS: 'mdviewer' },
    { COLLECT_PRODUCT_PROJECTS: 'alibi,taskdeck' }, { COLLECT_PRODUCT_PROJECTS: 'Alibi' }]) {
    const r = await handle(post(batch()), env(DB, extra));
    assert.equal(r.status, 503, JSON.stringify(extra)); assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  // Counts admission does not open product events, and product admission needs neither session nor counts admission.
  assert.equal((await handle(post(batch()), env(DB, { COLLECT_PRODUCT_PROJECTS: '', COLLECT_STAT_PROJECTS: 'alibi' }))).status, 503);
  assert.equal((await handle(post(batch()), env(DB, { COLLECT_PROJECTS: '' }))).status, 202);
  assert.equal((await handle(new Request('https://collector.example/v1/collect/alibi', { method: 'POST', body: '{}',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }), env(DB, { COLLECT_PROJECTS: '' }))).status, 503);
  assert.equal((await rows(DB)).length, 1);
  assert.deepEqual(productAdmission({ COLLECT_PRODUCT_PROJECTS: 'alibi,mdviewer' }), ['alibi', 'mdviewer']);
  assert.deepEqual(exactProjectList('alibi,commitatlas'), ['alibi', 'commitatlas']);
  assert.deepEqual(exactProjectList('a'.repeat(4097)), []);
});

test('the product budget is separate, per project, and a refused batch stores nothing', async t => {
  const DB = database(t), today = new Date().toISOString().slice(0, 10);
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi:product', today, 19999, 'old').run();
  const refused = await handle(post(batch({ events: [event(), event({ seq: 2 })] })), env(DB));
  assert.equal(refused.status, 429); assert.equal(refused.headers.get('Retry-After'), '3600');
  assert.equal(refused.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await rows(DB)).length, 0);
  assert.equal((await handle(post(batch()), env(DB))).status, 202);
  assert.equal((await handle(post(batch()), env(DB))).status, 429);
  assert.equal((await rows(DB)).length, 1);
  // A full product budget does not block counts, and the other way round.
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi', today, 1000, 'full').run();
  const original = projects.alibi.productLimit;
  projects.alibi.productLimit = 1;
  try {
    await DB.prepare("DELETE FROM budget WHERE project='alibi:product'").run();
    assert.equal((await handle(post(batch({ events: [event(), event({ seq: 2 })] })), env(DB))).status, 429, 'the first batch of a day is refused when it alone exceeds the limit');
    assert.equal((await DB.prepare("SELECT COUNT(*) n FROM budget WHERE project='alibi:product'").first()).n, 0);
    assert.equal((await handle(post(batch()), env(DB))).status, 202);
  } finally { projects.alibi.productLimit = original; }
  for (const [id, p] of Object.entries(projects)) if (p.origin) assert.equal(p.productLimit, 20000, id);
});

test('the consent hint answers eea or other from the edge country, origin-checked and privately cacheable', async t => {
  const DB = database(t);
  const ask = (cf, { origin = ORIGIN, id = 'alibi', method = 'GET', query = '' } = {}) => {
    const r = new Request(`https://collector.example/v1/consent/${id}${query}`, { method, headers: origin ? { Origin: origin } : {} });
    if (cf !== undefined) Object.defineProperty(r, 'cf', { value: cf });
    return handle(r, { DB });
  };
  for (const [cf, region] of [[{ country: 'DE' }, 'eea'], [{ country: 'NO' }, 'eea'], [{ country: 'IS' }, 'eea'], [{ country: 'LI' }, 'eea'],
    [{ country: 'GB' }, 'other'], [{ country: 'US' }, 'other'], [{ country: 'CH' }, 'other'], [{ country: 'XX' }, 'eea'], [{ country: 'T1' }, 'eea'],
    [{}, 'eea'], [undefined, 'eea'], [{ country: 'de' }, 'eea']]) {
    const response = await ask(cf);
    assert.equal(response.status, 200, JSON.stringify(cf));
    assert.deepEqual(await response.json(), { v: 1, region }, JSON.stringify(cf));
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=3600');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  }
  assert.equal(EEA.size, 30);
  assert.equal(consentRegion(null), 'eea');
  assert.equal((await ask({ country: 'US' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await ask({ country: 'US' }, { origin: null })).status, 403);
  for (const id of ['taskdeck', 'nope']) assert.equal((await ask({ country: 'US' }, { id })).status, 404, id);
  assert.equal((await ask({ country: 'US' }, { query: '?x=1' })).status, 404);
  assert.equal((await ask({ country: 'US' }, { method: 'POST' })).status, 405);
  assert.equal((await ask({ country: 'US' }, { method: 'OPTIONS' })).status, 204);
  // Works with collection off: it is a hint, not admission, and it writes nothing.
  const tables = ['budget', 'events', 'statistics', 'statistics_dimensions', 'product_events'];
  for (const table of tables) assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, table);
});

const NOW = Date.parse('2026-09-25T12:00:00Z'), DAY = 86400000;
async function seed(DB, list) {
  const insert = DB.prepare(`INSERT INTO product_events(project,received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const e of list) {
    const received = e.received ?? NOW;
    await insert.bind(e.project ?? 'alibi', received, new Date(received).toISOString().slice(0, 10), e.session ?? null, e.seq ?? 1, e.name, e.route ?? 'puzzle',
      e.release ?? '0.13.0', e.ms ?? 0, JSON.stringify(e.props ?? {}), e.redacted ?? 0, 'GB', 'GB-ENG', 'chrome', 'windows', 'desktop').run();
  }
}
test('the product read aggregates totals, sessions, journeys, exits, p75 vitals and errors inside the window', async t => {
  const DB = database(t);
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await seed(DB, [
    { session: A, seq: 1, name: 'puzzle.started', received: NOW - 60000 },
    { session: A, seq: 2, name: 'hint.requested', received: NOW - 30000, redacted: 2 },
    { session: A, seq: 3, name: 'puzzle.completed', received: NOW - 10000 },
    { session: B, seq: 2, name: 'puzzle.failed', received: NOW - 5000 },
    { session: B, seq: 1, name: 'puzzle.started', received: NOW - 5000 },
    { session: C, seq: 1, name: 'puzzle.started', received: NOW - DAY, route: 'castle', release: '0.12.0' },
    ...[100, 200, 300, 400, 500, 600, 700, 800].map(value => ({ name: 'web.vital', route: 'puzzle', props: { metric: 'LCP', value, rating: 'good' } })),
    ...[0.01, 0.2, 0.05].map(value => ({ name: 'web.vital', route: 'home', props: { metric: 'CLS', value } })),
    { name: 'web.vital', props: { metric: 'FID', value: 5 } }, { name: 'web.vital', props: { metric: 'LCP', value: 'fast' } },
    { name: 'js.error', props: { kind: 'TypeError', message: 'x is undefined' }, received: NOW - 1000 },
    { name: 'js.error', props: { kind: 'TypeError', message: 'x is undefined' }, received: NOW - 2000 },
    { name: 'js.error', props: { kind: 'RangeError', message: 'bad' }, received: NOW - 3000 },
    { name: 'puzzle.started', received: NOW - 7 * DAY },
    { name: 'puzzle.started', project: 'mdviewer' },
  ]);
  const r = await readProduct(DB, { project: 'alibi', days: 7, now: NOW, admitted: true });
  assert.equal(r.schema, 'pulseboard.product/1');
  assert.equal(r.window.startDay, '2026-09-19'); assert.equal(r.window.days, 7);
  assert.equal(r.total, 22); assert.equal(r.redactedKeys, 2); assert.equal(r.observationStatus, 'observed');
  assert.deepEqual(r.names.slice(0, 3), [{ name: 'web.vital', n: 13 }, { name: 'js.error', n: 3 }, { name: 'puzzle.started', n: 3 }]);
  assert.deepEqual(r.releases, [{ release: '0.12.0', n: 1 }, { release: '0.13.0', n: 21 }]);
  assert.deepEqual(r.daily, [{ day: '2026-09-24', n: 1 }, { day: '2026-09-25', n: 21 }]);
  assert.deepEqual(r.sessions, { count: 3, medianEvents: 2, medianDurationMs: 0 });
  assert.deepEqual(r.journeys.map(j => j.steps), [['puzzle.started', 'puzzle.failed'], ['puzzle.started', 'hint.requested', 'puzzle.completed'], ['puzzle.started']]);
  assert.equal(r.journeys[1].durationMs, 50000); assert.equal(r.journeys[1].events, 3); assert.equal(r.journeys[1].truncated, false);
  assert.ok(!JSON.stringify(r).includes(A), 'journeys do not expose the session id');
  assert.deepEqual(r.exits, [{ name: 'puzzle.completed', n: 1 }, { name: 'puzzle.failed', n: 1 }, { name: 'puzzle.started', n: 1 }]);
  // Nearest rank: LCP n=8 -> rank 6 -> 600; CLS n=3 -> rank 3 of [0.01, 0.05, 0.2] -> 0.2. Never an average.
  assert.deepEqual(r.vitals, [{ metric: 'CLS', route: 'home', p75: 0.2, n: 3 }, { metric: 'LCP', route: 'puzzle', p75: 600, n: 8 }]);
  assert.deepEqual(r.errors, [{ kind: 'TypeError', message: 'x is undefined', n: 2, lastSeen: NOW - 1000 }, { kind: 'RangeError', message: 'bad', n: 1, lastSeen: NOW - 3000 }]);
  assert.ok(r.limitations.some(line => /never an average of percentiles/.test(line)));
  const one = await readProduct(DB, { project: 'alibi', days: 1, now: NOW });
  assert.equal(one.total, 21); assert.equal(one.sessions.count, 2); assert.equal(one.collectionAdmitted, false);
  const empty = await readProduct(DB, { project: 'commitatlas', days: 90, now: NOW });
  assert.equal(empty.total, 0); assert.equal(empty.observationStatus, 'no-admitted-events');
  assert.deepEqual(empty.sessions, { count: 0, medianEvents: null, medianDurationMs: null });
  await assert.rejects(readProduct(DB, { project: 'alibi', days: 3, now: NOW }), RangeError);
});

test('journeys keep the latest 100 sessions and their first 100 steps', async t => {
  const DB = database(t);
  const list = [];
  for (let i = 0; i < 105; i++) list.push({ session: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, seq: 1, name: 'page.view', received: NOW - (105 - i) * 1000 });
  for (let i = 1; i <= 101; i++) list.push({ session: 'ffffffff-ffff-4fff-8fff-ffffffffffff', seq: i, name: 'step', received: NOW });
  await seed(DB, list);
  const r = await readProduct(DB, { project: 'alibi', days: 1, now: NOW });
  assert.equal(r.journeys.length, 100);
  assert.equal(r.journeys[0].steps.length, 100); assert.equal(r.journeys[0].truncated, true); assert.equal(r.journeys[0].events, 101);
  assert.equal(r.sessions.count, 106); assert.equal(r.sessions.medianEvents, 1);
});

test('the raw events read is newest first, filtered, limited and authenticated', async t => {
  const DB = database(t);
  await seed(DB, Array.from({ length: 12 }, (_, i) => ({ name: i % 2 ? 'js.error' : 'page.view', seq: i + 1, received: NOW - i * 1000, props: { i } })));
  const all = await readProductEvents(DB, { project: 'alibi', days: 1, now: NOW });
  assert.equal(all.schema, 'pulseboard.product-events/1'); assert.equal(all.events.length, 12); assert.equal(all.truncated, false);
  assert.deepEqual(all.events.map(e => e.props.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(Object.keys(all.events[0]), ['received', 'day', 'session', 'seq', 'name', 'route', 'release', 'ms', 'props', 'redacted', 'country', 'region', 'browser', 'os', 'device']);
  const errors = await readProductEvents(DB, { project: 'alibi', days: 1, now: NOW, name: 'js.error', limit: 5 });
  assert.equal(errors.events.length, 5); assert.equal(errors.truncated, true); assert.ok(errors.events.every(e => e.name === 'js.error'));
  const e = { ...env(DB) };
  const status = async path => (await handle(read(path), e)).status;
  assert.equal(await status('/v1/product/alibi/events?days=1&limit=5000'), 200);
  assert.equal((await (await handle(read('/v1/product/alibi/events?name=js.error&limit=2&days=90'), e)).json()).events.length, 2);
  for (const path of ['/v1/product/alibi/events?limit=0', '/v1/product/alibi/events?limit=5001', '/v1/product/alibi/events?limit=05',
    '/v1/product/alibi/events?limit=1&limit=2', '/v1/product/alibi/events?name=Bad', '/v1/product/alibi/events?name=a&name=b',
    '/v1/product/alibi/events?days=3', '/v1/product/alibi/events?session=x', '/v1/product/alibi?name=js.error', '/v1/product/alibi?days=60',
    '/v1/product/alibi?limit=5']) assert.equal(await status(path), 400, path);
  assert.equal((await handle(read('/v1/product/alibi', 'wrong'), e)).status, 401);
  assert.equal((await handle(read('/v1/product/alibi/events', 'wrong'), e)).status, 401);
  for (const id of ['taskdeck', 'nope']) { assert.equal(await status('/v1/product/' + id), 404); assert.equal(await status(`/v1/product/${id}/events`), 404); }
  const body = await (await handle(read('/v1/product/alibi?days=30'), e)).json();
  assert.equal(body.schema, 'pulseboard.product/1'); assert.equal(body.collectionAdmitted, true); assert.equal(body.window.days, 30);
  assert.equal((await (await handle(read('/v1/product/alibi'), env(DB, { COLLECT_PRODUCT_PROJECTS: '' }))).json()).collectionAdmitted, false);
  assert.equal((await handle(read('/v1/product/alibi'), env(DB, { COLLECT_PROJECTS: 'alibi,Alibi' }))).status, 503);
  await assert.rejects(readProductEvents(DB, { project: 'alibi', now: NOW, limit: 5001 }), RangeError);
  await assert.rejects(readProductEvents(DB, { project: 'alibi', now: NOW, name: 'Bad' }), RangeError);
});

test('retention keeps 90 days of product events, 14 of legacy session events and 400 of aggregates', async t => {
  const DB = database(t), now = Date.UTC(2026, 8, 25, 12);
  await seed(DB, [{ name: 'old', received: now - 90 * DAY }, { name: 'kept', received: now - 89 * DAY }, { name: 'new', received: now }]);
  const legacy = (id, received) => DB.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)').bind('alibi', id, received, 's', 1, 'page.view', 'home', 'unattributed', null).run();
  // Legacy session events keep the 14 days their deployed notice promises.
  await legacy('old', now - 15 * DAY); await legacy('kept', now - 13 * DAY);
  await maintain({ DB }, now);
  assert.deepEqual((await DB.prepare('SELECT name FROM product_events ORDER BY received').all()).results.map(r => r.name), ['kept', 'new']);
  assert.deepEqual((await DB.prepare('SELECT id FROM events').all()).results.map(r => r.id), ['kept']);
  const kept = await readProduct(DB, { project: 'alibi', days: 90, now });
  assert.deepEqual(kept.names.map(n => n.name).sort(), ['kept', 'new'], 'the 90-day read window matches retention');
});

test('readiness reports schema 4 and the product switch, and fails without the product table', async t => {
  const DB = database(t);
  const ready = await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_PRODUCT_PROJECTS: 'alibi,mdviewer' }));
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.equal(body.schema, 4);
  assert.deepEqual(body.product, { configured: true, admitted: ['alibi', 'mdviewer'] });
  assert.deepEqual((await (await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_PRODUCT_PROJECTS: 'alibi, mdviewer' }))).json()).product,
    { configured: true, admitted: [] });
  assert.deepEqual((await (await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_ENABLED: 'false' }))).json()).product,
    { configured: true, admitted: [] });
  DB.exec('ALTER TABLE product_events DROP COLUMN device');
  assert.equal((await handle(new Request('https://desk.test/readyz'), env(DB))).status, 503);
  DB.exec('DROP TABLE product_events');
  assert.equal((await handle(new Request('https://desk.test/readyz'), env(DB))).status, 503);
});

test('the local runner admits and reads product events against real SQLite', async t => {
  const DB = database(t);
  const runner = await startLocalRunner({ port: 0, DB, READ_TOKEN: TOKEN, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: '',
    COLLECT_STAT_PROJECTS: 'alibi', COLLECT_PRODUCT_PROJECTS: 'alibi', ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  t.after(() => runner.close());
  const sent = await fetch(runner.origin + '/v1/product/alibi', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(batch()) });
  assert.equal(sent.status, 202);
  const counted = await fetch(runner.origin + '/v1/collect-stat/alibi', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, counts: [{ event: 'page.view', route: 'home', release: '0.13.0', n: 1 }] }) });
  assert.equal(counted.status, 202);
  const reading = await (await fetch(runner.origin + '/v1/product/alibi?days=1', { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  assert.equal(reading.total, 1); assert.equal(reading.collectionAdmitted, true);
  const hint = await fetch(runner.origin + '/v1/consent/alibi', { headers: { Origin: ORIGIN } });
  assert.deepEqual(await hint.json(), { v: 1, region: 'eea' }, 'no edge country locally reads as EEA');
  const ready = await (await fetch(runner.origin + '/readyz')).json();
  assert.deepEqual(ready.product, { configured: true, admitted: ['alibi'] });
});
