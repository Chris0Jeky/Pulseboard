import test from 'node:test';
import assert from 'node:assert/strict';
import { mountObserver } from '../adapters/embed.mjs';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';

function element(tag) {
  const node = {
    tag,
    children: [],
    listeners: {},
    attributes: {},
    textContent: '',
    checked: false,
    append: (...children) => node.children.push(...children),
    setAttribute: (name, value) => {
      node.attributes[name] = value;
    },
    addEventListener: (type, listener) => {
      (node.listeners[type] ||= []).push(listener);
    },
    removeEventListener: (type, listener) => {
      node.listeners[type] = (node.listeners[type] || []).filter((item) => item !== listener);
    },
    remove: () => {
      node.removed = true;
    },
    emit: (type, event = {}) => {
      for (const listener of [...(node.listeners[type] || [])]) listener(event);
    },
  };
  return node;
}

function setup() {
  const project = projects.mdviewer;
  const document = element('document');
  const created = [];
  Object.assign(document, {
    body: element('body'),
    createElement: (tag) => {
      const node = element(tag);
      created.push(node);
      return node;
    },
    createTextNode: (text) => ({ text }),
  });
  let contextReads = 0;
  const runtime = Object.assign(element('window'), {
    document,
    navigator: {},
    crypto,
    AbortController,
    location: { origin: project.origin, protocol: 'https:', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => new Response('{}', { status: 202 }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    OBSERVATORY_CONTEXT: () => {
      contextReads += 1;
      return { route: 'editor', release: '0.11.3' };
    },
  });
  const facade = mountObserver(
    {
      id: 'mdviewer',
      project: {
        events: project.events,
        routes: project.routes,
        releases: ['unattributed', '0.11.3'],
        measurements: project.measurements,
      },
      origin: project.origin,
      endpoint: 'https://collector.example/v1/collect/mdviewer',
      scopePath: '/',
      release: 'unattributed',
      route: 'home',
      contextGlobal: 'OBSERVATORY_CONTEXT',
      clicks: [{ selector: '.print', event: 'export.print_requested' }],
    },
    createObserver,
    runtime,
  );
  return {
    facade,
    runtime,
    document,
    checkbox: created.find((node) => node.type === 'checkbox'),
    contextReads: () => contextReads,
  };
}

test('host context and option getters stay untouched without active consent', () => {
  const harness = setup();
  let optionReads = 0;
  const options = {
    get route() {
      optionReads += 1;
      return 'editor';
    },
  };

  assert.equal(harness.contextReads(), 0);
  assert.equal(harness.facade.track('page.view', options), false);
  harness.runtime.emit('error');
  harness.document.emit('click', {
    target: { closest: (selector) => selector === '.print' },
  });
  assert.equal(harness.contextReads(), 0);
  assert.equal(optionReads, 0);

  harness.checkbox.checked = true;
  harness.checkbox.emit('change');
  assert.equal(harness.contextReads(), 1, 'initial consented page view resolves context once');

  harness.checkbox.checked = false;
  harness.checkbox.emit('change');
  const afterWithdrawal = harness.contextReads();
  assert.equal(harness.facade.track('page.view', options), false);
  harness.runtime.emit('error');
  harness.document.emit('click', {
    target: { closest: (selector) => selector === '.print' },
  });
  assert.equal(harness.contextReads(), afterWithdrawal);
  assert.equal(optionReads, 0);

  harness.facade.dispose();
  assert.equal(harness.facade.track('page.view', options), false);
  harness.runtime.emit('error');
  harness.document.emit('click', {
    target: { closest: (selector) => selector === '.print' },
  });
  assert.equal(harness.contextReads(), afterWithdrawal);
  assert.equal(optionReads, 0);
});
