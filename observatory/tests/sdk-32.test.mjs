// SDK 3.2 (MDviewer#105): no focus steal on cross-tab updates, scroll containers; plus the #129 review LOWs (#131).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard, SDK_VERSION } from '../sdk/pulseboard-sdk.mjs';
import { storedReferrer, validateStatBatch } from '../src/stat-contract.mjs';
import { buildSdk } from '../adapters/build-sdk.mjs';
import { projects } from '../src/projects.mjs';
import { config, makeRuntime, storage, byClass, settle } from './sdk-fakes.mjs';

const CONSENT = 'pulseboard:consent:v3:demo';
const record = (counts, diagnostics, journeys) => JSON.stringify({ counts, diagnostics, journeys, decided: true, month: '2026-09' });
const start = (options = {}) => {
  const h = makeRuntime(options);
  const sdk = createPulseboard(config(), h.runtime);
  sdk.mount();
  return { ...h, sdk };
};
const events = h => h.products().flatMap(c => c.body.events);
const click = node => node.emit('click');

test('3.2: SDK_VERSION is 3.2.0 and the artifact header says so', () => {
  assert.equal(SDK_VERSION, '3.2.0');
  assert.match(buildSdk('mdviewer'), /pulseboard-sdk 3\.2\.0 for mdviewer/);
});

test('a choice recorded in another tab never moves focus here, even when it collapses the bar', async () => {
  const local = storage();
  const a = start({ region: 'eea', local });
  const b = start({ region: 'eea', local });
  await settle();
  const typing = { tag: 'host-input' };
  b.log.focus = typing;
  click(byClass(a.body, 'pb-ok')[0]);
  b.runtime.emit('storage', { key: CONSENT });
  assert.equal(byClass(b.body, 'pb-bar').length, 0, 'the bar still collapses');
  assert.equal(byClass(b.body, 'pb-pill').length, 1);
  assert.equal(b.log.focus, typing, 'focus stays in the host app');
  // With the pill panel open, a cross-tab update repaints it but does not move focus either.
  click(byClass(b.body, 'pb-pill')[0]);
  b.log.focus = typing;
  local.map.set(CONSENT, record(true, false, false));
  b.runtime.emit('storage', { key: CONSENT });
  assert.equal(b.log.focus, typing);
  assert.deepEqual(byClass(b.body, 'pb-check').map(c => c.checked), [true, false, false]);
});

test('host code calling consent.set does not move focus; the visitor clicking OK or Escape still does', async () => {
  const h = start({ region: 'eea' });
  await settle();
  const typing = { tag: 'host-input' };
  h.log.focus = typing;
  h.sdk.consent.set({ journeys: false });
  assert.equal(byClass(h.body, 'pb-bar').length, 0);
  assert.equal(h.log.focus, typing);
  const pill = byClass(h.body, 'pb-pill')[0];
  click(pill);
  byClass(h.body, 'pb-panel')[0].emit('keydown', { key: 'Escape' });
  assert.equal(h.log.focus, pill, 'closing the panel you opened returns focus to the pill');
  const ok = start({ region: 'eea' });
  await settle();
  click(byClass(ok.body, 'pb-ok')[0]);
  assert.equal(ok.log.focus, byClass(ok.body, 'pb-pill')[0]);
});

test('page.engaged measures a host-marked [data-pulseboard-scroll] container instead of the window', async () => {
  const h = start({ scrollPane: true, local: storage({ [CONSENT]: record(false, true, false) }) });
  h.document.documentElement.scrollHeight = 800; // an app shell: the window itself never scrolls
  h.pane.scrollTop = 500;
  h.document.emit('scroll', { target: h.pane });
  h.pane.scrollTop = 100;
  h.document.emit('scroll', { target: h.pane });
  h.runtime.emit('pagehide', { persisted: false });
  await settle();
  assert.equal(events(h).find(e => e.name === 'page.engaged').props.scroll, 50, '(500 + 500) / 2000, the deepest point');
  const plain = start({ local: storage({ [CONSENT]: record(false, true, false) }) });
  plain.runtime.scrollY = 700;
  plain.runtime.emit('scroll');
  plain.runtime.emit('pagehide', { persisted: false });
  await settle();
  assert.equal(events(plain).find(e => e.name === 'page.engaged').props.scroll, 75, 'the window without a marked container');
});

test('#131: items buffered before the region answers are dropped by Turn all off and by Save without Journeys', async () => {
  const off = start({ region: 'pending' });
  assert.equal(off.sdk.track('early'), true);
  click(byClass(off.body, 'pb-choose')[0]);
  click(byClass(off.body, 'pb-off')[0]);
  off.fire();
  await settle();
  assert.equal(off.products().length, 0);
  const save = start({ region: 'pending' });
  save.sdk.track('early.journey');
  save.runtime.emit('error', { message: 'early error', filename: 'a.js', lineno: 1 });
  click(byClass(save.body, 'pb-choose')[0]);
  const checks = byClass(save.body, 'pb-check');
  checks[1].checked = true; // Diagnostics on, Journeys left unchecked
  click(byClass(save.body, 'pb-save')[0]);
  save.fire();
  await settle();
  const names = events(save).map(e => e.name);
  assert.equal(names.includes('early.journey'), false);
  assert.ok(names.includes('js.error'));
  assert.ok(save.products().every(c => c.body.session === null));
});

test('#131: only errors actually queued for sending count against the ten-error page cap', async () => {
  const h = start({ region: 'fail' });
  for (let i = 0; i < 12; i++) h.runtime.emit('error', { message: 'buffered ' + i, filename: 'a.js', lineno: i });
  await settle(); // the hint fails: EEA, and every buffered error is dropped
  assert.equal(h.sdk.status().queued.product, 0);
  click(byClass(h.body, 'pb-ok')[0]);
  for (let i = 0; i < 12; i++) h.runtime.emit('error', { message: 'after ok ' + i, filename: 'a.js', lineno: i });
  h.fire();
  await settle();
  const errors = events(h).filter(e => e.name === 'js.error');
  assert.equal(errors.length, 10);
  assert.ok(errors.every(e => e.props.message.startsWith('after ok')));
});

test('#131: hostile referrer values on the collector side', () => {
  for (const [sent, kept] of [['github.io.evil.com', 'other'], ['evilgithub.io', 'other'], ['google.com.attacker.net', 'other'],
    ['github.com.', 'github.com'], ['192.168.1.1', 'other'], ['10.0.0.1', 'other'], ['xn--ggle-0nda.com', 'other'], ['t.co.evil.net', 'other']]) {
    assert.equal(storedReferrer(sent), kept, sent);
  }
  const project = projects.mdviewer;
  const body = referrer => ({ v: 3, context: { device: 'desktop', source: 'other', visit: 'new', scheme: 'light', referrer, campaign: 'none' },
    counts: [{ event: 'page.view', route: 'home', release: project.releases[0], n: 1 }] });
  for (const bad of ['GitHub.com', 'github.com:443', 'github.com/path', '[::1]', 'a'.repeat(70) + '.com']) assert.equal(validateStatBatch(body(bad), project), false, bad);
  for (const ok of ['github.io.evil.com', '192.168.1.1', 'github.com.']) assert.equal(validateStatBatch(body(ok), project), true, ok + ' is admitted, then stored safely');
});
