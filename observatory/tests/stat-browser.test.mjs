import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatisticObserver } from '../src/stat-browser.mjs';

const ENDPOINT = 'https://collector.test/v1/collect-stat/alibi';
const ORIGIN = 'https://site.test';
const VOCAB = {
  events: ['puzzle.started', 'puzzle.completed', 'puzzle.failed', 'hint.requested'],
  routes: ['puzzle', 'castle', 'home'],
  releases: ['0.11.6', '0.12.0'],
};

const baseConfig = (over = {}) => ({
  project: VOCAB,
  endpoint: ENDPOINT,
  origin: ORIGIN,
  route: 'puzzle',
  release: '0.11.6',
  ...over,
});

function baseRuntime(over = {}) {
  const calls = [];
  const fetchImpl = over.fetchImpl ?? (async () => ({ ok: true }));
  const runtime = {
    location: { origin: ORIGIN, protocol: 'https:' },
    navigator: {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init, calls.length);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    AbortController: globalThis.AbortController,
    TextEncoder: globalThis.TextEncoder,
  };
  if ('location' in over) runtime.location = over.location;
  if ('navigator' in over) runtime.navigator = over.navigator;
  if ('fetch' in over) {
    runtime.fetch = async (url, init) => {
      calls.push({ url, init });
      return over.fetch(url, init, calls.length);
    };
  }
  if ('setTimeout' in over) runtime.setTimeout = over.setTimeout;
  if ('clearTimeout' in over) runtime.clearTimeout = over.clearTimeout;
  if (!('fetchImpl' in over) && !('fetch' in over) && over.callsOnly) {
    // keep default
  }
  return { runtime, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('disabled produces zero network/context/storage access', async () => {
  const accesses = [];
  const target = {
    fetch: async () => {
      accesses.push('fetch:call');
      return { ok: true };
    },
    location: { origin: ORIGIN, protocol: 'https:' },
    navigator: {},
    localStorage: { getItem: () => { accesses.push('storage'); return null; } },
    document: { cookie: '' },
  };
  const runtime = new Proxy(target, {
    get(t, p) {
      accesses.push(`get:${String(p)}`);
      return Reflect.get(t, p);
    },
  });
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.track('puzzle.started'), false);
  assert.equal(await obs.flush(), 0);
  assert.equal(obs.flushOnHide(), 0);
  const st = obs.status();
  assert.equal(st.queued, 0);
  assert.equal(st.requests, 0);
  assert.deepEqual(accesses, []);
  obs.dispose();
});

test('enabled payload contains only closed count fields', async () => {
  const { runtime, calls } = baseRuntime();
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  assert.equal(obs.track('puzzle.started'), true);
  assert.equal(obs.track('puzzle.completed', { route: 'castle', release: '0.12.0' }), true);
  const sent = await obs.flush();
  assert.equal(sent, 2);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
  assert.equal(init.keepalive, undefined);
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ['counts', 'v']);
  assert.equal(body.v, 1);
  assert.equal(body.counts.length, 2);
  for (const c of body.counts) {
    assert.deepEqual(Object.keys(c).sort(), ['event', 'n', 'release', 'route']);
    assert.equal(c.n, 1);
  }
  assert.deepEqual(body.counts[0], { event: 'puzzle.started', route: 'puzzle', release: '0.11.6', n: 1 });
  assert.deepEqual(body.counts[1], { event: 'puzzle.completed', route: 'castle', release: '0.12.0', n: 1 });
  const text = init.body;
  assert.ok(!text.includes('visitor') && !text.includes('session') && !text.includes('http'));
  const st = obs.status();
  assert.equal(st.sent, 2);
  assert.equal(st.queued, 0);
  assert.equal(st.requests, 1);
  assert.ok(!('queue' in st) && !('batch' in st));
  obs.dispose();
});

test('invalid event/options drop without network', async () => {
  const { runtime, calls } = baseRuntime();
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  const bad = [
    ['nope.event', {}],
    ['puzzle.started', { route: 'elsewhere' }],
    ['puzzle.started', { release: '9.9.9' }],
    ['puzzle.started', { route: 'puzzle', release: '0.11.6', value: 1 }],
    ['puzzle.started', { route: 'puzzle', url: 'https://x.test/' }],
    ['puzzle.started', { session: 's' }],
    ['puzzle.started', { n: 1 }],
    [123, {}],
    ['puzzle.started', { route: null }],
    ['puzzle.started', 'puzzle'],
  ];
  for (const [event, options] of bad) {
    assert.equal(obs.track(event, options), false, JSON.stringify([event, options]));
  }
  assert.equal(obs.status().queued, 0);
  assert.equal(await obs.flush(), 0);
  assert.equal(calls.length, 0);
  assert.ok(obs.status().dropped >= bad.length);
  obs.dispose();
});

test('GPC/DNT and explicit off abort/clear immediately', async () => {
  // GPC revocation clears the queue and disables.
  {
    const { runtime, calls } = baseRuntime();
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    assert.equal(obs.track('puzzle.completed'), true);
    assert.equal(obs.status().queued, 2);
    runtime.navigator.globalPrivacyControl = true;
    assert.equal(obs.track('puzzle.started'), false);
    assert.equal(obs.status().queued, 0);
    assert.equal(obs.status().enabled, false);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 0);
    obs.dispose();
  }
  // DNT revocation clears the queue and disables.
  {
    const { runtime, calls } = baseRuntime();
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    runtime.navigator.doNotTrack = '1';
    assert.equal(await obs.flush(), 0);
    assert.equal(obs.status().queued, 0);
    assert.equal(obs.status().enabled, false);
    assert.equal(calls.length, 0);
    obs.dispose();
  }
  // Status alone must reflect a browser privacy override before another track call.
  {
    const { runtime } = baseRuntime();
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    runtime.navigator.globalPrivacyControl = true;
    assert.equal(obs.status().active, false);
    assert.equal(obs.status().queued, 0);
    obs.dispose();
  }
  // Explicit off aborts flight and clears the queue.
  {
    const calls = [];
    let capturedSignal = null;
    let releaseFlight;
    const gate = new Promise((r) => { releaseFlight = r; });
    const runtime = {
      location: { origin: ORIGIN, protocol: 'https:' },
      navigator: {},
      fetch: (url, init) => {
        calls.push({ url, init });
        capturedSignal = init.signal;
        return gate.then(() => ({ ok: true }));
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      AbortController: globalThis.AbortController,
      TextEncoder: globalThis.TextEncoder,
    };
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    const pending = obs.flush();
    await Promise.resolve();
    assert.equal(obs.status().requests, 1);
    assert.equal(obs.setEnabled(false), false);
    assert.equal(obs.status().queued, 0);
    assert.equal(obs.status().enabled, false);
    assert.ok(capturedSignal && capturedSignal.aborted === true);
    releaseFlight();
    assert.equal(await pending, 0);
    assert.equal(obs.status().sent, 0);
    assert.equal(calls.length, 1);
    obs.dispose();
  }
});

test('failed POST is not retried and never throws', async () => {
  // Non-OK response drops without retry.
  {
    const { runtime, calls } = baseRuntime({ fetchImpl: async () => ({ ok: false }) });
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    assert.equal(obs.status().queued, 0);
    assert.equal(obs.status().dropped, 1);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    obs.dispose();
  }
  // Rejection drops without retry and without throwing.
  {
    const { runtime, calls } = baseRuntime({
      fetchImpl: async () => { throw new Error('down'); },
    });
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    obs.dispose();
  }
  // Immediate timeout settles nonthrowing without retry.
  {
    const calls = [];
    const runtime = {
      location: { origin: ORIGIN, protocol: 'https:' },
      navigator: {},
      fetch: (url, init) => {
        calls.push({ url, init });
        return new Promise((resolve, reject) => {
          if (init.signal && init.signal.aborted) return reject(new Error('aborted'));
          if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
      setTimeout: (fn) => { fn(); return 0; },
      clearTimeout: () => {},
      AbortController: globalThis.AbortController,
      TextEncoder: globalThis.TextEncoder,
    };
    const obs = createStatisticObserver(baseConfig(), runtime);
    assert.equal(obs.setEnabled(true), true);
    assert.equal(obs.track('puzzle.started'), true);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    assert.equal(await obs.flush(), 0);
    assert.equal(calls.length, 1);
    obs.dispose();
  }
});

test('pagehide never duplicates an in-flight batch', async () => {
  const calls = [];
  let releaseFlight;
  const gate = new Promise((r) => { releaseFlight = r; });
  const runtime = {
    location: { origin: ORIGIN, protocol: 'https:' },
    navigator: {},
    fetch: (url, init) => {
      calls.push({ url, init });
      if (init.keepalive) return Promise.resolve({ ok: true });
      return gate.then(() => ({ ok: true }));
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    AbortController: globalThis.AbortController,
    TextEncoder: globalThis.TextEncoder,
  };
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  assert.equal(obs.track('puzzle.started'), true);
  const pending = obs.flush();
  await Promise.resolve();
  assert.equal(obs.status().requests, 1);
  assert.equal(obs.track('puzzle.completed'), true);
  const handed = obs.flushOnHide();
  assert.equal(handed, 1);
  assert.equal(calls.length, 2);
  const first = JSON.parse(calls[0].init.body);
  const second = JSON.parse(calls[1].init.body);
  assert.deepEqual(first.counts.map((c) => c.event), ['puzzle.started']);
  assert.deepEqual(second.counts.map((c) => c.event), ['puzzle.completed']);
  assert.equal(calls[0].init.keepalive, undefined);
  assert.equal(calls[1].init.keepalive, true);
  releaseFlight();
  assert.equal(await pending, 1);
  await tick();
  assert.equal(obs.status().sent, 2);
  // A second hide hands nothing new.
  assert.equal(obs.flushOnHide(), 0);
  assert.equal(calls.length, 2);
  obs.dispose();
});

test('explicit off aborts an outstanding keepalive handoff', async () => {
  let releaseFlight;
  const gate = new Promise(resolve => { releaseFlight = resolve; });
  const { runtime, calls } = baseRuntime({ fetch: async () => gate });
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  assert.equal(obs.track('puzzle.started'), true);
  assert.equal(obs.flushOnHide(), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.keepalive, true);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(obs.setEnabled(false), false);
  assert.equal(calls[0].init.signal.aborted, true);
  releaseFlight({ ok: true });
  await tick();
  assert.equal(obs.status().sent, 0);
  obs.dispose();
});

test('ordinary page exit can preserve a handed-off keepalive request', async () => {
  let releaseFlight;
  const gate = new Promise(resolve => { releaseFlight = resolve; });
  const { runtime, calls } = baseRuntime({ fetch: async () => gate });
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  assert.equal(obs.track('puzzle.started'), true);
  assert.equal(obs.flushOnHide(), 1);
  obs.dispose({ preserveHandoffs: true });
  assert.equal(obs.status().active, false);
  assert.equal(calls[0].init.signal.aborted, false);
  releaseFlight({ ok: true });
  await tick();
  assert.equal(obs.status().queued, 0);
});

test('endpoint/origin guards fail closed', async () => {
  const cases = [
    ['http endpoint', baseConfig({ endpoint: 'http://collector.test/v1/collect-stat/alibi' }), null],
    ['endpoint query', baseConfig({ endpoint: `${ENDPOINT}?v=1` }), null],
    ['endpoint path', baseConfig({ endpoint: 'https://collector.test/other' }), null],
    ['endpoint hash', baseConfig({ endpoint: `${ENDPOINT}#x` }), null],
    ['endpoint creds', baseConfig({ endpoint: 'https://user:pass@collector.test/v1/collect-stat/alibi' }), null],
    ['http origin', baseConfig({ origin: 'http://site.test' }), { location: { origin: 'http://site.test', protocol: 'http:' } }],
    ['foreign page', baseConfig(), { location: { origin: 'https://other.test', protocol: 'https:' } }],
    ['http page', baseConfig(), { location: { origin: ORIGIN, protocol: 'http:' } }],
    ['webdriver', baseConfig(), { navigator: { webdriver: true } }],
    ['dnt at enable', baseConfig(), { navigator: { doNotTrack: '1' } }],
    ['gpc at enable', baseConfig(), { navigator: { globalPrivacyControl: true } }],
  ];
  for (const [name, config, runtimeOver] of cases) {
    const { runtime, calls } = baseRuntime(runtimeOver ?? {});
    const obs = createStatisticObserver(config, runtime);
    assert.equal(obs.setEnabled(true), false, name);
    assert.equal(obs.track('puzzle.started'), false, name);
    assert.equal(await obs.flush(), 0, name);
    assert.equal(obs.flushOnHide(), 0, name);
    assert.equal(calls.length, 0, name);
    assert.equal(obs.status().enabled, false, name);
    obs.dispose();
  }
});

test('bounds: batch at most 20, queue at most 100, requests at most 120', async () => {
  const { runtime, calls } = baseRuntime();
  const obs = createStatisticObserver(baseConfig(), runtime);
  assert.equal(obs.setEnabled(true), true);
  for (let i = 0; i < 25; i++) assert.equal(obs.track('puzzle.started'), true);
  assert.equal(await obs.flush(), 20);
  assert.equal(calls.length, 1);
  assert.equal(obs.status().queued, 5);
  assert.equal(await obs.flush(), 5);
  assert.equal(calls.length, 2);
  obs.dispose();

  const second = baseRuntime();
  const obs2 = createStatisticObserver(baseConfig(), second.runtime);
  assert.equal(obs2.setEnabled(true), true);
  for (let i = 0; i < 100; i++) assert.equal(obs2.track('puzzle.started'), true);
  assert.equal(obs2.track('puzzle.started'), false);
  assert.equal(obs2.status().queued, 100);
  obs2.dispose();

  const third = baseRuntime();
  const obs3 = createStatisticObserver(baseConfig(), third.runtime);
  assert.equal(obs3.setEnabled(true), true);
  for (let i = 0; i < 120; i++) {
    assert.equal(obs3.track('puzzle.started'), true);
    assert.equal(await obs3.flush(), 1);
  }
  assert.equal(third.calls.length, 120);
  assert.equal(obs3.track('puzzle.started'), false);
  assert.equal(await obs3.flush(), 0);
  assert.equal(third.calls.length, 120);
  obs3.dispose();
});
