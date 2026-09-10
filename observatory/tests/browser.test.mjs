import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserver } from '../src/browser.mjs';
import { projects } from '../src/projects.mjs';
function setup(overrides = {}, response = async () => new Response('{}', { status: 202 })) {
  const calls = [], timers = new Map(); let index = 0;
  const runtime = { navigator: {}, location: { origin: projects.mdviewer.origin, protocol: 'https:' }, crypto, AbortController,
    fetch: async (...args) => { calls.push(args); return response(...args); },
    setTimeout: (fn, ms) => { const id = ++index; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id), ...overrides };
  const client = createObserver({ project: projects.mdviewer, endpoint: 'https://collector.example/v1/collect/mdviewer', origin: projects.mdviewer.origin }, runtime);
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
});
