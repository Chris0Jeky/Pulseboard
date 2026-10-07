import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from '../public/desk-demo.mjs';
import { STALE_AFTER } from '../public/desk-model.mjs';
const module = await import('../public/desk-operations.mjs').catch(() => ({}));
const now = Date.UTC(2026, 9, 7, 12);
function read(snapshot, id = 'alibi', at = now, failed = false) {
  assert.equal(typeof module.operationReading, 'function', 'operation reading must exist');
  return module.operationReading(snapshot, id, at, failed);
}
test('operation reading carries a detached source window and complete release detail', () => {
  const s = makeDemo('blind', { now }), view = read(s);
  assert.equal(view.project, 'alibi'); assert.equal(view.sourceSchema, 'pulseboard.portfolio/3');
  assert.equal(view.mode, 'demo'); assert.equal(view.detailAvailable, true);
  assert.deepEqual(view.window, s.window);
  const copy = structuredClone(view); s.projects[0].operations[0].unmatched.completed++; s.window.days = 14;
  assert.deepEqual(view, copy);
});
test('operation reading marks absent v2 detail as unavailable, not zero', () => {
  const s = makeDemo('quiet', { now }); s.schema = 'pulseboard.portfolio/2';
  for (const p of s.projects) { delete p.operations; }
  const view = read(s); assert.equal(view.detailAvailable, false); assert.deepEqual(view.operations, []);
});
for (const [label, at, failed] of [['failed refresh',now,true],['expired',now+STALE_AFTER+1,false],['future',now-1,false]]) {
  test(`operation reading marks ${label} as last-known`, () => {
    assert.equal(read(makeDemo('blind',{now}), 'alibi', at, failed).lastKnown, true);
  });
}
test('operation reading refuses unknown project, unbounded time and malformed evidence', () => {
  const s = makeDemo('blind', { now });
  assert.throws(() => read(s, 'unknown')); assert.throws(() => read(s, 'alibi', NaN));
  s.schema = 'pulseboard.portfolio/3'; delete s.projects[0].operations;
  assert.throws(() => read(s));
});
