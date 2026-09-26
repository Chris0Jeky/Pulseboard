// SDK 3.1 (CommitAtlas#247): allowlisted referrer domains on both sides, the host's start route, and
// buffering of Journeys and Diagnostics items while the region hint is pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard, classifyReferrer, SDK_VERSION } from '../sdk/pulseboard-sdk.mjs';
import { referrerDomain, REFERRER_DOMAINS } from '../sdk/referrers.mjs';
import { batchDimensions, validateStatBatch } from '../src/stat-contract.mjs';
import { buildSdk } from '../adapters/build-sdk.mjs';
import { projects } from '../src/projects.mjs';
import { config, makeRuntime, storage, byClass, settle, ORIGIN } from './sdk-fakes.mjs';

const CONSENT = 'pulseboard:consent:v3:demo';
const record = (counts, diagnostics, journeys) => JSON.stringify({ counts, diagnostics, journeys, decided: true, month: '2026-09' });
const mountWith = (options = {}, dataset = null) => {
  const h = makeRuntime(options);
  if (dataset) h.document.documentElement.dataset = dataset;
  const sdk = createPulseboard(config(), h.runtime);
  sdk.mount();
  return { ...h, sdk };
};
const events = h => h.products().flatMap(c => c.body.events);

test('3.1: SDK_VERSION is 3.1.0 and the artifact header says so', () => {
  assert.equal(SDK_VERSION, '3.1.0');
  assert.match(buildSdk('mdviewer'), /pulseboard-sdk 3\.1\.0 for mdviewer/);
});

test('referrer: only allowlisted platform domains leave the browser, collapsed to one canonical value', () => {
  const rows = [
    ['https://jane.github.io/blog/', 'github', 'github.io'],
    ['https://janedoe.com/about', 'other', 'other'],
    ['https://www.google.co.uk/search?q=x', 'search', 'google.com'],
    ['https://news.google.com/', 'search', 'google.com'],
    ['https://google.de/', 'search', 'google.com'],
    ['https://evilgoogle.com/', 'other', 'other'],
    ['https://google.evil.example/', 'other', 'other'],
    ['https://www.bing.com/', 'search', 'bing.com'],
    ['https://duckduckgo.com/', 'search', 'duckduckgo.com'],
    ['https://search.yahoo.com/', 'search', 'yahoo.com'],
    ['https://www.ecosia.org/', 'search', 'ecosia.org'],
    ['https://search.brave.com/', 'search', 'brave.com'],
    ['https://yandex.ru/', 'search', 'yandex.com'],
    ['https://www.baidu.com/', 'search', 'baidu.com'],
    ['https://t.co/abc', 'social', 'x.com'],
    ['https://mobile.twitter.com/a', 'social', 'x.com'],
    ['https://x.com/a/status/1', 'social', 'x.com'],
    ['https://l.facebook.com/l.php?u=x', 'social', 'facebook.com'],
    ['https://l.instagram.com/', 'social', 'instagram.com'],
    ['https://lnkd.in/abc', 'social', 'linkedin.com'],
    ['https://www.linkedin.com/feed', 'social', 'linkedin.com'],
    ['https://old.reddit.com/r/x', 'social', 'reddit.com'],
    ['https://news.ycombinator.com/item?id=1', 'social', 'news.ycombinator.com'],
    ['https://ycombinator.com/', 'other', 'other'],
    ['https://lobste.rs/s/x', 'social', 'lobste.rs'],
    ['https://mastodon.social/@jane', 'social', 'mastodon.social'],
    ['https://jane.mastodon.example/', 'other', 'other'],
    ['https://bsky.app/profile/jane', 'social', 'bsky.app'],
    ['https://m.youtube.com/watch', 'social', 'youtube.com'],
    ['https://www.tiktok.com/@jane', 'social', 'tiktok.com'],
    ['https://discord.com/channels/1', 'social', 'discord.com'],
    ['https://janeco.slack.com/archives/1', 'social', 'slack.com'],
    ['https://jane.medium.com/post', 'social', 'medium.com'],
    ['https://dev.to/jane/post', 'social', 'dev.to'],
    ['https://www.producthunt.com/posts/x', 'social', 'producthunt.com'],
    ['https://github.com/jane/repo', 'github', 'github.com'],
    ['https://gist.github.com/jane/1', 'github', 'github.com'],
    ['https://gitlab.com/jane/repo', 'other', 'gitlab.com'],
    ['https://stackoverflow.com/q/1', 'other', 'stackoverflow.com'],
    ['', 'direct', 'none'],
    [ORIGIN + '/x', 'internal', 'none'],
    ['not a url', 'other', 'other'],
  ];
  for (const [referrer, source, domain] of rows) assert.deepEqual(classifyReferrer(referrer, ORIGIN), { source, referrer: domain }, referrer);
  // Every canonical value is itself on the allowlist and maps to itself.
  for (const domain of REFERRER_DOMAINS) assert.equal(referrerDomain(domain), domain, domain);
});

test('collector: an off-list referrer is stored as `other`, a known host collapses, sentinels stay', () => {
  const project = projects.mdviewer;
  const body = referrer => ({ v: 3, context: { device: 'desktop', source: 'other', visit: 'new', scheme: 'light', referrer, campaign: 'none' },
    counts: [{ event: 'page.view', route: 'home', release: project.releases[0], n: 1 }] });
  const stored = referrer => Object.fromEntries(batchDimensions(body(referrer), { headers: new Headers() }, Date.UTC(2026, 8, 26))).referrer;
  // Older 3.0 builds send bare hosts; they are still admitted but never stored as sent.
  for (const [sent, kept] of [['janedoe.com', 'other'], ['jane.github.io', 'github.io'], ['www.google.co.uk', 'google.com'],
    ['news.ycombinator.com', 'news.ycombinator.com'], ['github.com', 'github.com'], ['none', 'none'], ['other', 'other']]) {
    assert.equal(validateStatBatch(body(sent), project), true, sent);
    assert.equal(stored(sent), kept, sent);
  }
  assert.equal(validateStatBatch(body('Not A Host'), project), false, 'the shape check is unchanged');
});

test('the artifact inlines the one shared allowlist', () => {
  const code = buildSdk('mdviewer');
  assert.ok(code.includes('news.ycombinator.com') && code.includes('stackoverflow.com'));
  assert.deepEqual(code.split('\n').filter(line => /^(?:import|export)\b/.test(line)), []);
});

test('start route: <html data-pulseboard-route> names the first page.view when it is registered', async () => {
  const h = mountWith({ local: storage({ [CONSENT]: record(true, false, true) }) }, { pulseboardRoute: 'puzzle' });
  h.fire();
  await settle();
  assert.deepEqual(h.counts()[0].body.counts.map(c => c.route), ['puzzle']);
  assert.deepEqual(events(h).filter(e => e.name === 'page.view').map(e => e.route), ['puzzle']);
  const unknown = mountWith({ local: storage({ [CONSENT]: record(true, false, false) }) }, { pulseboardRoute: 'nope' });
  unknown.fire();
  await settle();
  assert.deepEqual(unknown.counts()[0].body.counts.map(c => c.route), ['home'], 'an unregistered start route is ignored');
  // A route() before mount wins over the attribute.
  const early = makeRuntime({ local: storage({ [CONSENT]: record(true, false, false) }) });
  early.document.documentElement.dataset = { pulseboardRoute: 'puzzle' };
  const sdk = createPulseboard(config(), early.runtime);
  sdk.route('other');
  sdk.mount();
  early.fire();
  await settle();
  assert.equal(early.counts()[0].body.counts.at(-1).route, 'other');
});

test('pre-region: track and errors are buffered while the hint is pending, then sent outside the EEA', async () => {
  const h = makeRuntime({ region: 'other' });
  const sdk = createPulseboard(config(), h.runtime);
  assert.equal(sdk.track('early.step', { n: 1 }), true, 'buffered before mount');
  sdk.mount();
  assert.equal(sdk.track('step.two'), true, 'buffered while the hint is in flight');
  h.runtime.emit('error', { message: 'early boom', filename: 'a.js', lineno: 3 });
  await settle(); // the hint answers `other`
  h.fire();
  await settle();
  const names = events(h).map(e => e.name);
  for (const name of ['early.step', 'step.two', 'js.error', 'page.view']) assert.ok(names.includes(name), name);
  const seqs = events(h).map(e => e.seq);
  assert.equal(new Set(seqs).size, seqs.length);
  assert.ok(h.products().every(c => typeof c.body.session === 'string'));
});

test('pre-region: buffered items are dropped when the hint says EEA or fails, and never exceed the queue cap', async () => {
  for (const region of ['eea', 'fail']) {
    const h = mountWith({ region });
    assert.equal(h.sdk.track('step'), true);
    h.runtime.emit('error', { message: 'x', filename: 'a.js', lineno: 1 });
    await settle();
    h.fire();
    await settle();
    assert.equal(h.products().length, 0, region);
    assert.equal(h.sdk.status().queued.product, 0, region);
    assert.equal(h.sdk.track('late'), false, region + ': journeys off after the answer');
  }
  const capped = mountWith({ region: 'pending' });
  let accepted = 0;
  for (let i = 0; i < 150; i++) if (capped.sdk.track('step', { i })) accepted += 1;
  assert.ok(accepted <= 100 - capped.sdk.status().queued.counts, 'buffer shares the 100-item queue cap');
  // An OK before the hint answers releases the buffer under the recorded choice.
  const ok = mountWith({ region: 'pending' });
  ok.sdk.track('before.ok');
  byClass(ok.body, 'pb-ok')[0].emit('click');
  ok.fire();
  await settle();
  assert.ok(events(ok).some(e => e.name === 'before.ok'));
});

test('pre-region: nothing is buffered under GPC, after a decision, or with a cached region', async () => {
  const gpc = mountWith({ region: 'pending', nav: { globalPrivacyControl: true } });
  assert.equal(gpc.sdk.track('x'), false);
  const decided = mountWith({ region: 'pending', local: storage({ [CONSENT]: record(true, false, false) }) });
  assert.equal(decided.sdk.track('x'), false);
  const cached = mountWith({ region: 'pending', session: storage({ 'pulseboard:region:demo': 'eea' }) });
  assert.equal(cached.sdk.track('x'), false);
});
