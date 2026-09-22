import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

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

function setup() {
  const created = [], timers = new Map(), document = element('document');
  let nextTimer = 1;
  Object.assign(document, {
    body: element('body'),
    createElement: tag => { const node = element(tag); created.push(node); return node; },
    createTextNode: text => ({ text }),
  });
  const runtime = Object.assign(element('window'), {
    document,
    navigator: {},
    crypto,
    AbortController,
    location: { origin: projects.mdviewer.origin, protocol: 'https:', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => new Response('{}', { status: 202 }),
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
  });
  const project = projects.mdviewer;
  const facade = mountObserver({
    id: 'mdviewer',
    project: { events: project.events, routes: project.routes, releases: project.releases, measurements: project.measurements },
    origin: project.origin,
    endpoint: 'https://collector.example/v1/collect/mdviewer',
    scopePath: '/',
    release: 'unattributed',
    route: 'home',
  }, createObserver, runtime);
  return {
    facade, runtime, timers,
    checkbox: created.find(node => node.type === 'checkbox'),
    status: created.find(node => node.attributes.role === 'status'),
  };
}

function fireNextFiveSecondTimer(harness) {
  const entry = [...harness.timers.entries()].find(([, timer]) => timer.ms === 5000);
  assert.ok(entry, 'expected a scheduled observer flush');
  const [id, timer] = entry;
  harness.timers.delete(id);
  timer.fn();
}

test('scheduled flush repaints when a privacy signal self-revokes the observer', async () => {
  const harness = setup();
  harness.checkbox.checked = true;
  harness.checkbox.emit('change');
  await settle();

  // Drain the harmless timer left behind by the immediate first-page-view flush.
  fireNextFiveSecondTimer(harness);
  await settle();

  assert.equal(harness.facade.track('export.print_requested'), true);
  assert.equal(harness.checkbox.checked, true);
  harness.runtime.navigator.globalPrivacyControl = true;
  fireNextFiveSecondTimer(harness);
  await settle();

  assert.equal(harness.facade.status().active, false);
  assert.equal(harness.checkbox.checked, false);
  assert.equal(harness.checkbox.disabled, true);
  assert.match(harness.status.textContent, /browser privacy setting/i);
  harness.facade.dispose();
});
