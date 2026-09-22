import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';
function setup(overrides = {}, response = async () => new Response('{}', { status: 202 }), config = {}) {
  const calls = [], timers = new Map(); let index = 0;
  const project = config.project ?? projects.mdviewer, origin = config.origin ?? project.origin;
  const runtime = { navigator: {}, location: { origin, protocol: 'https:' }, crypto, AbortController,
    fetch: async (...args) => { calls.push(args); return response(...args); },
    setTimeout: (fn, ms) => { const id = ++index; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id), ...overrides };
  const client = createObserver({ project, endpoint: 'https://collector.example/v1/collect/mdviewer', origin, ...config }, runtime);
  return { calls, timers, runtime, client };
}
test('nothing happens before consent', async () => {
  const { client, calls, timers } = setup(); assert.equal(client.track('page.view'), false); await client.flush(); assert.equal(calls.length, 0); assert.equal(timers.size, 0);
});
for (const [name, override] of Object.entries({ GPC: { navigator: { globalPrivacyControl: true } }, DNT: { navigator: { doNotTrack: '1' } }, webdriver: { navigator: { webdriver: true } }, offline: { location: { origin: 'null', protocol: 'file:' } }, local: { location: { origin: 'http://127.0.0.1', protocol: 'http:' } }, wrongOrigin: { location: { origin: 'https://fork.test', protocol: 'https:' } } })) {
  test(name + ' prevents consent and collection', () => { const { client } = setup(override); assert.equal(client.setConsent(true), false); assert.equal(client.track('page.view'), false); });
}
test('transport omits cookies, referrer and redirects', async () => {
  const { client, calls } = setup(); client.setConsent(true); client.track('page.view'); await client.flush();
  const options = calls[0][1]; assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
  assert.equal(JSON.parse(options.body).events[0].event, 'page.view'); assert.equal(client.status().sent, 1); client.dispose();
});
test('registered route and release overrides are accepted and bounded', async () => {
  const project = { ...projects.mdviewer, releases: ['unattributed', '0.11.3'] };
  const { client, calls } = setup({}, undefined, { project, route: 'home', release: 'unattributed' });
  client.setConsent(true);
  assert.equal(client.track('page.view', { route: 'editor', release: '0.11.3' }), true);
  assert.equal(client.track('page.view', { route: 'private', release: '0.11.3' }), false);
  assert.equal(client.track('page.view', { route: 'editor', release: 'private-build' }), false);
  await client.flush();
  const [event] = JSON.parse(calls[0][1].body).events;
  assert.equal(event.route, 'editor'); assert.equal(event.release, '0.11.3'); assert.equal(client.status().dropped, 2); client.dispose();
});
test('raw data and arbitrary properties never leave the client', async () => {
  const { client, calls } = setup(); client.setConsent(true); assert.equal(client.track('page.view', { title: 'private document' }), false);
  assert.equal(client.track('SECRET'), false); await client.flush(); assert.equal(calls.length, 0); client.dispose();
});
test('revocation clears buffered data and aborts in-flight request; rejected events never revive', async () => {
  let reject; const { client, calls } = setup({}, () => new Promise((_r, j) => { reject = j; }));
  client.setConsent(true); client.track('page.view'); const pending = client.flush();
  client.setConsent(false); assert.equal(calls[0][1].signal.aborted, true); reject(new Error('network')); await pending;
  client.setConsent(true); assert.equal(client.status().queued, 0); await client.flush(); assert.equal(calls.length, 1); client.dispose();
});
test('queue and batch sizes are bounded', async () => {
  const { client, calls } = setup(); client.setConsent(true); for (let i = 0; i < 150; i++) client.track('page.view');
  assert.equal(client.status().queued, 100); assert.equal(client.status().dropped, 50); await client.flush(); assert.equal(JSON.parse(calls[0][1].body).events.length, 20); client.dispose();
});
test('privacy signals changed mid-session stop reporting', async () => {
  const { client, runtime, calls } = setup(); client.setConsent(true); client.track('page.view'); runtime.navigator.globalPrivacyControl = true;
  await client.flush(); assert.equal(calls.length, 0); assert.equal(client.track('page.view'), false); assert.equal(client.status().queued, 0); client.dispose();
});
test('concurrent flush does not duplicate a batch', async () => {
  let resolve; const { client, calls } = setup({}, () => new Promise(r => { resolve = r; }));
  client.setConsent(true); client.track('page.view'); const a = client.flush(); await client.flush(); assert.equal(calls.length, 1);
  resolve(new Response('{}')); await a; client.dispose();
});
test('failure circuit opens without retrying old events', async () => {
  const { client, calls } = setup({}, async () => { throw new Error('offline'); }); client.setConsent(true);
  for (let i = 0; i < 3; i++) { client.track('page.view'); await client.flush(); }
  assert.equal(client.track('page.view'), false); assert.equal(calls.length, 3); assert.equal(client.status().queued, 0); client.dispose();
});
test('a hidden page hands its remaining queue over with keepalive, without cookies', async () => {
  const { client, calls } = setup(); client.setConsent(true);
  client.track('page.view'); client.track('action.requested');
  assert.equal(client.flushOnHide(), 2); assert.equal(calls.length, 1);
  const options = calls[0][1];
  assert.equal(options.keepalive, true); assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
  assert.equal(JSON.parse(options.body).events.length, 2); assert.equal(client.status().queued, 0);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(client.status().sent, 2);
  client.dispose(); assert.equal(client.flushOnHide(), 0); assert.equal(calls.length, 1);
});
test('a hidden page sends nothing without consent, and drains more than one batch', async () => {
  const withoutConsent = setup(); assert.equal(withoutConsent.client.flushOnHide(), 0); assert.equal(withoutConsent.calls.length, 0);
  const { client, calls } = setup(); client.setConsent(true); for (let i = 0; i < 25; i++) client.track('page.view');
  assert.equal(client.flushOnHide(), 25); assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0][1].body).events.length, 20); assert.equal(JSON.parse(calls[1][1].body).events.length, 5);
  client.dispose();
});
test('dispose never flushes', async () => {
  const { client, calls, timers } = setup(); client.setConsent(true); client.track('page.view'); client.dispose(); await client.flush(); assert.equal(calls.length, 0); assert.equal(timers.size, 0);
});const hang = (_url, options) => new Promise((_resolve, reject) => {
  options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
});
const lastTimer = timers => [...timers.entries()].at(-1);
test('a consent deadline passing mid-session stops the next flush and fails closed', async t => {
  const { client, calls } = setup(); const start = Date.now();
  assert.equal(client.setConsent(true, start + 1000), true); assert.equal(client.track('page.view'), true);
  t.mock.method(Date, 'now', () => start + 1001);
  await client.flush(); assert.equal(calls.length, 0);
  assert.equal(client.status().active, false); assert.equal(client.status().queued, 0); assert.equal(client.track('page.view'), false);
  assert.equal(client.setConsent(true, Number.NaN), false);
  // A coercible string or null is not a deadline: it refuses consent rather than coercing to a future time.
  assert.equal(client.setConsent(true, String(start + 86400000)), false); assert.equal(client.setConsent(true, null), false);
  client.dispose();
});
test('a batch in flight at pagehide is reissued once with keepalive and the same ids', async () => {
  let admit; const original = new Promise(resolve => { admit = resolve; });
  const { client, calls } = setup({}, (_url, options) => options.keepalive ? Promise.resolve(new Response('{}', { status: 202 })) : original);
  client.setConsent(true); client.track('page.view'); const pending = client.flush(); client.track('action.requested');
  assert.equal(client.flushOnHide(), 2); assert.equal(calls.length, 3);
  const ids = call => JSON.parse(call[1].body).events.map(event => event.id);
  assert.deepEqual(ids(calls[1]), ids(calls[0])); assert.equal(calls[1][1].keepalive, true); assert.equal(calls[1][1].credentials, 'omit');
  assert.equal(calls[1][1].signal, undefined); assert.equal(JSON.parse(calls[2][1].body).events[0].event, 'action.requested');
  assert.equal(client.flushOnHide(), 0); assert.equal(calls.length, 3);
  // A bfcache pagehide keeps the original request alive; its late acknowledgment must not count the batch twice.
  admit(new Response('{}', { status: 202 })); await pending; await new Promise(resolve => setImmediate(resolve));
  const { sent, dropped, failures, unknown } = client.status(); assert.deepEqual({ sent, dropped, failures, unknown }, { sent: 2, dropped: 0, failures: 0, unknown: 0 });
  client.dispose();
});
test('keepalive handover prefers the in-flight batch and stays within 64 KiB', async () => {
  const project = { ...projects.mdviewer, releases: ['unattributed', 'r'.repeat(1700)] };
  const { client, calls } = setup({}, hang, { project, release: 'r'.repeat(1700) });
  client.setConsent(true); for (let i = 0; i < 20; i++) client.track('page.view'); const pending = client.flush();
  for (let i = 0; i < 20; i++) client.track('page.view');
  assert.equal(client.flushOnHide(), 20); assert.equal(calls.length, 2); assert.equal(client.status().queued, 20);
  assert.equal(calls[1][1].body, calls[0][1].body);
  const bytes = calls.filter(call => call[1].keepalive).reduce((sum, call) => sum + new TextEncoder().encode(call[1].body).byteLength, 0);
  assert.ok(bytes > 32768 && bytes <= 65536, String(bytes)); client.dispose(); await pending;
});
test('a slow admitted request is unknown, not failed, and never opens the circuit', async () => {
  const { client, calls, timers } = setup({}, hang); client.setConsent(true);
  for (let i = 0; i < 4; i++) {
    client.track('page.view'); const pending = client.flush(); const [id, timer] = lastTimer(timers);
    assert.equal(timer.ms, i === 0 ? 10000 : 5000); timers.delete(id); timer.fn(); await pending;
  }
  const { sent, dropped, failures, unknown } = client.status();
  assert.deepEqual({ sent, dropped, failures, unknown }, { sent: 0, dropped: 0, failures: 0, unknown: 4 });
  assert.equal(calls.length, 4); assert.equal(client.track('page.view'), true); client.dispose();
});
test('three genuine failures still open the circuit after timeouts', async () => {
  let offline = false;
  const { client, calls, timers } = setup({}, async (url, options) => { if (offline) throw new TypeError('offline'); return hang(url, options); });
  client.setConsent(true);
  for (let i = 0; i < 2; i++) { client.track('page.view'); const pending = client.flush(); const [id, timer] = lastTimer(timers); timers.delete(id); timer.fn(); await pending; }
  offline = true;
  for (let i = 0; i < 3; i++) { assert.equal(client.track('page.view'), true); await client.flush(); }
  assert.equal(client.track('page.view'), false); assert.equal(calls.length, 5);
  assert.equal(client.status().failures, 3); assert.equal(client.status().unknown, 2); client.dispose();
});
test('a successful keepalive handover resets the failure streak like a normal success', async () => {
  let mode = 'fail', admit;
  const { client } = setup({}, async (_url, options) => {
    if (options.keepalive) return new Response('{}', { status: 202 });
    if (mode === 'fail') throw new TypeError('offline');
    return new Promise(resolve => { admit = resolve; });
  });
  client.setConsent(true);
  for (let i = 0; i < 2; i++) { client.track('page.view'); await client.flush(); }
  mode = 'hang'; client.track('page.view'); const pending = client.flush();
  assert.equal(client.flushOnHide(), 1); await new Promise(resolve => setImmediate(resolve));
  admit(new Response('{}', { status: 202 })); await pending;
  // A bfcache restore: one more failure must not open the breaker after the delivered handover.
  mode = 'fail'; client.track('page.view'); await client.flush();
  assert.equal(client.track('page.view'), true); assert.equal(client.status().failures, 3); client.dispose();
});
test('a handed-over batch counts once: sent if either attempt succeeds, dropped only when both fail', async () => {
  for (const [keepaliveOk, originalOk, expected] of [[false, true, { sent: 1, dropped: 0 }], [true, false, { sent: 1, dropped: 0 }], [false, false, { sent: 0, dropped: 1 }]]) {
    let answer;
    const { client } = setup({}, (_url, options) => options.keepalive
      ? Promise.resolve(new Response('{}', { status: keepaliveOk ? 202 : 503 }))
      : new Promise((resolve, reject) => { answer = () => originalOk ? resolve(new Response('{}', { status: 202 })) : reject(new TypeError('offline')); }));
    client.setConsent(true); client.track('page.view'); const pending = client.flush();
    assert.equal(client.flushOnHide(), 1); await new Promise(resolve => setImmediate(resolve));
    answer(); await pending;
    const { sent, dropped, unknown } = client.status();
    assert.deepEqual({ sent, dropped, unknown }, { ...expected, unknown: 0 }, JSON.stringify({ keepaliveOk, originalOk }));
    client.dispose();
  }
});
test('fully failed handovers count toward the circuit, once per batch', async () => {
  const { client, calls } = setup({}, (_url, options) => options.keepalive
    ? Promise.resolve(new Response('{}', { status: 503 })) : Promise.reject(new TypeError('offline')));
  client.setConsent(true);
  for (let i = 0; i < 3; i++) {
    client.track('page.view'); const pending = client.flush();
    // A persisted (bfcache) pagehide hands the in-flight batch over; both attempts then fail.
    assert.equal(client.flushOnHide(), 1); await pending; await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(client.status().dropped, 3); assert.equal(client.track('page.view'), false); assert.equal(calls.length, 6);
  client.dispose();
});
