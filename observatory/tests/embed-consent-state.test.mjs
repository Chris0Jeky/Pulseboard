import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

function element(tag) {
  let text = '';
  const node = {
    tag, children: [], listeners: {}, attributes: {}, checked: false, disabled: false, textWrites: 0,
    append: (...children) => node.children.push(...children),
    setAttribute: (name, value) => { node.attributes[name] = value; },
    addEventListener: (type, fn) => { (node.listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter(item => item !== fn); },
    remove: () => { node.removed = true; },
    emit: (type, event = {}) => { for (const fn of [...(node.listeners[type] || [])]) fn(event); },
  };
  Object.defineProperty(node, 'textContent', {
    get: () => text,
    set: value => { text = String(value); node.textWrites += 1; },
  });
  return node;
}

function setup(storage = new Map()) {
  const created = [], calls = [], document = element('document');
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
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    fetch: async (...args) => { calls.push(args); return new Response('{}', { status: 202 }); },
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const project = projects.mdviewer;
  const endpoint = 'https://collector.example/v1/collect/mdviewer';
  const facade = mountObserver({
    id: 'mdviewer',
    project: { events: project.events, routes: project.routes, releases: project.releases, measurements: project.measurements },
    origin: project.origin,
    endpoint,
    scopePath: '/',
    release: 'unattributed',
    route: 'home',
  }, createObserver, runtime);
  return {
    facade, runtime, storage, calls,
    key: 'pulseboard:consent:v1:mdviewer:' + endpoint,
    checkbox: created.find(node => node.type === 'checkbox'),
    status: created.find(node => node.attributes.role === 'status'),
  };
}

async function grant(harness) {
  harness.checkbox.checked = true;
  harness.checkbox.emit('change');
  await settle();
}

test('a storage failure remains visible after the initial page view flush', async () => {
  const storage = { has: () => false, get: () => null, set: () => { throw new Error('blocked'); } };
  const harness = setup(storage);
  await grant(harness);
  assert.equal(harness.facade.status().active, true);
  assert.match(harness.status.textContent, /could not be saved/i);
  harness.facade.dispose();
});

test('a privacy override disables consent editing and preserves the stored preference', async () => {
  const harness = setup();
  await grant(harness);
  assert.equal(JSON.parse(harness.storage.get(harness.key)).allow, true);

  harness.runtime.navigator.globalPrivacyControl = true;
  assert.equal(harness.facade.track('page.view'), false);
  assert.equal(harness.checkbox.disabled, true);
  assert.equal(harness.checkbox.checked, false);

  // The fake DOM can dispatch a change on a disabled input; the handler must still fail closed.
  harness.checkbox.checked = true;
  harness.checkbox.emit('change');
  assert.equal(JSON.parse(harness.storage.get(harness.key)).allow, true);
  assert.match(harness.status.textContent, /browser privacy setting/i);
  harness.facade.dispose();
});

test('ordinary tracking does not rewrite the consent live region', async () => {
  const harness = setup();
  await grant(harness);
  const writes = harness.status.textWrites;
  assert.equal(harness.facade.track('page.view'), true);
  assert.equal(harness.status.textWrites, writes);
  await harness.facade.flush();
  assert.equal(harness.status.textWrites, writes);
  harness.facade.dispose();
});
