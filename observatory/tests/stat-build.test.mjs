import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildEmbed, assertArtifactShape } from '../adapters/build-embed.mjs';
import { projects } from '../src/projects.mjs';

const STAT_ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect-stat/alibi';
const LEGACY_ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/alibi';
const ALIBI_ORIGIN = 'https://alibi-after-hours-preview.commit-atlas.workers.dev';

test('Alibi stat artifact is a plain script with new transport, config and switch text', () => {
  const code = buildEmbed('alibi', { endpoint: STAT_ENDPOINT });
  new vm.Script(code);
  assertArtifactShape(code);
  assert.equal(code.includes('\r'), false);
  assert.deepEqual(code.split('\n').filter(line => /^(?:import|export)\b/.test(line)), []);
  assert.equal(/MAX_BYTES|MAX_BATCH/.test(code), false);
  assert.ok(code.includes('createStatisticObserver'), 'stat transport present');
  assert.ok(code.includes('mountStatisticObserver'), 'stat control present');
  assert.ok(code.includes('CLIENT_BATCH_LIMIT'), 'renamed client bound present');
  assert.equal(code.includes('validateStatBatch') || code.includes('validateStatCount') || code.includes('STAT_MAX_BATCH'), false, 'server validation stays server-side');
  const lines = code.split('\n').filter(line => line.startsWith('const config = '));
  assert.equal(lines.length, 1, 'one config line for host checker/sync parser');
  const config = JSON.parse(/^const config = (\{.*\});$/.exec(lines[0])[1]);
  assert.equal(config.id, 'alibi');
  assert.equal(config.endpoint, STAT_ENDPOINT);
  assert.equal(config.origin, ALIBI_ORIGIN);
  assert.equal(config.contextGlobal, 'ALIBI_OBSERVATORY_CONTEXT');
  assert.deepEqual(config.publicFlag, { global: 'ALIBI_CONFIG', key: 'standalone', expected: false });
  assert.ok(Array.isArray(config.project.events) && config.project.events.includes('page.view'));
  assert.ok(Array.isArray(config.project.routes) && Array.isArray(config.project.releases));
  assert.ok(code.includes(ALIBI_ORIGIN), 'public origin visible');
  assert.ok(code.includes(STAT_ENDPOINT), 'new endpoint visible');
  assert.equal(code.includes(`"endpoint":"${LEGACY_ENDPOINT}"`), false, 'retired endpoint never the configured endpoint');
  const lower = code.toLowerCase();
  for (const marker of ['randomuuid', 'raw events expire', '"session"']) assert.equal(lower.includes(marker), false, marker + ' must not leak into stat artifact');
  for (const word of ['usage sharing', 'share basic usage counts', '14-day aggregates']) assert.ok(lower.includes(word), 'visible switch text: ' + word);
  assert.ok(code.includes('globalThis.PulseboardUsage'), 'initializes PulseboardUsage');
  assert.ok(code.includes('PulseboardUsage?.dispose()'), 'disposes prior facade on remount');
  assert.ok(code.includes('DOMContentLoaded'), 'starts after DOM ready');
  assert.ok(code.includes('PulseboardUsage?.resume?.()'), 'resumes on persisted pageshow');
});

test('Alibi stat artifact executes: default-on after notice, single page.view, no identifiers', async () => {
  const code = buildEmbed('alibi', { endpoint: 'https://collector.test/v1/collect-stat/alibi' });
  const calls = [];
  const order = [];
  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const listeners = new Map();
  function el(tag) {
    const n = { tag, children: [], attributes: {}, textContent: '', id: '', type: '', checked: false, disabled: false, open: false, _listeners: new Map(),
      setAttribute: (k, v) => { n.attributes[k] = String(v); }, append: (...xs) => { order.push('dom'); for (const x of xs) n.children.push(x); },
      appendChild: x => { order.push('dom'); n.children.push(x); return x; }, remove: () => {}, addEventListener: (t, f) => { (n._listeners.get(t) || n._listeners.set(t, new Set()).get(t)).add(f); },
      removeEventListener: (t, f) => { n._listeners.get(t)?.delete(f); } };
    return n;
  }
  const body = el('body');
  const document = { readyState: 'complete', body, createElement: t => el(t), createTextNode: t => ({ textContent: String(t) }), addEventListener: () => {}, removeEventListener: () => {} };
  const context = { document, location: { origin: ALIBI_ORIGIN, protocol: 'https:', pathname: '/' }, navigator: {}, ALIBI_CONFIG: { standalone: false },
    localStorage: storage, fetch: async (url, init) => { calls.push({ url, init }); order.push('fetch'); return { ok: true }; },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id), AbortController: globalThis.AbortController, TextEncoder: globalThis.TextEncoder,
    URL, Math, Date, addEventListener: (t, f) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)).add(f); }, removeEventListener: (t, f) => { listeners.get(t)?.delete(f); } };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(context.PulseboardUsage, 'facade mounted');
  assert.equal(context.PulseboardUsage.status().active, true, 'default-on after notice');
  assert.ok(order.includes('dom') && order.includes('fetch') && order.indexOf('dom') < order.indexOf('fetch'), 'notice before network');
  const bodies = calls.map(c => JSON.parse(c.init.body));
  const events = bodies.flatMap(b => b.counts.map(c => c.event));
  assert.ok(events.includes('page.view'), 'one initial page.view');
  assert.equal(events.filter(e => e === 'page.view').length, 1, 'no duplicate page.view');
  for (const { init } of calls) {
    const text = init.body.toLowerCase();
    for (const leak of ['session', 'visitor', 'cookie', 'http']) assert.equal(text.includes(leak), false, 'identifier payload leak: ' + leak);
    const bodyJson = JSON.parse(init.body);
    assert.deepEqual(Object.keys(bodyJson).sort(), ['counts', 'v']);
    for (const c of bodyJson.counts) assert.deepEqual(Object.keys(c).sort(), ['event', 'n', 'release', 'route']);
  }
  const before = calls.length;
  for (const fn of [...(listeners.get('pageshow') || [])]) fn({ persisted: true });
  await new Promise(r => setTimeout(r, 20));
  const after = calls.flatMap(c => JSON.parse(c.init.body).counts.map(x => x.event)).filter(e => e === 'page.view').length;
  assert.equal(after, 1, 'persisted pageshow resumes without duplicate page.view');
  assert.equal(before <= calls.length, true);
});

test('old opt-out migrates to off with no network', async () => {
  const code = buildEmbed('alibi', { endpoint: 'https://collector.test/v1/collect-stat/alibi' });
  const calls = [];
  const legacyKey = 'pulseboard:consent:v1:alibi:https://collector.test/v1/collect/alibi';
  const store = new Map([[legacyKey, JSON.stringify({ allow: false, until: Date.now() - 1000 })]]);
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  function el(tag) {
    const n = { tag, children: [], attributes: {}, textContent: '', id: '', type: '', checked: false, disabled: false, open: false, _listeners: new Map(),
      setAttribute: (k, v) => { n.attributes[k] = String(v); }, append: (...xs) => { for (const x of xs) n.children.push(x); }, appendChild: x => { n.children.push(x); return x; },
      remove: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
    return n;
  }
  const document = { readyState: 'complete', body: el('body'), createElement: t => el(t), createTextNode: t => ({ textContent: String(t) }), addEventListener: () => {}, removeEventListener: () => {} };
  const context = { document, location: { origin: ALIBI_ORIGIN, protocol: 'https:', pathname: '/' }, navigator: {}, ALIBI_CONFIG: { standalone: false },
    localStorage: storage, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true }; },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout: (id) => clearTimeout(id), AbortController: globalThis.AbortController, TextEncoder: globalThis.TextEncoder,
    URL, Math, Date, addEventListener: () => {}, removeEventListener: () => {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(context.PulseboardUsage, 'UI still mounts when opted out');
  assert.equal(context.PulseboardUsage.status().active, false);
  assert.equal(calls.length, 0, 'no network when old opt-out present');
});

test('generic non-Alibi build is unchanged', () => {
  const code = buildEmbed('mdviewer');
  new vm.Script(code);
  assert.ok(code.includes('mountObserver(config, createObserver)'), 'generic control unchanged');
  assert.equal(code.includes('mountStatisticObserver') || code.includes('createStatisticObserver'), false, 'stat code never leaks into generic builds');
  assert.equal(/MAX_BYTES|MAX_BATCH/.test(code), false);
  const config = JSON.parse(/const config = (\{.*\});/.exec(code)[1].replaceAll('\\u003c', '<'));
  assert.equal(config.id, 'mdviewer');
  assert.equal(config.origin, projects.mdviewer.origin);
  assert.throws(() => buildEmbed('mdviewer', { endpoint: 'https://collector.test/v1/collect-stat/alibi' }), /exact HTTPS/);
});

test('generated Alibi bytes are deterministic across line endings', () => {
  const a = buildEmbed('alibi', { endpoint: STAT_ENDPOINT });
  assert.equal(a.includes('\r'), false);
  assert.equal(a, a.replaceAll('\r\n', '\n'));
});
