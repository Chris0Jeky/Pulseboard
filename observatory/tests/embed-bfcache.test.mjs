import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { buildEmbed } from '../adapters/build-embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

function element(tag) {
  const node = {
    tag, children: [], listeners: {}, attributes: {}, textContent: '', checked: false, disabled: false,
    append: (...children) => node.children.push(...children),
    setAttribute: (name, value) => { node.attributes[name] = value; },
    addEventListener: (type, fn, options = {}) => { (node.listeners[type] ||= []).push({ fn, once: options.once === true }); },
    removeEventListener: (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter(item => item.fn !== fn); },
    remove: () => { node.removed = true; },
    emit(type, event = {}) {
      const entries = [...(node.listeners[type] || [])];
      for (const entry of entries) {
        entry.fn(event);
        if (entry.once) node.removeEventListener(type, entry.fn);
      }
    },
  };
  return node;
}

function setup() {
  const created = [], document = element('document');
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
    localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable'); },
    },
    fetch: async () => new Response('{}', { status: 202 }),
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const project = projects.mdviewer;
  const facade = mountObserver({
    id: 'mdviewer',
    project: { events: project.events, routes: project.routes, releases: project.releases, measurements: project.measurements },
    origin: project.origin,
    endpoint: 'https://collector.example/v1/collect/mdviewer',
    scopePath: '/', release: 'unattributed', route: 'home', clicks: [],
  }, createObserver, runtime);
  return {
    facade, runtime,
    checkbox: created.find(node => node.type === 'checkbox'),
    status: created.find(node => node.attributes.role === 'status'),
    details: created.find(node => node.tag === 'details'),
  };
}

test('session-only consent survives bfcache pagehide but normal navigation disposes it', async () => {
  const harness = setup();
  harness.checkbox.checked = true;
  harness.checkbox.emit('change');
  await settle();
  assert.equal(harness.facade.status().active, true);
  assert.match(harness.status.textContent, /only to this tab/i);

  harness.runtime.emit('pagehide', { persisted: true });
  assert.equal(harness.facade.status().active, true);
  assert.notEqual(harness.details.removed, true);
  assert.equal(harness.runtime.listeners.pagehide.length, 1);
  assert.equal(typeof harness.facade.resume, 'function');
  harness.facade.resume();
  assert.equal(harness.checkbox.checked, true);
  assert.match(harness.status.textContent, /only to this tab/i);

  harness.runtime.emit('pagehide', { persisted: false });
  assert.equal(harness.facade.status().active, false);
  assert.equal(harness.details.removed, true);
  assert.equal(harness.runtime.listeners.pagehide.length, 0);
});

test('generated artifacts resume an existing facade instead of remounting on bfcache restore', () => {
  const code = buildEmbed('mdviewer', { endpoint: 'https://collector.example/v1/collect/mdviewer' });
  assert.match(code, /PulseboardUsage\?\.resume\?\.\(\)/);
  assert.doesNotMatch(code, /if \(event\.persisted\) start\(\)/);
});
