import test from 'node:test';
import assert from 'node:assert/strict';
import { mountStatisticObserver } from '../adapters/stat-embed.mjs';
import { createStatisticObserver } from '../src/stat-browser.mjs';

const ORIGIN = 'https://alibi-after-hours-preview.commit-atlas.workers.dev';
const ENDPOINT = 'https://collector.test/v1/collect-stat/alibi';
const LEGACY = 'https://collector.test/v1/collect/alibi';
const PREF_KEY = 'pulseboard:statistics:v1:alibi';
const OLD_KEY = 'pulseboard:consent:v1:alibi:' + LEGACY;

const VOCAB = {
  events: ['page.view', 'app.ready', 'app.error', 'action.requested', 'action.completed'],
  routes: ['home', 'puzzle', 'castle'],
  releases: ['unattributed', '0.11.6'],
};

const baseConfig = (over = {}) => ({
  id: 'alibi',
  project: VOCAB,
  origin: ORIGIN,
  endpoint: ENDPOINT,
  scopePath: '/',
  route: 'home',
  release: 'unattributed',
  contextGlobal: 'ALIBI_OBSERVATORY_CONTEXT',
  clicks: [{ selector: '[data-track]', event: 'action.requested' }],
  ...over,
});

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  let brokenGet = false;
  let brokenSet = false;
  return {
    getItem(k) {
      if (brokenGet) throw new Error('denied');
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (brokenSet) throw new Error('denied');
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    _store: store,
    _break({ get = false, set = false } = {}) {
      brokenGet = !!get;
      brokenSet = !!set;
    },
  };
}

function makeDocument(order) {
  const all = [];
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attributes: {},
      textContent: '',
      id: '',
      type: '',
      checked: false,
      disabled: false,
      parent: null,
      _removed: false,
      _listeners: new Map(),
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      getAttribute(k) {
        return this.attributes[k] ?? null;
      },
      append(...nodes) {
        for (const n of nodes) {
          this.children.push(n);
          if (n && typeof n === 'object') n.parent = this;
        }
      },
      appendChild(n) {
        this.children.push(n);
        if (n && typeof n === 'object') n.parent = this;
        return n;
      },
      remove() {
        this._removed = true;
        if (this.parent) {
          const i = this.parent.children.indexOf(this);
          if (i >= 0) this.parent.children.splice(i, 1);
          this.parent = null;
        }
      },
      addEventListener(t, f) {
        if (!this._listeners.has(t)) this._listeners.set(t, new Set());
        this._listeners.get(t).add(f);
      },
      removeEventListener(t, f) {
        this._listeners.get(t)?.delete(f);
      },
    };
    all.push(el);
    return el;
  }
  const body = makeEl('body');
  const rawAppend = body.append.bind(body);
  body.append = (...nodes) => {
    order?.push('dom');
    return rawAppend(...nodes);
  };
  const rawAppendChild = body.appendChild.bind(body);
  body.appendChild = (n) => {
    order?.push('dom');
    return rawAppendChild(n);
  };
  const doc = {
    _all: all,
    body,
    _listeners: new Map(),
    createElement(tag) {
      return makeEl(tag);
    },
    createTextNode(text) {
      const n = { nodeType: 3, textContent: String(text), parent: null };
      all.push(n);
      return n;
    },
    addEventListener(t, f) {
      if (!this._listeners.has(t)) this._listeners.set(t, new Set());
      this._listeners.get(t).add(f);
    },
    removeEventListener(t, f) {
      this._listeners.get(t)?.delete(f);
    },
  };
  return doc;
}

function makeRuntime({ storage, document, fetchImpl, calls, order, locationOver, navigatorOver, alibiOver, contextValue } = {}) {
  const listeners = new Map();
  const runtime = {
    location: { origin: ORIGIN, protocol: 'https:', pathname: '/', ...(locationOver ?? {}) },
    navigator: { ...(navigatorOver ?? {}) },
    ALIBI_CONFIG: { standalone: false, ...(alibiOver ?? {}) },
    localStorage: storage,
    document,
    fetch: async (url, init) => {
      calls.push({ url, init });
      order?.push('fetch');
      if (fetchImpl) return fetchImpl(url, init, calls.length);
      return { ok: true };
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    AbortController: globalThis.AbortController,
    TextEncoder: globalThis.TextEncoder,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    _listeners: listeners,
  };
  if (contextValue !== undefined) runtime.ALIBI_OBSERVATORY_CONTEXT = contextValue;
  return runtime;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function collectText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.nodeType === 3) return node.textContent || '';
  let out = node.textContent || '';
  for (const child of node.children || []) out += ' ' + collectText(child);
  return out;
}

function findAll(root, pred, out = []) {
  if (!root || typeof root !== 'object') return out;
  if (pred(root)) out.push(root);
  for (const child of root.children || []) findAll(child, pred, out);
  return out;
}

function getContainer(doc) {
  return doc._all.find((e) => e.id === 'pulseboard-usage-sharing' && !e._removed) ?? null;
}

function getCheckbox(doc) {
  const all = findAll(doc.body, (e) => e.tagName === 'INPUT' && e.type === 'checkbox');
  return all[0] ?? null;
}

function getStatus(doc) {
  const all = findAll(doc.body, (e) => e.attributes?.role === 'status');
  return all[0] ?? null;
}

function fireCheckbox(checkbox) {
  const set = checkbox._listeners.get('change');
  assert.ok(set && set.size >= 1, 'checkbox has a change listener');
  for (const fn of [...set]) fn.call(checkbox, { target: checkbox });
}

function fireRuntime(runtime, type, event = {}) {
  const set = runtime._listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) fn.call(runtime, event);
}

function fireDocument(doc, type, event = {}) {
  const set = doc._listeners.get(type);
  if (!set) return;
  for (const fn of [...set]) fn.call(doc, event);
}

test('first visit defaults on with notice before network', async () => {
  const calls = [];
  const order = [];
  const storage = makeStorage();
  const document = makeDocument(order);
  const runtime = makeRuntime({ storage, document, calls, order });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade, 'mounts on first visit');
  assert.deepEqual(Object.keys(facade).sort(), ['dispose', 'flush', 'flushOnHide', 'resume', 'status', 'track']);
  const container = getContainer(document);
  assert.ok(container, 'notice container mounted with stable id');
  assert.equal(container.open, true, 'notice and switch are visible on first visit');
  const text = collectText(container).toLowerCase();
  for (const word of ['improve', 'count', 'section', 'release', 'pulseboard', '14-day', 'no puzzle', 'off', 'free']) {
    assert.ok(text.includes(word), `notice explains ${word}`);
  }
  const checkbox = getCheckbox(document);
  assert.ok(checkbox, 'labeled checkbox exists');
  const label = findAll(document.body, (e) => e.tagName === 'LABEL')[0];
  assert.ok(label && label.children.includes(checkbox), 'checkbox has a label');
  assert.ok(collectText(label).trim().length > 0, 'label has visible text');
  const status = getStatus(document);
  assert.ok(status, 'status element exists');
  assert.match(status.textContent.toLowerCase(), /on/, 'UI visibly says on');
  for (const el of document._all) {
    assert.ok(!('style' in el) || el.style === undefined, 'no fixed inline styles');
    assert.ok(!('style' in (el.attributes ?? {})), 'no style attribute');
  }
  assert.ok(document.body.children.includes(container), 'placement appends to body for later styling');
  await tick();
  assert.ok(calls.length >= 1, 'initial page.view sent after mounting');
  assert.ok(order.includes('dom') && order.includes('fetch'), 'both UI and network happened');
  assert.ok(order.indexOf('dom') < order.indexOf('fetch'), 'notice mounted before first network');
  const bodies = calls.map((c) => JSON.parse(c.init.body));
  const events = bodies.flatMap((b) => b.counts.map((c) => c.event));
  assert.ok(events.includes('page.view'), 'initial page.view emitted');
  assert.equal(events.filter((e) => e === 'page.view').length, 1, 'at most one initial page.view');
  facade.dispose();
});

test('old allow:false is an indefinite opt-out even when expired', async () => {
  const calls = [];
  const storage = makeStorage({
    [OLD_KEY]: JSON.stringify({ allow: false, until: Date.now() - 1000 }),
  });
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade, 'still mounts UI when opted out');
  await tick();
  assert.equal(calls.length, 0, 'no network when old opt-out present');
  assert.equal(facade.status().active, false);
  const status = getStatus(document);
  assert.match(status.textContent.toLowerCase(), /off/, 'UI says off');
  assert.equal(facade.track('page.view'), false);
  assert.equal(await facade.flush(), 0);
  assert.equal(calls.length, 0);
  facade.dispose();
});

test('new allow:false is preserved and never sends', async () => {
  const calls = [];
  const storage = makeStorage({ [PREF_KEY]: JSON.stringify({ allow: false }) });
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(facade.status().active, false);
  assert.equal(getCheckbox(document).checked, false);
  facade.dispose();
});

test('storage denial and corruption fail closed', async () => {
  {
    const calls = [];
    const storage = makeStorage();
    storage._break({ get: true });
    const document = makeDocument();
    const runtime = makeRuntime({ storage, document, calls });
    const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
    assert.ok(facade, 'denied storage still mounts off UI');
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(facade.status().active, false);
    facade.dispose();
  }
  {
    const calls = [];
    const storage = makeStorage({ [PREF_KEY]: 'not-json' });
    const document = makeDocument();
    const runtime = makeRuntime({ storage, document, calls });
    const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
    assert.ok(facade);
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(facade.status().active, false);
    facade.dispose();
  }
  {
    const calls = [];
    const storage = makeStorage({ [PREF_KEY]: JSON.stringify({ allow: 'yes' }) });
    const document = makeDocument();
    const runtime = makeRuntime({ storage, document, calls });
    const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
    assert.ok(facade);
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(facade.status().active, false);
    facade.dispose();
  }
});

test('explicit off aborts, clears queue and persists; failed persistence warns and stays off', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  calls.length = 0;
  assert.equal(facade.track('action.requested'), true);
  assert.equal(facade.track('action.completed'), true);
  assert.equal(facade.status().queued, 2);
  const checkbox = getCheckbox(document);
  checkbox.checked = false;
  fireCheckbox(checkbox);
  assert.equal(facade.status().queued, 0, 'explicit off drops queued work');
  assert.equal(facade.status().active, false);
  assert.equal(storage._store.get(PREF_KEY), JSON.stringify({ allow: false }), 'off choice persists boolean-only');
  assert.equal(await facade.flush(), 0);
  assert.ok(!calls.some((c) => JSON.parse(c.init.body).counts.some((x) => x.event === 'action.requested')), 'queued counts never sent');
  // Persistence failure path: start on again then break writes.
  storage._store.delete(PREF_KEY);
  checkbox.checked = true;
  fireCheckbox(checkbox);
  await tick();
  assert.equal(facade.status().active, true);
  calls.length = 0;
  storage._break({ set: true });
  checkbox.checked = false;
  fireCheckbox(checkbox);
  assert.equal(facade.status().active, false, 'stays off for this tab when persistence fails');
  assert.match(getStatus(document).textContent.toLowerCase(), /could not be saved|only to this tab/, 'warning shown');
  facade.dispose();
});

test('explicit on requires successful persistence before enabling', async () => {
  const calls = [];
  const storage = makeStorage({ [PREF_KEY]: JSON.stringify({ allow: false }) });
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  assert.equal(facade.status().active, false);
  storage._break({ set: true });
  const checkbox = getCheckbox(document);
  checkbox.checked = true;
  fireCheckbox(checkbox);
  assert.equal(facade.status().active, false, 'never enables when persistence fails');
  assert.match(getStatus(document).textContent.toLowerCase(), /could not be saved|only to this tab/);
  assert.equal(calls.length, 0);
  storage._break({ set: false });
  checkbox.checked = true;
  fireCheckbox(checkbox);
  assert.equal(facade.status().active, true);
  assert.equal(storage._store.get(PREF_KEY), JSON.stringify({ allow: true }));
  await tick();
  assert.ok(calls.some((c) => JSON.parse(c.init.body).counts.some((x) => x.event === 'page.view')), 'page.view sent once after explicit on');
  facade.dispose();
});

test('GPC and DNT leave collection off and never send', async () => {
  for (const navigatorOver of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
    const calls = [];
    const storage = makeStorage();
    const document = makeDocument();
    const runtime = makeRuntime({ storage, document, calls, navigatorOver });
    const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
    assert.equal(facade, null, 'does not mount under privacy signal');
    assert.equal(calls.length, 0);
  }
  // Signal arriving after mount revokes without sending.
  {
    const calls = [];
    const storage = makeStorage();
    const document = makeDocument();
    const runtime = makeRuntime({ storage, document, calls });
    const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
    assert.ok(facade);
    await tick();
    calls.length = 0;
    runtime.navigator.globalPrivacyControl = true;
    assert.equal(facade.track('action.requested'), false);
    assert.equal(facade.status().active, false);
    assert.equal(await facade.flush(), 0);
    assert.equal(calls.length, 0);
    facade.dispose();
  }
});

test('host route/release resolves only while active and only if registered', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({
    storage,
    document,
    calls,
    contextValue: { route: 'puzzle', release: '0.11.6', value: 999, session: 'evil' },
  });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  calls.length = 0;
  assert.equal(facade.track('action.requested'), true);
  await facade.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body).counts[0], {
    event: 'action.requested', route: 'puzzle', release: '0.11.6', n: 1,
  });
  // Unregistered host values fall back to registered defaults.
  runtime.ALIBI_OBSERVATORY_CONTEXT = { route: 'elsewhere', release: '9.9.9' };
  calls.length = 0;
  assert.equal(facade.track('action.requested'), true);
  await facade.flush();
  assert.deepEqual(JSON.parse(calls[0].init.body).counts[0], {
    event: 'action.requested', route: 'home', release: 'unattributed', n: 1,
  });
  // Explicit options win over host context but unregistered options drop.
  calls.length = 0;
  assert.equal(facade.track('action.requested', { route: 'castle', release: '0.11.6' }), true);
  await facade.flush();
  assert.deepEqual(JSON.parse(calls[0].init.body).counts[0].route, 'castle');
  assert.equal(facade.track('action.requested', { route: 'elsewhere' }), false);
  assert.equal(facade.track('action.requested', { session: 's' }), false);
  facade.dispose();
});

test('error and click listeners track only registered events', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  calls.length = 0;
  fireRuntime(runtime, 'error', {});
  fireRuntime(runtime, 'unhandledrejection', {});
  await facade.flush();
  const errorEvents = calls.flatMap((c) => JSON.parse(c.init.body).counts.map((x) => x.event));
  assert.ok(errorEvents.includes('app.error'), 'registered error tracked');
  calls.length = 0;
  const badConfigCalls = [];
  const badStorage = makeStorage();
  const badDocument = makeDocument();
  const badRuntime = makeRuntime({
    storage: badStorage,
    document: badDocument,
    calls: badConfigCalls,
    contextValue: undefined,
  });
  const badFacade = mountStatisticObserver(
    baseConfig({ clicks: [{ selector: '[data-track]', event: 'nope.event' }] }),
    createStatisticObserver,
    badRuntime,
  );
  assert.ok(badFacade);
  await tick();
  badConfigCalls.length = 0;
  fireDocument(badDocument, 'click', { target: { closest: () => true } });
  assert.equal(badFacade.status().queued, 0, 'unregistered click event never queues');
  assert.equal(badConfigCalls.length, 0);
  badFacade.dispose();
  // Registered click tracks once.
  const target = { closest: (sel) => (sel === '[data-track]' ? true : false) };
  fireDocument(document, 'click', { target });
  assert.equal(facade.status().queued, 1);
  await facade.flush();
  assert.ok(calls.some((c) => JSON.parse(c.init.body).counts.some((x) => x.event === 'action.requested')));
  facade.dispose();
});

test('non-bfcache pagehide hands once with preserve; bfcache resume repaints without duplicate view', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  const initialViews = calls.flatMap((c) => JSON.parse(c.init.body).counts).filter((x) => x.event === 'page.view').length;
  assert.equal(initialViews, 1);
  calls.length = 0;
  assert.equal(facade.track('action.requested'), true);
  fireRuntime(runtime, 'pagehide', { persisted: false });
  await tick();
  assert.ok(calls.length >= 1, 'queued counts handed on exit');
  assert.ok(calls.every((c) => c.init.keepalive === true), 'exit handoff uses keepalive');
  assert.equal(facade.status().active, false);
  const afterExitViews = calls.flatMap((c) => JSON.parse(c.init.body).counts).filter((x) => x.event === 'page.view').length;
  assert.equal(afterExitViews, 0, 'exit does not duplicate the initial view');
  assert.equal(getContainer(document), null, 'exit cleans up the notice');

  // bfcache path keeps the realm and repaints.
  const calls2 = [];
  const storage2 = makeStorage();
  const document2 = makeDocument();
  const runtime2 = makeRuntime({ storage: storage2, document: document2, calls: calls2 });
  const facade2 = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime2);
  assert.ok(facade2);
  await tick();
  calls2.length = 0;
  assert.equal(facade2.track('action.requested'), true);
  fireRuntime(runtime2, 'pagehide', { persisted: true });
  await tick();
  assert.ok(getContainer(document2), 'bfcache keeps the notice');
  const before = calls2.flatMap((c) => JSON.parse(c.init.body).counts).filter((x) => x.event === 'page.view').length;
  facade2.resume();
  await tick();
  const after = calls2.flatMap((c) => JSON.parse(c.init.body).counts).filter((x) => x.event === 'page.view').length;
  assert.equal(before, after, 'resume never duplicates the initial view');
  assert.match(getStatus(document2).textContent.toLowerCase(), /on|off/);
  facade2.dispose();
});

test('dispose removes listeners and UI and stops collection', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  facade.dispose();
  assert.equal(getContainer(document), null, 'notice removed');
  assert.equal((runtime._listeners.get('error') ?? new Set()).size, 0);
  assert.equal((runtime._listeners.get('pagehide') ?? new Set()).size, 0);
  assert.equal((document._listeners.get('click') ?? new Set()).size, 0);
  assert.equal(facade.track('action.requested'), false);
  assert.equal(await facade.flush(), 0);
  assert.equal(facade.flushOnHide(), 0);
});

test('payloads carry only closed counts, never identifiers or puzzle content', async () => {
  const calls = [];
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({
    storage,
    document,
    calls,
    contextValue: {
      route: 'puzzle',
      release: '0.11.6',
      puzzleId: 'secret-puzzle-1',
      content: 'puzzle solution text',
      progress: 0.9,
      session: 'evil-session',
    },
  });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  calls.length = 0;
  assert.equal(facade.track('action.requested', { route: 'puzzle', release: '0.11.6' }), true);
  fireRuntime(runtime, 'error', {});
  await facade.flush();
  assert.ok(calls.length >= 1);
  for (const { url, init } of calls) {
    assert.equal(url, ENDPOINT);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['counts', 'v']);
    assert.equal(body.v, 1);
    for (const count of body.counts) {
      assert.deepEqual(Object.keys(count).sort(), ['event', 'n', 'release', 'route']);
      assert.equal(count.n, 1);
    }
    const text = init.body.toLowerCase();
    for (const leak of ['secret', 'solution', 'progress', 'visitor', 'session', 'puzzle-1', 'http', 'cookie']) {
      assert.ok(!text.includes(leak), `payload must not contain ${leak}`);
    }
  }
  facade.dispose();
});

test('preference key is stable across endpoint changes and boolean-only', async () => {
  const storage = makeStorage({ [PREF_KEY]: JSON.stringify({ allow: false }) });
  const firstDoc = makeDocument();
  const firstCalls = [];
  const first = makeRuntime({ storage, document: firstDoc, calls: firstCalls });
  const a = mountStatisticObserver(baseConfig(), createStatisticObserver, first);
  assert.ok(a);
  await tick();
  assert.equal(firstCalls.length, 0);
  a.dispose();
  const secondDoc = makeDocument();
  const secondCalls = [];
  const second = makeRuntime({ storage, document: secondDoc, calls: secondCalls });
  const b = mountStatisticObserver(
    baseConfig({ endpoint: 'https://other-collector.test/v1/collect-stat/alibi' }),
    createStatisticObserver,
    second,
  );
  assert.ok(b, 'same stable key still opts out after endpoint change');
  await tick();
  assert.equal(secondCalls.length, 0);
  assert.equal(b.status().active, false);
  b.dispose();
  assert.equal(storage._store.get(PREF_KEY), JSON.stringify({ allow: false }));
  assert.ok(!storage._store.get(PREF_KEY).includes('until'), 'new choice persists indefinitely without expiry');
});

test('old allow:true is never inferred as consent', async () => {
  const calls = [];
  const storage = makeStorage({ [OLD_KEY]: JSON.stringify({ allow: true, until: Date.now() + 86400000 }) });
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  // Default-on still applies only because storage probes pass, not because the old true was read.
  assert.equal(facade.status().active, true);
  assert.equal(storage._store.has(PREF_KEY), false, 'default-on does not invent a stored consent');
  facade.dispose();
  const deniedCalls = [];
  const deniedStorage = makeStorage({ [OLD_KEY]: JSON.stringify({ allow: true, until: Date.now() + 86400000 }) });
  deniedStorage._break({ get: false, set: true });
  // Break the probe write path: default-on requires set/readback.
  deniedStorage.setItem = () => { throw new Error('denied'); };
  const deniedDoc = makeDocument();
  const deniedRuntime = makeRuntime({ storage: deniedStorage, document: deniedDoc, calls: deniedCalls });
  const denied = mountStatisticObserver(baseConfig(), createStatisticObserver, deniedRuntime);
  assert.ok(denied);
  await tick();
  assert.equal(denied.status().active, false, 'unwritable storage fails closed even with old allow:true');
  assert.equal(deniedCalls.length, 0);
  denied.dispose();
});

test('explicit off aborts an in-flight flush', async () => {
  const calls = [];
  let releaseFlight;
  const gate = new Promise((r) => { releaseFlight = r; });
  const storage = makeStorage();
  const document = makeDocument();
  const runtime = makeRuntime({ storage, document, calls });
  const facade = mountStatisticObserver(baseConfig(), createStatisticObserver, runtime);
  assert.ok(facade);
  await tick();
  calls.length = 0;
  runtime.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.keepalive) return { ok: true };
    return gate.then(() => ({ ok: true }));
  };
  assert.equal(facade.track('action.requested'), true);
  const pending = facade.flush();
  await Promise.resolve();
  await tick(5);
  assert.equal(facade.status().requests, 2);
  const signal = calls[0].init.signal;
  const checkbox = getCheckbox(document);
  checkbox.checked = false;
  fireCheckbox(checkbox);
  assert.equal(facade.status().queued, 0);
  assert.equal(facade.status().active, false);
  assert.ok(signal && signal.aborted === true, 'flight aborted on explicit off');
  releaseFlight({ ok: true });
  assert.equal(await pending, 0);
  assert.equal(facade.status().sent, 1, 'aborted batch never counts as sent');
  facade.dispose();
});

test('ineligible mounts never touch DOM, storage or host context', async () => {
  const cases = [
    ['foreign origin', baseConfig(), { locationOver: { origin: 'https://other.test' } }],
    ['forged project origin', baseConfig({ origin: 'https://other.test' }), { locationOver: { origin: 'https://other.test' } }],
    ['http page', baseConfig(), { locationOver: { protocol: 'http:' } }],
    ['wrong scope', baseConfig({ scopePath: '/puzzles' }), { locationOver: { pathname: '/other' } }],
    ['webdriver', baseConfig(), { navigatorOver: { webdriver: true } }],
    ['standalone', baseConfig(), { alibiOver: { standalone: true } }],
    ['bad endpoint', baseConfig({ endpoint: 'https://collector.test/other' }), {}],
    ['bad id', baseConfig({ id: 'other' }), {}],
  ];
  for (const [name, config, over] of cases) {
    const accesses = [];
    const target = {
      location: { origin: ORIGIN, protocol: 'https:', pathname: '/', ...(over.locationOver ?? {}) },
      navigator: { ...(over.navigatorOver ?? {}) },
      ALIBI_CONFIG: { standalone: false, ...(over.alibiOver ?? {}) },
      document: { body: {} },
      localStorage: { getItem: () => null },
      ALIBI_OBSERVATORY_CONTEXT: { route: 'puzzle', release: '0.11.6' },
      fetch: async () => ({ ok: true }),
      AbortController: globalThis.AbortController,
      TextEncoder: globalThis.TextEncoder,
    };
    const proxy = new Proxy(target, {
      get(t, p) {
        accesses.push(String(p));
        return Reflect.get(t, p);
      },
    });
    assert.equal(mountStatisticObserver(config, createStatisticObserver, proxy), null, name);
    assert.ok(!accesses.includes('document'), `${name} must not read DOM`);
    assert.ok(!accesses.includes('localStorage'), `${name} must not read storage`);
    assert.ok(!accesses.includes('ALIBI_OBSERVATORY_CONTEXT'), `${name} must not read host context`);
  }
});
