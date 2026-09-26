import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPulseboard } from '../sdk/pulseboard-sdk.mjs';
import { config, makeRuntime, storage, byClass, text, walk, settle } from './sdk-fakes.mjs';

const CONSENT = 'pulseboard:consent:v3:demo';
const start = (options = {}, cfg = config()) => {
  const h = makeRuntime(options);
  const sdk = createPulseboard(cfg, h.runtime);
  sdk.mount();
  return { ...h, sdk };
};
const click = node => node.emit('click');

test('EEA default: counts only, bar first in body, region cached, diagnostics and journeys wait for OK', async () => {
  const h = start({ region: 'eea' });
  await settle();
  assert.equal(h.body.children[0].className, 'pb-bar');
  assert.equal(h.body.children[0].attributes.role, 'region');
  assert.match(h.body.children[0].attributes['aria-label'], /Demo/);
  assert.equal(text(h.body.children[0]).includes('Beta — thanks for helping test Demo. We collect usage and diagnostics to improve it; no names, emails or IPs.'), true);
  const consent = h.sdk.consent.get();
  assert.deepEqual([consent.counts, consent.diagnostics, consent.journeys, consent.decided, consent.region], [true, false, false, false, 'eea']);
  assert.equal(h.runtime.sessionStorage.map.get('pulseboard:region:demo'), 'eea');
  assert.equal(h.calls[0].url, 'https://collector.example/v1/consent/demo');
  assert.equal(h.calls[0].init.credentials, 'omit');
  assert.equal(h.sdk.track('thing.done', {}), false, 'journeys off in the EEA until OK');
  assert.equal(h.log.order[0], 'dom', 'notice before any request');
});

test('outside the EEA every category is on; a cached region skips the hint request', async () => {
  const h = start({ region: 'other' });
  await settle();
  assert.deepEqual(Object.values(h.sdk.consent.get()).slice(0, 3), [true, true, true]);
  assert.equal(h.sdk.track('thing.done', { level: 2 }), true);
  const cached = start({ region: 'fail', session: storage({ 'pulseboard:region:demo': 'other' }) });
  await settle();
  assert.equal(cached.calls.filter(c => c.url.includes('/v1/consent/')).length, 0);
  assert.equal(cached.sdk.consent.get().journeys, true);
});

test('an unknown, pending or failed region means EEA and is not cached', async () => {
  for (const region of ['fail', 'pending']) {
    const h = start({ region });
    await settle();
    const c = h.sdk.consent.get();
    assert.deepEqual([c.counts, c.diagnostics, c.journeys], [true, false, false], region);
    assert.equal(h.runtime.sessionStorage.map.has('pulseboard:region:demo'), false, region);
  }
  const malformed = makeRuntime({ region: 'mars' });
  const sdk = createPulseboard(config(), malformed.runtime);
  sdk.mount();
  await settle();
  assert.equal(sdk.consent.get().diagnostics, false);
});

test('GPC and DNT turn everything off silently: pill only, no request of any kind, switches disabled', async () => {
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const h = start({ region: 'other', nav });
    await settle();
    assert.equal(byClass(h.body, 'pb-bar').length, 0);
    assert.equal(byClass(h.body, 'pb-pill').length, 1);
    assert.equal(h.calls.length, 0);
    assert.equal(h.sdk.count('app.ready'), false);
    const c = h.sdk.consent.get();
    assert.deepEqual([c.counts, c.diagnostics, c.journeys, c.blocked], [false, false, false, true]);
    click(byClass(h.body, 'pb-pill')[0]);
    const checks = byClass(h.body, 'pb-check');
    assert.equal(checks.length, 3);
    assert.ok(checks.every(input => input.disabled && !input.checked));
    assert.match(text(h.body), /Global Privacy Control or Do Not Track/);
  }
});

test('a privacy signal that appears later revokes queued work', async () => {
  const h = start({ region: 'other' });
  await settle();
  assert.equal(h.sdk.count('app.ready'), true);
  h.runtime.navigator.globalPrivacyControl = true;
  h.fire();
  await settle();
  assert.equal(h.posts().length, 0);
  assert.equal(h.sdk.status().queued.counts, 0);
});

test('OK records every category, collapses to a focused Beta pill and in the EEA turns on diagnostics and journeys', async () => {
  const h = start({ region: 'eea' });
  await settle();
  click(byClass(h.body, 'pb-ok')[0]);
  const record = JSON.parse(h.runtime.localStorage.map.get(CONSENT));
  assert.deepEqual(Object.keys(record).sort(), ['counts', 'decided', 'diagnostics', 'journeys', 'month']);
  assert.deepEqual([record.counts, record.diagnostics, record.journeys, record.decided], [true, true, true, true]);
  assert.match(record.month, /^\d{4}-\d{2}$/);
  assert.equal(byClass(h.body, 'pb-bar').length, 0);
  const pill = byClass(h.body, 'pb-pill')[0];
  assert.equal(pill.textContent, 'Beta');
  assert.equal(pill.tagName, 'BUTTON');
  assert.equal(pill.style.position, 'fixed');
  assert.equal(pill.style.left, '12px');
  assert.equal(h.log.focus, pill);
  assert.equal(h.sdk.track('thing.done'), true);
  // A later page load honours the recorded decision without a bar or region request.
  const next = start({ region: 'fail', local: h.runtime.localStorage });
  await settle();
  assert.equal(byClass(next.body, 'pb-bar').length, 0);
  assert.equal(next.calls.filter(c => c.url.includes('/v1/consent/')).length, 0);
  assert.equal(next.sdk.consent.get().journeys, true);
});

test('Choose opens described switches in place; Save records exactly the chosen categories', async () => {
  const h = start({ region: 'eea' });
  await settle();
  const choose = byClass(h.body, 'pb-choose')[0];
  click(choose);
  assert.equal(choose.attributes['aria-expanded'], 'true');
  const checks = byClass(h.body, 'pb-check');
  assert.deepEqual(checks.map(c => c.type), ['checkbox', 'checkbox', 'checkbox']);
  assert.deepEqual(checks.map(c => c.checked), [true, false, false]);
  const body = text(h.body);
  for (const phrase of ['Usage counts', 'Aggregate page and feature counts.', 'Diagnostics', 'Speed, errors and time on page.',
    'Journeys and product data', 'The order of steps within one visit, and product events.']) assert.ok(body.includes(phrase), phrase);
  assert.equal(h.log.focus, checks[0]);
  checks[1].checked = true;
  click(byClass(h.body, 'pb-save')[0]);
  const record = JSON.parse(h.runtime.localStorage.map.get(CONSENT));
  assert.deepEqual([record.counts, record.diagnostics, record.journeys], [true, true, false]);
  assert.equal(byClass(h.body, 'pb-bar').length, 0);
  assert.equal(byClass(h.body, 'pb-pill').length, 1);
  // The pill reopens the switches with the recorded state; Escape closes and returns focus.
  const pill = byClass(h.body, 'pb-pill')[0];
  click(pill);
  assert.equal(pill.attributes['aria-expanded'], 'true');
  assert.deepEqual(byClass(h.body, 'pb-check').map(c => c.checked), [true, true, false]);
  assert.equal(byClass(h.body, 'pb-off').length, 1, 'the pill panel carries Turn all off too');
  byClass(h.body, 'pb-panel')[0].emit('keydown', { key: 'Escape' });
  assert.equal(byClass(h.body, 'pb-panel').length, 0);
  assert.equal(h.log.focus, pill);
});

test('Turn all off records every category off, clears every local key and drops queued work', async () => {
  const h = start({ region: 'other' });
  await settle();
  h.sdk.track('thing.done', { a: 1 });
  h.fire();
  await settle();
  assert.ok(h.runtime.localStorage.map.has('pulseboard:visit:demo'));
  assert.ok(h.runtime.sessionStorage.map.has('pulseboard:visit:demo'));
  assert.ok(h.runtime.sessionStorage.map.has('pulseboard:session:demo'));
  h.sdk.count('app.ready');
  h.sdk.track('thing.done', { a: 2 });
  click(byClass(h.body, 'pb-choose')[0]);
  click(byClass(h.body, 'pb-off')[0]);
  const record = JSON.parse(h.runtime.localStorage.map.get(CONSENT));
  assert.deepEqual([record.counts, record.diagnostics, record.journeys, record.decided], [false, false, false, true]);
  for (const key of ['pulseboard:visit:demo']) assert.equal(h.runtime.localStorage.map.has(key), false);
  for (const key of ['pulseboard:visit:demo', 'pulseboard:session:demo']) assert.equal(h.runtime.sessionStorage.map.has(key), false);
  assert.deepEqual(h.sdk.status().queued, { counts: 0, product: 0 });
  const before = h.posts().length;
  h.fire();
  runtimeHide(h);
  assert.equal(h.posts().length, before, 'nothing leaves after opting out');
});

function runtimeHide(h) { h.runtime.emit('pagehide', { persisted: true }); }

test('switching one category off clears only its keys, drops only its queue and aborts its in-flight request', async () => {
  const h = start({ region: 'other' });
  await settle();
  h.runtime.hold = true;
  h.sdk.count('app.ready');
  h.sdk.track('thing.done', { step: 1 });
  h.fire();
  await settle();
  const countFlight = h.counts()[0], productFlight = h.products()[0];
  assert.ok(countFlight && productFlight);
  h.sdk.count('app.ready');
  h.sdk.track('thing.done', { step: 2 });
  h.sdk.consent.set({ journeys: false });
  assert.equal(productFlight.aborted, true, 'journeys request cancelled');
  assert.equal(countFlight.aborted, false, 'counts request untouched');
  assert.equal(h.runtime.sessionStorage.map.has('pulseboard:session:demo'), false);
  assert.ok(h.runtime.localStorage.map.has('pulseboard:visit:demo'));
  assert.deepEqual(h.sdk.status().queued, { counts: 1, product: 0 });
  h.sdk.consent.set({ counts: false });
  assert.equal(countFlight.aborted, true);
  assert.equal(h.runtime.localStorage.map.has('pulseboard:visit:demo'), false);
  assert.equal(h.sdk.status().queued.counts, 0);
});

test('visit marker: EEA before a decision sends new and stores nothing; after OK it stores only a month', async () => {
  const h = start({ region: 'eea' });
  await settle();
  h.fire();
  await settle();
  assert.equal(h.counts()[0].body.context.visit, 'new');
  assert.equal(h.runtime.localStorage.map.has('pulseboard:visit:demo'), false);
  assert.equal(h.runtime.sessionStorage.map.has('pulseboard:visit:demo'), false);
  click(byClass(h.body, 'pb-ok')[0]);
  h.sdk.count('app.ready');
  h.fire();
  await settle();
  assert.match(h.runtime.localStorage.map.get('pulseboard:visit:demo'), /^\d{4}-(0[1-9]|1[0-2])$/);
  assert.equal(h.runtime.sessionStorage.map.get('pulseboard:visit:demo'), 'new');
});

test('visit marker outside the EEA: new, then returning in a later tab, new again after a year', async () => {
  const local = storage();
  const first = start({ region: 'other', local });
  await settle();
  first.fire();
  await settle();
  assert.equal(first.counts()[0].body.context.visit, 'new');
  const second = start({ region: 'other', local });
  await settle();
  second.fire();
  await settle();
  assert.equal(second.counts()[0].body.context.visit, 'returning');
  const now = new Date();
  const old = (now.getUTCFullYear() - 2) + '-01';
  const stale = start({ region: 'other', local: storage({ 'pulseboard:visit:demo': old }) });
  await settle();
  stale.fire();
  await settle();
  assert.equal(stale.counts()[0].body.context.visit, 'new');
});

test('a corrupt stored choice is all-off and shows the bar again; refused storage keeps the choice for the page only', async () => {
  const h = start({ region: 'other', local: storage({ [CONSENT]: '{"counts":true}' }) });
  await settle();
  assert.deepEqual(Object.values(h.sdk.consent.get()).slice(0, 4), [false, false, false, false]);
  assert.equal(byClass(h.body, 'pb-bar').length, 1);
  const refusing = storage();
  refusing.setItem = () => { throw new Error('quota'); };
  const r = start({ region: 'eea', local: refusing });
  await settle();
  click(byClass(r.body, 'pb-ok')[0]);
  assert.equal(r.sdk.consent.get().journeys, true);
  assert.equal(r.sdk.consent.get().decided, true);
});

test('ineligible pages stay inert: other origin, plain http, webdriver, bad config', async () => {
  const cases = [
    makeRuntime({ origin: 'https://elsewhere.example' }),
    makeRuntime({ origin: 'http://product.example' }),
    makeRuntime({ nav: { webdriver: true } }),
  ];
  for (const h of cases) {
    const cfg = h.runtime.location.protocol === 'http:' ? config({ origin: 'http://product.example' }) : config();
    const sdk = createPulseboard(cfg, h.runtime);
    assert.equal(sdk.mount(), false);
    assert.equal(sdk.count('app.ready'), false);
    await settle();
    assert.equal(h.calls.length, 0);
    assert.equal(h.body.children.length, 0);
  }
  for (const bad of [config({ collector: 'http://collector.example' }), config({ collector: 'https://collector.example/path' }), config({ id: 'Bad Id' }), config({ label: '' })]) {
    const h = makeRuntime();
    const sdk = createPulseboard(bad, h.runtime);
    assert.equal(sdk.mount(), false);
    assert.equal(sdk.consent.get().blocked, true);
  }
});

test('the notice is built without HTML parsing and styled only through element.style', async () => {
  const h = start({ region: 'eea' });
  await settle();
  click(byClass(h.body, 'pb-choose')[0]);
  click(byClass(h.body, 'pb-save')[0]);
  click(byClass(h.body, 'pb-pill')[0]);
  assert.equal(h.log.html, 0);
  const nodes = walk(h.body).slice(1);
  assert.ok(nodes.every(n => !('style' in n.attributes)), 'no style attribute (blocked by strict CSP)');
  assert.ok(nodes.every(n => n.tagName !== 'STYLE'), 'no <style> element');
  assert.ok(nodes.filter(n => n.className).every(n => n.className.split(' ').every(c => c.startsWith('pb-'))));
  assert.ok(byClass(h.body, 'pb-save').every(b => b.tagName === 'BUTTON' && b.type === 'button'));
  const source = readFileSync(new URL('../sdk/pulseboard-sdk.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', "'style'", 'cssText', 'transition', 'animation']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('a host slot receives the pill and panel inline instead of fixed positioning', async () => {
  const h = start({ region: 'eea', slot: true, local: storage({ [CONSENT]: JSON.stringify({ counts: true, diagnostics: false, journeys: false, decided: true, month: '2026-09' }) }) });
  await settle();
  const pill = byClass(h.slot, 'pb-pill')[0];
  assert.ok(pill);
  assert.equal(pill.style.position, undefined);
  h.sdk.consent.open();
  assert.equal(byClass(h.slot, 'pb-panel').length, 1);
});

test('consent.set and consent.open work through the API and never throw', async () => {
  const h = start({ region: 'eea' });
  await settle();
  assert.equal(h.sdk.consent.open(), true);
  assert.equal(byClass(h.body, 'pb-switches').length, 1);
  const result = h.sdk.consent.set({ diagnostics: true, journeys: 'yes' });
  assert.deepEqual([result.counts, result.diagnostics, result.journeys, result.decided], [true, true, false, true]);
  assert.equal(byClass(h.body, 'pb-bar').length, 0, 'a recorded decision collapses the bar');
  assert.doesNotThrow(() => h.sdk.consent.set(null));
  assert.doesNotThrow(() => h.sdk.consent.set({ get counts() { throw new Error('x'); } }));
});
