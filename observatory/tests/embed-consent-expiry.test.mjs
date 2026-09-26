import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
const endpoint = 'https://collector.example/v1/collect/mdviewer';

function element(tag) {
  const node = {
    tag, children: [], listeners: {}, attributes: {}, textContent: '', checked: false, disabled: false,
    append: (...children) => node.children.push(...children),
    setAttribute: (name, value) => { node.attributes[name] = value; },
    addEventListener: (type, fn) => { (node.listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter(item => item !== fn); },
    remove: () => { node.removed = true; },
    emit: (type, event = {}) => { for (const fn of [...(node.listeners[type] || [])]) fn(event); },
  };
  return node;
}

function setup(until) {
  const created = [], calls = [], timers = new Map(), document = element('document');
  let nextTimer = 1;
  const storage = new Map([['pulseboard:consent:v1:mdviewer:' + endpoint, JSON.stringify({ allow: true, until })]]);
  Object.assign(document, {
    body: element('body'),
    createElement: tag => { const node = element(tag); created.push(node); return node; },
    createTextNode: text => ({ text }),
  });
  const runtime = Object.assign(element('window'), {
    document, navigator: {}, crypto, AbortController,
    location: { origin: projects.mdviewer.origin, protocol: 'https:', pathname: '/' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    fetch: async (...args) => { calls.push(args); return new Response('{}', { status: 202 }); },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
  });
  const project = projects.mdviewer;
  const facade = mountObserver({
    id: 'mdviewer',
    project: { events: project.events, routes: project.routes, releases: project.releases, measurements: project.measurements },
    origin: project.origin, endpoint, scopePath: '/', release: 'unattributed', route: 'home',
  }, createObserver, runtime);
  return {
    facade, calls, timers,
    checkbox: created.find(node => node.type === 'checkbox'),
    status: created.find(node => node.attributes.role === 'status'),
  };
}

test('a stored grant expiring while the tab stays open stops the next flush and repaints', async t => {
  const start = Date.now(), harness = setup(start + 60000);
  await settle();
  assert.equal(harness.facade.status().active, true);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.facade.track('export.print_requested'), true);

  t.mock.method(Date, 'now', () => start + 60001);
  const [id, timer] = [...harness.timers.entries()].find(([, entry]) => entry.ms === 5000);
  harness.timers.delete(id); timer.fn();
  await settle();

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.facade.status().active, false);
  assert.equal(harness.facade.status().queued, 0);
  assert.equal(harness.checkbox.checked, false);
  assert.match(harness.status.textContent, /Sharing is off/);
  assert.equal(harness.facade.track('page.view'), false);
  harness.facade.dispose();
});
