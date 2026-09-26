import test from 'node:test';
import assert from 'node:assert/strict';
import { createPulseboard, maskMessage, scriptName, rate } from '../sdk/pulseboard-sdk.mjs';
import { config, makeRuntime, storage, settle, ORIGIN } from './sdk-fakes.mjs';

const choice = (counts, diagnostics, journeys) => storage({ 'pulseboard:consent:v3:demo': JSON.stringify({ counts, diagnostics, journeys, decided: true, month: '2026-09' }) });
const start = (local = choice(false, true, false), options = {}) => {
  const h = makeRuntime({ local, ...options });
  const sdk = createPulseboard(config(), h.runtime);
  sdk.mount();
  return { ...h, sdk };
};
const sentEvents = h => h.products().flatMap(c => c.body.events);

test('error text masking and script names', () => {
  assert.equal(maskMessage('user bob@example.com failed at https://site.test/a/b?x=1 id 1234567 ok 12345'),
    'user [email] failed at [url] id [number] ok 12345');
  assert.equal(maskMessage('x'.repeat(500)).length, 160);
  assert.equal(maskMessage('a\nb'), 'a b');
  assert.equal(scriptName('https://cdn.test/assets/app-3f2a.js?v=9#x', ORIGIN + '/page'), 'app-3f2a.js');
  assert.equal(scriptName(ORIGIN + '/docs/my-private-note?q=1', ORIGIN + '/docs/my-private-note'), 'inline');
  assert.equal(scriptName('https://site.test/documents/secret-name', ORIGIN + '/'), 'other');
  assert.equal(scriptName('', ORIGIN), '');
  for (const [metric, value, rating] of [['LCP', 2500, 'good'], ['LCP', 2501, 'needs-improvement'], ['LCP', 4001, 'poor'], ['CLS', 0.1, 'good'],
    ['CLS', 0.26, 'poor'], ['INP', 200, 'good'], ['INP', 350, 'needs-improvement'], ['FCP', 3100, 'poor'], ['TTFB', 900, 'needs-improvement']]) {
    assert.equal(rate(metric, value), rating, metric + value);
  }
});

test('js.error: at most ten per page, masked, file name only, resource errors ignored', async () => {
  const h = start();
  for (let i = 0; i < 15; i++) {
    h.runtime.emit('error', { message: 'Boom for a@b.io #' + i, filename: 'https://cdn.test/js/app.js?token=abc', lineno: 42 + i, error: { name: 'TypeError' } });
  }
  h.runtime.emit('error', { target: { src: 'https://cdn.test/img/private.png' } });
  h.runtime.emit('unhandledrejection', { reason: new RangeError('bad 99999999') });
  h.fire();
  await settle();
  const errors = sentEvents(h).filter(e => e.name === 'js.error');
  assert.equal(errors.length, 10);
  assert.deepEqual(errors[0].props, { kind: 'TypeError', message: 'Boom for [email] #0', source: 'app.js', line: 42 });
  assert.equal(JSON.stringify(errors).includes('token'), false);
  assert.equal(JSON.stringify(errors).includes('private.png'), false);
});

test('unhandled rejections report kind and a masked message', async () => {
  const h = start();
  h.runtime.emit('unhandledrejection', { reason: new RangeError('order 123456789 failed') });
  h.runtime.emit('unhandledrejection', { reason: 'plain string' });
  h.fire();
  await settle();
  const errors = sentEvents(h).filter(e => e.name === 'js.error').map(e => e.props);
  assert.deepEqual(errors, [
    { kind: 'RangeError', message: 'order [number] failed', source: '', line: 0 },
    { kind: 'rejection', message: 'plain string', source: '', line: 0 },
  ]);
});

test('web vitals: each metric once per page with web.dev ratings; INP from event timing', async () => {
  const h = start();
  h.emitEntries('paint', [{ name: 'first-paint', startTime: 50 }, { name: 'first-contentful-paint', startTime: 900.4 }]);
  h.emitEntries('paint', [{ name: 'first-contentful-paint', startTime: 950 }]);
  h.emitEntries('largest-contentful-paint', [{ startTime: 1200 }, { startTime: 2700 }]);
  h.emitEntries('layout-shift', [{ value: 0.05, startTime: 100, hadRecentInput: false }, { value: 0.5, startTime: 150, hadRecentInput: true },
    { value: 0.04, startTime: 400, hadRecentInput: false }, { value: 0.02, startTime: 3000, hadRecentInput: false }]);
  h.emitEntries('event', [{ interactionId: 3, duration: 120 }, { interactionId: 0, duration: 900 }, { interactionId: 4, duration: 260 }]);
  assert.equal(h.observers.find(o => o.options.type === 'event').options.durationThreshold, 40);
  h.document.visibilityState = 'hidden';
  h.document.emit('visibilitychange');
  h.document.visibilityState = 'visible';
  h.document.emit('visibilitychange');
  h.document.visibilityState = 'hidden';
  h.document.emit('visibilitychange');
  h.runtime.emit('pagehide', { persisted: true });
  await settle();
  const vitals = Object.fromEntries(sentEvents(h).filter(e => e.name === 'web.vital').map(e => [e.props.metric, e.props]));
  assert.deepEqual(Object.keys(vitals).sort(), ['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
  assert.equal(sentEvents(h).filter(e => e.name === 'web.vital').length, 5, 'once each');
  assert.deepEqual(vitals.FCP, { metric: 'FCP', value: 900, rating: 'good' });
  assert.deepEqual(vitals.LCP, { metric: 'LCP', value: 2700, rating: 'needs-improvement' });
  assert.deepEqual(vitals.CLS, { metric: 'CLS', value: 0.09, rating: 'good' });
  assert.deepEqual(vitals.INP, { metric: 'INP', value: 260, rating: 'needs-improvement' });
  assert.deepEqual(vitals.TTFB, { metric: 'TTFB', value: 400, rating: 'good' });
  assert.ok(sentEvents(h).every(e => e.name !== 'web.vital' || h.products().find(c => c.body.events.includes(e)).init.keepalive === true));
});

test('page.engaged: visible seconds and scroll depth, once, on the first hide', async () => {
  const h = start();
  h.tick(12400);
  h.runtime.scrollY = 700;
  h.runtime.emit('scroll');
  h.document.visibilityState = 'hidden';
  h.document.emit('visibilitychange');
  h.tick(60000);
  h.document.visibilityState = 'visible';
  h.document.emit('visibilitychange');
  h.tick(5000);
  h.runtime.emit('pagehide', { persisted: false });
  await settle();
  const engaged = sentEvents(h).filter(e => e.name === 'page.engaged');
  assert.equal(engaged.length, 1);
  assert.deepEqual(engaged[0].props, { seconds: 12, scroll: 75 });
  const long = start();
  long.tick(5 * 3600 * 1000);
  long.runtime.emit('pagehide', { persisted: false });
  await settle();
  assert.equal(sentEvents(long).find(e => e.name === 'page.engaged').props.seconds, 3600);
});

test('reserved diagnostics need the diagnostics category, whatever journeys says', async () => {
  const h = start(choice(true, false, true));
  h.emitEntries('paint', [{ name: 'first-contentful-paint', startTime: 500 }]);
  h.runtime.emit('error', { message: 'x', filename: 'a.js', lineno: 1 });
  h.runtime.emit('pagehide', { persisted: true });
  h.fire();
  await settle();
  const names = sentEvents(h).map(e => e.name);
  assert.equal(names.some(n => ['web.vital', 'js.error', 'page.engaged'].includes(n)), false);
  assert.ok(names.includes('page.view'), 'journeys still send');
});

test('turning diagnostics on later releases FCP and TTFB once; turning it off drops queued diagnostics', async () => {
  const h = start(choice(true, false, false));
  h.emitEntries('paint', [{ name: 'first-contentful-paint', startTime: 500 }]);
  h.sdk.consent.set({ diagnostics: true });
  h.fire();
  await settle();
  const vitals = sentEvents(h).filter(e => e.name === 'web.vital').map(e => e.props.metric).sort();
  assert.deepEqual(vitals, ['FCP', 'TTFB']);
  h.runtime.emit('error', { message: 'late', filename: 'a.js', lineno: 1 });
  assert.equal(h.sdk.status().queued.product, 1);
  h.sdk.consent.set({ diagnostics: false });
  assert.equal(h.sdk.status().queued.product, 0);
  h.runtime.emit('pagehide', { persisted: true });
  assert.equal(sentEvents(h).some(e => e.name === 'js.error' || e.name === 'page.engaged'), false);
});
