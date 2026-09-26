// SDK 3.2 (MDviewer#105): no focus steal on cross-tab updates, scroll containers; plus the #129 review LOWs (#131).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard, SDK_VERSION } from '../sdk/pulseboard-sdk.mjs';
import { storedReferrer, validateStatBatch, batchDimensions } from '../src/stat-contract.mjs';
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

test('#133 review: focus inside the notice moves to the pill when a cross-tab update or consent.set removes it', async () => {
  const local = storage();
  const a = start({ region: 'eea', local });
  const b = start({ region: 'eea', local });
  await settle();
  click(byClass(b.body, 'pb-choose')[0]);
  const checkbox = byClass(b.body, 'pb-check')[0];
  checkbox.focus(); // keyboard focus is inside b's bar
  click(byClass(a.body, 'pb-ok')[0]);
  b.runtime.emit('storage', { key: CONSENT });
  assert.equal(b.log.focus, byClass(b.body, 'pb-pill')[0], 'focus is not dropped to body');
  // Same for a host's consent.set while focus sits on the bar's OK button.
  const h = start({ region: 'eea' });
  await settle();
  byClass(h.body, 'pb-ok')[0].focus();
  h.sdk.consent.set({ journeys: false });
  assert.equal(h.log.focus, byClass(h.body, 'pb-pill')[0]);
});

test('#133 review: a marked pane that does not scroll, or reports a non-numeric scrollTop, falls back safely', async () => {
  const flat = start({ scrollPane: true, local: storage({ [CONSENT]: record(false, true, false) }) });
  flat.pane.scrollHeight = 500; // equal to clientHeight: the pane does not scroll, the window does
  flat.runtime.scrollY = 700;
  flat.runtime.emit('scroll');
  flat.runtime.emit('pagehide', { persisted: false });
  await settle();
  assert.equal(events(flat).find(e => e.name === 'page.engaged').props.scroll, 75, 'the window is measured');
  const odd = start({ scrollPane: true, local: storage({ [CONSENT]: record(false, true, false) }) });
  odd.pane.scrollTop = 'weird';
  odd.document.emit('scroll', { target: odd.pane });
  odd.runtime.emit('pagehide', { persisted: false });
  await settle();
  const scroll = events(odd).find(e => e.name === 'page.engaged').props.scroll;
  assert.equal(Number.isFinite(scroll), true);
  assert.equal(scroll, 25, 'a non-numeric scrollTop reads as 0: (0 + 500) / 2000');
});

test('campaign: only a tag registered in projects.mjs is counted, on both sides; none when absent, other otherwise', async () => {
  // Registry: every project declares its tags; none are registered by default.
  for (const [id, project] of Object.entries(projects)) assert.ok(Array.isArray(project.campaigns), id);
  assert.deepEqual(projects.mdviewer.campaigns, []);
  // SDK.
  const cfg = config({ project: { ...config().project, campaigns: ['launch_2026'] } });
  for (const [search, sent] of [['', 'none'], ['?utm_campaign=Launch_2026', 'launch_2026'], ['?utm_campaign=alice_smith', 'other'],
    ['?utm_campaign=has%20space', 'other'], ['?utm_campaign=', 'other']]) {
    const h = makeRuntime({ search, local: storage({ [CONSENT]: record(true, false, false) }) });
    const sdk = createPulseboard(cfg, h.runtime);
    sdk.mount();
    h.fire();
    await settle();
    assert.equal(h.counts()[0].body.context.campaign, sent, search);
  }
  const unregistered = makeRuntime({ search: '?utm_campaign=alice_smith', local: storage({ [CONSENT]: record(true, false, false) }) });
  createPulseboard(config(), unregistered.runtime).mount();
  unregistered.fire();
  await settle();
  assert.equal(unregistered.counts()[0].body.context.campaign, 'other', 'a config without campaigns registers none');
  // Builder: the artifact carries the project's list.
  const built = JSON.parse(/^const config = (\{.*\});$/m.exec(buildSdk('mdviewer'))[1]);
  assert.deepEqual(built.project.campaigns, []);
  // Collector: enforced from the registry, so an older SDK that sends any valid tag is covered too.
  const project = { ...projects.mdviewer, campaigns: ['launch_2026'] };
  const body = campaign => ({ v: 3, context: { device: 'desktop', source: 'other', visit: 'new', scheme: 'light', referrer: 'none', campaign },
    counts: [{ event: 'page.view', route: 'home', release: project.releases[0], n: 1 }] });
  const stored = (campaign, p = project) => Object.fromEntries(batchDimensions(body(campaign), { headers: new Headers() }, Date.UTC(2026, 8, 26), p)).campaign;
  for (const [sent, kept] of [['launch_2026', 'launch_2026'], ['alice_smith', 'other'], ['none', 'none'], ['other', 'other']]) {
    assert.equal(validateStatBatch(body(sent), project), true, sent);
    assert.equal(stored(sent), kept, sent);
  }
  assert.equal(stored('launch_2026', projects.mdviewer), 'other', 'the real registry registers nothing yet');
  assert.equal(stored('launch_2026', null), 'other', 'no project means no registered tags');
});
