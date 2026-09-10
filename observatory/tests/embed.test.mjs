import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';
const DAY = 86400000, settle = () => new Promise(resolve => setImmediate(resolve));
function element(tag) {
  const node = { tag, children: [], listeners: {}, attributes: {}, textContent: '', checked: false,
    append: (...kids) => node.children.push(...kids), setAttribute: (name, value) => { node.attributes[name] = value; },
    addEventListener: (type, fn) => { (node.listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter(f => f !== fn); },
    remove: () => { node.removed = true; }, emit: (type, event) => { for (const fn of [...(node.listeners[type] || [])]) fn(event); } };
  return node;
}
/** A minimal DOM/storage stub: the facade is exercised for real, only the host page is fake. */
function setup({ storage = new Map(), endpoint = 'https://collector.example/v1/collect/mdviewer', clicks = [], navigator = {} } = {}) {
  const created = [], calls = [], document = element('document');
  Object.assign(document, { readyState: 'complete', body: element('body'),
    createElement: tag => { const node = element(tag); created.push(node); return node; }, createTextNode: text => ({ text }) });
  const runtime = Object.assign(element('window'), { document, navigator, crypto, AbortController,
    location: { origin: projects.mdviewer.origin, protocol: 'https:', pathname: '/' },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    fetch: async (...args) => { calls.push(args); return new Response('{}', { status: 202 }); },
    setTimeout: () => 1, clearTimeout: () => {} });
  const p = projects.mdviewer;
  const config = { id: 'mdviewer', project: { events: p.events, routes: p.routes, releases: p.releases, measurements: p.measurements },
    origin: p.origin, endpoint, scopePath: '/', release: 'unattributed', route: 'home', clicks };
  const facade = mountObserver(config, createObserver, runtime);
  return { facade, calls, storage, runtime, document, key: 'pulseboard:consent:v1:mdviewer:' + endpoint,
    checkbox: created.find(node => node.type === 'checkbox') };
}
const grant = async harness => { harness.checkbox.checked = true; harness.checkbox.emit('change'); await settle(); };
const sentEvents = calls => calls.flatMap(call => JSON.parse(call[1].body).events.map(e => e.event));
test('a visitor who has not consented is told nothing was sent, because nothing was', async () => {
  const harness = setup();
  assert.equal(harness.checkbox.checked, false);
  assert.equal(harness.facade.status().active, false);
  assert.equal(harness.facade.track('page.view'), false);
  await harness.facade.flush(); assert.equal(harness.calls.length, 0);
  assert.equal(harness.storage.size, 0);
  harness.facade.dispose();
});
test('granting persists the choice under the project and endpoint key and reports one page view', async () => {
  const harness = setup(); await grant(harness);
  const stored = JSON.parse(harness.storage.get(harness.key));
  assert.equal(stored.allow, true);
  assert.ok(stored.until > Date.now() + 89 * DAY && stored.until <= Date.now() + 90 * DAY);
  assert.deepEqual(sentEvents(harness.calls), ['page.view']);
  // Re-ticking the box is a consent change, not another visit.
  harness.checkbox.checked = false; harness.checkbox.emit('change');
  await grant(harness);
  assert.deepEqual(sentEvents(harness.calls), ['page.view']);
  harness.facade.dispose();
});
test('an expired choice grants nothing and an inflated expiry is capped at 90 days', async () => {
  const expired = setup({ storage: new Map([['pulseboard:consent:v1:mdviewer:https://collector.example/v1/collect/mdviewer', JSON.stringify({ allow: true, until: Date.now() - 1000 })]]) });
  assert.equal(expired.checkbox.checked, false); assert.equal(expired.calls.length, 0);
  expired.facade.dispose();
  const inflated = setup({ storage: new Map([['pulseboard:consent:v1:mdviewer:https://collector.example/v1/collect/mdviewer', JSON.stringify({ allow: true, until: Date.now() + 3650 * DAY })]]) });
  assert.equal(inflated.checkbox.checked, true);
  assert.ok(JSON.parse(inflated.storage.get(inflated.key)).until <= Date.now() + 90 * DAY);
  inflated.facade.dispose();
});
test('withdrawal is recorded and stops emission at once', async () => {
  const harness = setup(); await grant(harness);
  harness.checkbox.checked = false; harness.checkbox.emit('change');
  assert.equal(JSON.parse(harness.storage.get(harness.key)).allow, false);
  assert.equal(harness.facade.track('page.view'), false);
  await harness.facade.flush();
  assert.deepEqual(sentEvents(harness.calls), ['page.view']);
  harness.facade.dispose();
});
test('a reconfigured collector endpoint requires fresh consent', async () => {
  const storage = new Map(), first = setup({ storage });
  await grant(first); first.facade.dispose();
  const moved = setup({ storage, endpoint: 'https://elsewhere.example/v1/collect/mdviewer' });
  assert.equal(moved.checkbox.checked, false); assert.equal(moved.calls.length, 0);
  assert.equal(JSON.parse(storage.get(first.key)).allow, true);
  moved.facade.dispose();
});
test('an invalid click selector cannot throw inside a listener on the host document', async () => {
  const harness = setup({ clicks: [{ selector: ':::not-a-selector', event: 'export.print_requested' }] });
  await grant(harness);
  assert.doesNotThrow(() => harness.document.emit('click', { target: { closest: selector => { throw new SyntaxError(selector); } } }));
  await harness.facade.flush();
  assert.deepEqual(sentEvents(harness.calls), ['page.view']);
  harness.facade.dispose();
});
test('a tracked click that navigates away is handed over on pagehide', async () => {
  const harness = setup({ clicks: [{ selector: '.print', event: 'export.print_requested' }] });
  await grant(harness);
  harness.document.emit('click', { target: { closest: selector => selector === '.print' } });
  harness.runtime.emit('pagehide', {});
  assert.deepEqual(sentEvents(harness.calls), ['page.view', 'export.print_requested']);
  assert.equal(harness.calls[1][1].keepalive, true);
  assert.equal(harness.calls[1][1].credentials, 'omit');
  assert.equal(harness.facade.status().active, false);
});
test('privacy signals keep the control from mounting at all', () => {
  assert.equal(setup({ navigator: { globalPrivacyControl: true } }).facade, null);
  assert.equal(setup({ navigator: { doNotTrack: '1' } }).facade, null);
  assert.equal(setup({ navigator: { webdriver: true } }).facade, null);
});
