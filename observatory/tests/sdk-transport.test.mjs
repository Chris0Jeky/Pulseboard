import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard, classifyReferrer, campaignOf, deviceOf, validProps, scrubProps, scrubString } from '../sdk/pulseboard-sdk.mjs';
import { config, makeRuntime, storage, settle, ORIGIN } from './sdk-fakes.mjs';

const DECIDED = { 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: true, journeys: true, decided: true, month: '2026-09' }) };
const start = (options = {}, cfg = config()) => {
  const h = makeRuntime({ local: storage({ ...DECIDED }), ...options });
  const sdk = createPulseboard(cfg, h.runtime);
  sdk.mount();
  return { ...h, sdk };
};

test('counts body is exactly contract v3: six context keys and closed-vocabulary counts', async () => {
  const h = start({ referrer: 'https://www.Google.co.uk/search?q=secret', search: '?utm_campaign=Launch_2026&utm_source=x', width: 800, dark: true });
  h.sdk.route('puzzle');
  h.sdk.count('thing.done');
  h.sdk.count('not.in.vocab');
  h.fire();
  await settle();
  const [call] = h.counts();
  assert.equal(call.url, 'https://collector.example/v1/collect-stat/demo');
  assert.deepEqual(Object.keys(call.body), ['v', 'context', 'counts']);
  assert.equal(call.body.v, 3);
  assert.deepEqual(call.body.context, { device: 'tablet', source: 'search', visit: 'new', scheme: 'dark', referrer: 'google.com', campaign: 'other' });
  assert.deepEqual(call.body.counts, [
    { event: 'page.view', route: 'home', release: '1.0.0', n: 1 },
    { event: 'page.view', route: 'puzzle', release: '1.0.0', n: 1 },
    { event: 'thing.done', route: 'puzzle', release: '1.0.0', n: 1 },
  ]);
  const init = call.init;
  assert.deepEqual([init.method, init.mode, init.credentials, init.referrerPolicy, init.headers['Content-Type']], ['POST', 'cors', 'omit', 'no-referrer', 'application/json']);
  for (const leak of ['secret', 'search?q', '/secret/page', 'www.']) assert.equal(init.body.includes(leak), false, leak);
});

test('route falls back to other when the vocabulary has it, else home; unknown releases fall back to unattributed', async () => {
  const h = start();
  h.sdk.route('Nope');
  const noOther = start({}, config({ project: { events: ['page.view'], routes: ['home', 'editor'], releases: ['unattributed'] } }));
  noOther.sdk.route('missing');
  h.fire(); noOther.fire();
  await settle();
  assert.deepEqual(h.counts()[0].body.counts.map(c => c.route), ['home', 'other']);
  assert.deepEqual(noOther.counts()[0].body.counts.map(c => [c.route, c.release]), [['home', 'unattributed'], ['home', 'unattributed']]);
});

test('referrer, source and campaign classification table', () => {
  const rows = [
    ['', 'direct', 'none'],
    [ORIGIN + '/other/page', 'internal', 'none'],
    ['https://www.google.com/', 'search', 'google.com'],
    ['https://www.bing.com/search?q=a', 'search', 'bing.com'],
    ['https://duckduckgo.com/', 'search', 'duckduckgo.com'],
    ['https://search.yahoo.co.jp/', 'other', 'other'],
    ['https://www.ecosia.org/', 'search', 'ecosia.org'],
    ['https://search.brave.com/', 'search', 'brave.com'],
    ['https://yandex.ru/', 'search', 'yandex.com'],
    ['https://www.baidu.com/', 'search', 'baidu.com'],
    ['https://t.co/abc', 'social', 'x.com'],
    ['https://x.com/someone/status/1', 'social', 'x.com'],
    ['https://twitter.com/', 'social', 'x.com'],
    ['https://m.facebook.com/', 'social', 'facebook.com'],
    ['https://www.linkedin.com/feed', 'social', 'linkedin.com'],
    ['https://old.reddit.com/r/x', 'social', 'reddit.com'],
    ['https://mastodon.social/@a', 'social', 'mastodon.social'],
    ['https://bsky.app/profile/a', 'social', 'bsky.app'],
    ['https://www.youtube.com/', 'social', 'youtube.com'],
    ['https://discord.com/channels/1', 'social', 'discord.com'],
    ['https://github.com/Chris0Jeky/Pulseboard', 'github', 'github.com'],
    ['https://gist.github.com/a', 'github', 'github.com'],
    ['https://someone.github.io/repo/', 'github', 'github.io'],
    ['https://example.org/private/path?x=1', 'other', 'other'],
    ['https://Example.ORG:8443/', 'other', 'other'],
    ['http://localhost:3000/', 'other', 'other'],
    ['https://' + 'a'.repeat(70) + '.com/', 'other', 'other'],
    ['https://[::1]/', 'other', 'other'],
    ['not a url', 'other', 'other'],
    ['https://xn--bcher-kva.example/', 'other', 'other'],
  ];
  for (const [referrer, source, host] of rows) assert.deepEqual(classifyReferrer(referrer, ORIGIN), { source, referrer: host }, referrer);
  const campaigns = [['', 'none'], ['?a=1', 'none'], ['?utm_campaign=Spring-Sale', 'spring-sale'], ['?utm_campaign=', 'other'],
    ['?utm_campaign=has%20space', 'other'], ['?utm_campaign=' + 'x'.repeat(41), 'other'], ['?utm_campaign=ok_1', 'ok_1']];
  // Only registered tags are counted (SDK 3.2); the rest of the table is the shape check.
  for (const [search, value] of campaigns) assert.equal(campaignOf(search, ['spring-sale', 'ok_1']), value, search);
  assert.equal(campaignOf('?utm_campaign=ok_1'), 'other', 'unregistered by default');
  for (const [width, device] of [[320, 'mobile'], [767, 'mobile'], [768, 'tablet'], [1023, 'tablet'], [1024, 'desktop'], [undefined, 'desktop'], [NaN, 'desktop']]) {
    assert.equal(deviceOf(width), device, String(width));
  }
});

test('product batches carry exactly {v, session, release, context:{device}, events} and a per-tab uuid only with journeys', async () => {
  const h = start({ width: 400 });
  assert.equal(h.sdk.track('puzzle.completed', { puzzle: 'castle-3', seconds: 212, hints: 1 }), true);
  h.fire();
  await settle();
  const [call] = h.products();
  assert.equal(call.url, 'https://collector.example/v1/product/demo');
  assert.deepEqual(Object.keys(call.body), ['v', 'session', 'release', 'context', 'events']);
  assert.equal(call.body.v, 1);
  assert.match(call.body.session, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(call.body.context, { device: 'mobile' });
  const names = call.body.events.map(e => e.name);
  assert.ok(names.includes('page.view') && names.includes('puzzle.completed') && names.includes('web.vital'));
  const done = call.body.events.find(e => e.name === 'puzzle.completed');
  assert.deepEqual(Object.keys(done), ['name', 'route', 'seq', 'ms', 'props']);
  assert.deepEqual(done.props, { puzzle: 'castle-3', seconds: 212, hints: 1 });
  const seqs = call.body.events.map(e => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
  // The same tab keeps the session and continues the sequence on the next page.
  const next = start({ session: h.runtime.sessionStorage });
  next.sdk.track('puzzle.started');
  next.fire();
  await settle();
  const second = next.products()[0].body;
  assert.equal(second.session, call.body.session);
  assert.ok(Math.min(...second.events.map(e => e.seq)) > Math.max(...seqs));
  // Diagnostics without journeys: session is null and no session key exists.
  const diag = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: true, journeys: false, decided: true, month: '2026-09' }) }) });
  assert.equal(diag.sdk.track('puzzle.started'), false);
  diag.fire();
  await settle();
  assert.equal(diag.products()[0].body.session, null);
  assert.equal(diag.runtime.sessionStorage.map.has('pulseboard:session:demo'), false);
});

test('track validates names and props with the contract bounds and never throws', async () => {
  const h = start();
  const deep = { a: { b: { c: { d: 1 } } } };
  const tooDeep = { a: { b: { c: { d: { e: 1 } } } } };
  assert.equal(validProps(deep), true);
  assert.equal(validProps(tooDeep), false);
  assert.equal(validProps({ list: [[['x']]] }), true);
  assert.equal(validProps(Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['k' + i, i]))), false);
  assert.equal(validProps({ s: 'x'.repeat(257) }), false);
  assert.equal(validProps({ n: NaN }), false);
  assert.equal(validProps({ n: Infinity }), false);
  assert.equal(validProps({ 'bad key': 1 }), false);
  assert.equal(validProps({ a: Array(33).fill(1) }), false);
  assert.equal(validProps({ d: new Date() }), false);
  assert.equal(validProps(Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['k' + i, 'x'.repeat(250)]))), false, 'over 2 KiB');
  for (const [name, props] of [['Bad', {}], ['1x', {}], ['a'.repeat(65), {}], ['web.vital', {}], ['js.error', {}], ['page.engaged', {}],
    ['ok', []], ['ok', 'text'], ['ok', tooDeep], ['ok', { f: () => 1 }], [42, {}]]) {
    assert.equal(h.sdk.track(name, props), false, JSON.stringify(name));
  }
  const hostile = { get boom() { throw new Error('host getter'); } };
  assert.doesNotThrow(() => h.sdk.track('ok', hostile));
  assert.equal(h.sdk.track('a:b-c_d.e', { fine: true, none: null }), true);
});

test('personal keys are dropped and e-mail-looking strings masked on the client', async () => {
  const props = { score: 3, Email: 'a@b.co', user_name: 'x', 'first-name': 'y', PlayerName: 'z', handle: 'h', nested: { phone: '1', note: 'mail me at x.y@example.com', list: ['c@d.io', 'ok'] } };
  assert.deepEqual(scrubProps(props), { score: 3, nested: { note: 'mail me at [email]', list: ['[email]', 'ok'] } });
  assert.equal(props.Email, 'a@b.co', 'input is not mutated');
  const h = start();
  h.sdk.track('form.sent', props);
  h.fire();
  await settle();
  const event = h.products()[0].body.events.find(e => e.name === 'form.sent');
  assert.deepEqual(event.props, { score: 3, nested: { note: 'mail me at [email]', list: ['[email]', 'ok'] } });
});

test('a full queue flushes immediately at 20; otherwise the 2 s timer flushes', async () => {
  const h = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: false, journeys: false, decided: true, month: '2026-09' }) }) });
  assert.equal(h.counts().length, 0);
  assert.ok([...h.timers.values()].some(t => t.ms === 2000));
  for (let i = 0; i < 19; i++) h.sdk.count('app.ready');
  await settle();
  assert.equal(h.counts().length, 1);
  assert.equal(h.counts()[0].body.counts.length, 20);
  assert.equal(h.counts()[0].init.keepalive, true, 'small batches ride keepalive within the budget');
});

test('hard caps: 100 queued items and 120 requests per page', async () => {
  const h = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: false, journeys: false, decided: true, month: '2026-09' }) }) });
  h.runtime.hold = true;
  let accepted = 0;
  for (let i = 0; i < 5000; i++) if (h.sdk.count('app.ready')) accepted += 1;
  await settle();
  assert.ok(h.posts().length <= 120, 'request cap');
  assert.equal(h.sdk.status().requests, 120);
  assert.equal(h.sdk.count('app.ready'), false);
  assert.ok(accepted <= 120 * 20 + 100);
  const q = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: false, diagnostics: false, journeys: true, decided: true, month: '2026-09' }) }) });
  // Unmounted instances queue but never send; the queue cap still binds.
  const idle = createPulseboard(config(), q.runtime);
  let queued = 0;
  for (let i = 0; i < 150; i++) if (idle.track('step.done', { i })) queued += 1;
  assert.equal(queued, 100);
  assert.equal(idle.status().queued.product, 100);
});

test('the circuit opens per endpoint after three failures and drops that queue', async () => {
  const h = start({ status: 403, local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: false, journeys: true, decided: true, month: '2026-09' }) }) });
  for (let round = 0; round < 3; round++) { h.sdk.count('app.ready'); h.sdk.track('step.done'); h.fire(); await settle(); }
  assert.equal(h.sdk.status().open.counts, true);
  assert.equal(h.sdk.status().open.product, true);
  const before = h.counts().length;
  assert.equal(before, 3);
  assert.equal(h.sdk.count('app.ready'), false);
  assert.equal(h.sdk.track('step.done'), false);
  h.fire();
  await settle();
  assert.equal(h.counts().length, before);
  // A lane that succeeds stays closed.
  const fresh = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: true, diagnostics: false, journeys: false, decided: true, month: '2026-09' }) }) });
  fresh.sdk.count('app.ready');
  fresh.fire();
  await settle();
  assert.equal(fresh.sdk.status().open.counts, false);
});

test('pagehide hands queued work to keepalive within a 64 KiB budget and keeps the rest local', async () => {
  const h = start({ local: storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts: false, diagnostics: false, journeys: true, decided: true, month: '2026-09' }) }) });
  h.runtime.hold = true;
  const big = Object.fromEntries(Array.from({ length: 7 }, (_, i) => ['k' + i, 'x'.repeat(250)]));
  for (let i = 0; i < 60; i++) h.sdk.track('step.done', big);
  const live = () => h.products().filter(c => c.init.keepalive && !c.settled).reduce((sum, c) => sum + Buffer.byteLength(c.init.body), 0);
  assert.ok(live() <= 65536, 'keepalive budget while visible');
  assert.ok(h.products().some(c => c.init.keepalive === false), 'overflow beyond the budget goes as an ordinary request');
  assert.ok(h.products().every(c => Buffer.byteLength(c.init.body) <= 16384), 'request size bound');
  const beforeHide = h.products().length;
  for (let i = 0; i < 15; i++) h.sdk.track('step.done', big);
  h.runtime.emit('pagehide', { persisted: true });
  assert.ok(h.products().slice(beforeHide).every(c => c.init.keepalive === true), 'a hiding page only uses keepalive');
  assert.ok(live() <= 65536);
  assert.ok(h.sdk.status().queued.product > 0, 'the remainder stays queued rather than being sent without keepalive');
  // Settled keepalive requests return their bytes to the budget; the next hide hands the rest over.
  for (const c of h.products()) { c.settled = true; c.release({ ok: true }); }
  await settle();
  assert.equal(h.sdk.status().keepaliveBytes, 0);
  const afterRelease = h.products().length;
  h.runtime.emit('pagehide', { persisted: true });
  assert.ok(h.products().length > afterRelease);
  assert.ok(h.products().slice(afterRelease).every(c => c.init.keepalive === true));
  assert.equal(h.sdk.status().queued.product, 0);
});

test('bfcache: persisted pagehide keeps the instance; an ordinary exit disposes it but keeps keepalive handoffs', async () => {
  const h = start();
  h.runtime.hold = true;
  h.runtime.emit('pagehide', { persisted: true });
  assert.equal(h.sdk.resume(), true);
  h.sdk.count('app.ready');
  h.runtime.emit('pagehide', { persisted: false });
  const handed = h.posts();
  assert.ok(handed.length > 0);
  assert.equal(h.sdk.resume(), false);
  assert.ok(handed.every(c => c.aborted === false), 'keepalive handoffs survive an ordinary exit');
  assert.equal(h.runtime.listeners.pagehide.length, 0);
  assert.equal(h.sdk.count('app.ready'), false);
});

test('prop strings: URLs cut to their host, IPv4 and IPv6 masked, identifier keys dropped', async () => {
  const cases = [
    ['see https://user:pw@Example.com:8443/a/b?q=1 now', 'see example.com now'],
    ['ftp://10.0.0.1/file', '[ip]'],
    ['http://[::1]:80/x', '[ip]'],
    ['from 192.168.1.20 via 2001:db8:85a3::8a2e:370:7334', 'from [ip] via [ip]'],
    ['2001:0db8:0000:0000:0000:ff00:0042:8329 and fe80::1 and ::1', '[ip] and [ip] and [ip]'],
    ['at 12:30:45 on 2026-09-26, v1.2.3, note::thing', 'at 12:30:45 on 2026-09-26, v1.2.3, note::thing'],
    ['write to a@b.co', 'write to [email]'],
  ];
  for (const [input, output] of cases) assert.equal(scrubString(input), output, input);
  const props = { userId: 1, uid: 2, clientIp: 3, ip_addr: 4, 'remote-addr': 5, URL: 6, href: 7, link: 'https://x.test/private/path', kept: 1 };
  assert.deepEqual(scrubProps(props), { link: 'x.test', kept: 1 });
  const h = start();
  h.sdk.track('link.opened', props);
  h.fire();
  await settle();
  assert.deepEqual(h.products()[0].body.events.find(e => e.name === 'link.opened').props, { link: 'x.test', kept: 1 });
});
