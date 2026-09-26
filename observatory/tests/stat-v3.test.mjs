import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { validateStatBatch, classifyBrowser, classifyOs, statRegion, statLanguage, statHour, serverDimensions, batchDimensions,
  DIMENSION_NAMES, BROWSERS, OPERATING_SYSTEMS, DIMENSION_CAP } from '../src/stat-contract.mjs';

const ORIGIN = projects.alibi.origin, TOKEN = 'r'.repeat(32);
function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi', READ_TOKEN: TOKEN });
const count = (event = 'puzzle.started') => ({ event, route: 'puzzle', release: '0.11.6', n: 1 });
const context = (extra = {}) => ({ device: 'desktop', source: 'search', visit: 'new', scheme: 'dark', referrer: 'news.example.com', campaign: 'launch_1', ...extra });
function post(body, { headers = {}, cf } = {}) {
  const request = new Request('https://collector.example/v1/collect-stat/alibi', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}
const totals = async DB => Object.fromEntries((await DB.prepare('SELECT dimension,value,SUM(n) n FROM statistics_dimensions GROUP BY dimension,value').all())
  .results.map(r => [`${r.dimension}:${r.value}`, r.n]));

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
test('User-Agent classification covers the closed browser and OS vocabularies', () => {
  const table = [
    [CHROME_WIN, 'chrome', 'windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'edge', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', 'safari', 'macos'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0', 'firefox', 'macos'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', 'safari', 'ios'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1', 'chrome', 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15', 'firefox', 'ios'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'samsung', 'android'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', 'chrome', 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/124.0.0.0', 'opera', 'windows'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'firefox', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'chrome', 'chromeos'],
    ['curl/8.9.1', 'other', 'other'],
  ];
  for (const [ua, browser, os] of table) {
    assert.equal(classifyBrowser(ua), browser, ua); assert.equal(classifyOs(ua), os, ua);
    assert.ok(BROWSERS.includes(browser) && OPERATING_SYSTEMS.includes(os));
  }
  for (const missing of [null, undefined, '']) { assert.equal(classifyBrowser(missing), 'unknown'); assert.equal(classifyOs(missing), 'unknown'); }
});

test('region, language and hour are derived from the request and reduced to closed shapes', () => {
  const req = (headers = {}, cf) => { const r = new Request('https://x.test/', { headers }); if (cf !== undefined) Object.defineProperty(r, 'cf', { value: cf }); return r; };
  assert.equal(statRegion(req({}, { country: 'GB', regionCode: 'ENG' })), 'GB-ENG');
  assert.equal(statRegion(req({}, { country: 'US', regionCode: 'CA' })), 'US-CA');
  for (const cf of [undefined, {}, { country: 'GB' }, { regionCode: 'ENG' }, { country: 'XX', regionCode: 'ENG' }, { country: 'GB', regionCode: 'eng' },
    { country: 'GB', regionCode: 'ENGL' }, { country: 'GB', regionCode: '' }, { country: 'T1', regionCode: 'ENG' }]) assert.equal(statRegion(req({}, cf)), 'unknown', JSON.stringify(cf));
  const lang = value => statLanguage(req(value === undefined ? {} : { 'Accept-Language': value }));
  assert.equal(lang('en-GB,en;q=0.9'), 'en');
  assert.equal(lang('RO'), 'ro');
  assert.equal(lang('fil-PH'), 'fil');
  assert.equal(lang(' de ; q=1'), 'de');
  for (const bad of [undefined, '', '*', 'x-klingon', '12', 'engl-US', 'e']) assert.equal(lang(bad), 'unknown', String(bad));
  assert.equal(statHour(Date.UTC(2026, 8, 26, 0, 30)), '00');
  assert.equal(statHour(Date.UTC(2026, 8, 26, 23, 59)), '23');
  const dims = serverDimensions(req({ 'User-Agent': CHROME_WIN, 'Accept-Language': 'fr-FR' }, { country: 'FR', regionCode: 'IDF' }), Date.UTC(2026, 8, 26, 9));
  assert.deepEqual(dims, { country: 'FR', region: 'FR-IDF', browser: 'chrome', os: 'windows', language: 'fr', hour: '09' });
  assert.ok(!Object.values(dims).includes(CHROME_WIN), 'the User-Agent string is never a stored value');
});

test('v3 context is exactly six keys from the closed vocabularies and bounded shapes', () => {
  const project = projects.alibi, ok = ctx => validateStatBatch({ v: 3, context: ctx, counts: [count()] }, project);
  assert.equal(ok(context()), true);
  for (const good of [{ referrer: 'none' }, { referrer: 'other' }, { referrer: 'a.b' }, { referrer: 'x'.repeat(60) + '.com' },
    { campaign: 'none' }, { campaign: 'other' }, { campaign: 'a'.repeat(40) }, { scheme: 'light' }, { device: 'tablet' }]) assert.equal(ok(context(good)), true, JSON.stringify(good));
  for (const bad of [{ referrer: 'localhost' }, { referrer: 'News.example.com' }, { referrer: 'https://news.example.com' }, { referrer: 'x'.repeat(62) + '.com' },
    { referrer: 'a.b/path' }, { referrer: '' }, { referrer: 'ab' }, { campaign: 'Launch' }, { campaign: 'a'.repeat(41) }, { campaign: '' }, { campaign: 'a b' },
    { scheme: 'auto' }, { device: 'phone' }, { source: 'email' }, { visit: 'first' }, { referrer: 3 }, { campaign: null }]) assert.equal(ok(context(bad)), false, JSON.stringify(bad));
  const { campaign: _c, ...five } = context();
  assert.equal(ok(five), false);
  assert.equal(ok({ ...context(), country: 'GB' }), false);
  assert.equal(ok({ device: 'desktop', source: 'search', visit: 'new' }), false, 'a v2 context is not a v3 context');
  assert.equal(validateStatBatch({ v: 2, context: context(), counts: [count()] }, project), false, 'a v3 context is not a v2 context');
  assert.equal(validateStatBatch({ v: 3, counts: [count()] }, project), false);
  assert.equal(validateStatBatch({ v: 3, context: context(), counts: [count()], extra: 1 }, project), false);
});

test('each version records twelve dimensions: v1 no browser context, v2 its three, v3 all six', async t => {
  const DB = database(t);
  const headers = { 'User-Agent': CHROME_WIN, 'Accept-Language': 'en-GB,en' }, cf = { country: 'GB', regionCode: 'ENG' };
  assert.equal((await handle(post({ v: 1, counts: [count()] }, { headers, cf }), env(DB))).status, 202);
  assert.equal((await handle(post({ v: 2, context: { device: 'mobile', source: 'github', visit: 'returning' }, counts: [count(), count()] }, { headers, cf }), env(DB))).status, 202);
  assert.equal((await handle(post({ v: 3, context: context(), counts: [count(), count(), count()] }, { headers, cf }), env(DB))).status, 202);
  const all = await totals(DB);
  for (const name of DIMENSION_NAMES) assert.equal(Object.entries(all).filter(([k]) => k.startsWith(name + ':')).reduce((s, [, n]) => s + n, 0), 6, name);
  assert.equal(all['country:GB'], 6); assert.equal(all['region:GB-ENG'], 6); assert.equal(all['browser:chrome'], 6);
  assert.equal(all['os:windows'], 6); assert.equal(all['language:en'], 6);
  assert.equal(all['device:unknown'], 1); assert.equal(all['device:mobile'], 2); assert.equal(all['device:desktop'], 3);
  assert.equal(all['scheme:unknown'], 3); assert.equal(all['scheme:dark'], 3);
  assert.equal(all['referrer:unknown'], 3); assert.equal(all['referrer:news.example.com'], 3);
  assert.equal(all['campaign:unknown'], 3); assert.equal(all['campaign:launch_1'], 3);
  // The User-Agent and Accept-Language strings are nowhere in storage.
  const dump = JSON.stringify((await DB.prepare('SELECT * FROM statistics_dimensions').all()).results);
  assert.ok(!dump.includes('Mozilla') && !dump.includes('en-GB'));
  assert.deepEqual(batchDimensions({ v: 1, counts: [] }, new Request('https://x.test/'), 0).map(([name]) => name), [...DIMENSION_NAMES]);

  // The read returns every dimension, each summing to the total.
  const reading = await (await handle(new Request('https://desk.test/v1/statistics/alibi?days=1', { headers: { authorization: 'Bearer ' + TOKEN } }), env(DB))).json();
  assert.equal(reading.schema, 'pulseboard.statistics/4');
  assert.deepEqual(Object.keys(reading.dimensions), [...DIMENSION_NAMES]);
  for (const [name, rows] of Object.entries(reading.dimensions)) assert.equal(rows.reduce((s, r) => s + r.n, 0), reading.total, name);
  assert.deepEqual(reading.dimensions.scheme, [{ value: 'dark', n: 3 }, { value: 'unknown', n: 3 }]);
});

test('a dimension read tops up missing history with unknown for all twelve dimensions', async t => {
  const DB = database(t), today = new Date().toISOString().slice(0, 10);
  await DB.prepare('INSERT INTO statistics VALUES(?,?,?,?,?,?,?)').bind('alibi', today, 'page.view', 'home', '0.11.6', 4, Date.now()).run();
  await DB.prepare('INSERT INTO statistics_dimensions VALUES(?,?,?,?,?)').bind('alibi', today, 'country', 'GB', 1).run();
  const reading = await (await handle(new Request('https://desk.test/v1/statistics/alibi?days=90', { headers: { authorization: 'Bearer ' + TOKEN } }), env(DB))).json();
  assert.equal(reading.window.days, 90);
  assert.deepEqual(reading.dimensions.country, [{ value: 'GB', n: 1 }, { value: 'unknown', n: 3 }]);
  for (const name of DIMENSION_NAMES.filter(n => n !== 'country')) assert.deepEqual(reading.dimensions[name], [{ value: 'unknown', n: 4 }], name);
});

test('region, language, referrer and campaign keep at most 50 distinct values per day; sentinels and closed dimensions are never capped', async t => {
  const DB = database(t), today = new Date().toISOString().slice(0, 10);
  const seed = DB.prepare('INSERT INTO statistics_dimensions VALUES(?,?,?,?,?)');
  for (let i = 0; i < DIMENSION_CAP; i++) {
    await seed.bind('alibi', today, 'referrer', `site${i}.example`, 1).run();
    await seed.bind('alibi', today, 'campaign', `c${i}`, 1).run();
    await seed.bind('alibi', today, 'language', `l${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, 1).run();
    await seed.bind('alibi', today, 'region', `ZZ-${i}`, 1).run();
    await seed.bind('alibi', today, 'device', `seeded${i}`, 1).run();
  }
  // Sentinels on the day do not count towards the cap.
  await seed.bind('alibi', today, 'referrer', 'none', 1).run();
  const cf = { country: 'GB', regionCode: 'ENG' }, headers = { 'Accept-Language': 'en' };
  assert.equal((await handle(post({ v: 3, context: context({ referrer: 'new.example', campaign: 'fresh' }), counts: [count()] }, { headers, cf }), env(DB))).status, 202);
  let all = await totals(DB);
  assert.equal(all['referrer:other'], 1); assert.equal(all['campaign:other'], 1); assert.equal(all['language:other'], 1); assert.equal(all['region:other'], 1);
  assert.equal(all['referrer:new.example'], undefined); assert.equal(all['region:GB-ENG'], undefined);
  assert.equal(all['device:desktop'], 1, 'closed vocabularies are not capped');
  // A value already stored that day keeps counting under its own name; sentinels always do.
  assert.equal((await handle(post({ v: 3, context: context({ referrer: 'site7.example', campaign: 'none' }), counts: [count()] }, { headers, cf }), env(DB))).status, 202);
  all = await totals(DB);
  assert.equal(all['referrer:site7.example'], 2); assert.equal(all['campaign:none'], 1); assert.equal(all['campaign:other'], 1);
  // Another project, or another day, has its own cap.
  await DB.prepare("UPDATE statistics_dimensions SET day='2000-01-01'").run();
  assert.equal((await handle(post({ v: 3, context: context({ referrer: 'new.example' }), counts: [count()] }, { headers, cf }), env(DB))).status, 202);
  assert.equal((await totals(DB))['referrer:new.example'], 1);
});
