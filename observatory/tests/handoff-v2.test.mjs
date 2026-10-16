// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeDemo } from '../public/desk-demo.mjs';
import { buildSignals, makeHandoff } from '../public/desk-model.mjs';
import { parseHandoff, handoffIdentity } from '../public/desk-handoff.mjs';

const NOW = Date.UTC(2026, 9, 3, 12), DAY = 86400000;
const sha = value => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
function fixture() {
  const snapshot = makeDemo('release', { now: NOW });
  const signal = buildSignals(snapshot, NOW).find(row => row.project === 'alibi' && row.rule === 'monitor.down');
  return { snapshot, signal };
}

test('makeHandoff defaults to v2 with the specified title-based SHA-256 and every v1 field', async () => {
  const { snapshot, signal } = fixture();
  const packet = await makeHandoff(snapshot, signal, true);
  const expected = sha(['alibi', 'monitor.down', 'desk-rules/1', 'alibi is failing its site check']);
  assert.deepEqual(packet, {
    schema: 'pulseboard.handoff/2', fingerprint: expected.slice(0, 12),
    mode: snapshot.mode, generatedAt: snapshot.generatedAt, stale: true,
    destination: 'review-before-import', title: signal.title, project: signal.project,
    observation: signal.detail, evidence: signal.evidence, nextCheck: signal.next,
    rule: { id: signal.rule, version: signal.version }, window: snapshot.window,
    boundaries: ['No automatic task creation or execution.', 'Contains aggregates, not event rows.', 'Review before sharing.'],
  });
  assert.deepEqual(await parseHandoff(JSON.stringify(packet)), packet);
  const { fingerprint, ...legacy } = packet;
  legacy.schema = 'pulseboard.handoff/1';
  assert.deepEqual(await parseHandoff(JSON.stringify(legacy)), legacy);
  assert.equal((await handoffIdentity(legacy)).fingerprint, fingerprint);
});

test('refreshes, evidence changes and all supported windows preserve the problem fingerprint', async () => {
  const { snapshot, signal } = fixture();
  const original = await makeHandoff(snapshot, signal);
  assert.match(original.fingerprint, /^[a-f0-9]{12}$/);
  for (const days of [1, 7, 14]) {
    const refreshed = makeDemo('release', { now: NOW + DAY, days });
    const changed = { ...signal, key: 'a different review key', evidence: { failures: 17 } };
    const packet = await makeHandoff(refreshed, changed, true);
    assert.equal(packet.fingerprint, original.fingerprint);
    assert.notEqual(packet.generatedAt, original.generatedAt);
    assert.notDeepEqual(packet.window, original.window);
    assert.notDeepEqual(packet.evidence, original.evidence);
  }
});

test('title normalization lowercases and collapses ECMAScript whitespace while preserving numbers, dates and punctuation', async () => {
  const { snapshot, signal } = fixture();
  const fingerprint = async title => (await makeHandoff(snapshot, { ...signal, title })).fingerprint;
  const original = await fingerprint('Alibi ERROR 503 on 2026-10-03: Café');
  assert.equal(await fingerprint(' \tALIBI\nERROR\u00a0503 ON 2026-10-03: CAFÉ\r\n'), original);
  for (const title of ['Alibi error 504 on 2026-10-03: Café', 'Alibi error 503 on 2026-10-04: Café',
    'Alibi error 503 on 2026-10-03; Café', 'Alibi error 503 on 2026-10-03: Cafe\u0301']) {
    assert.notEqual(await fingerprint(title), original);
  }
});

test('different project, rule id, rule version or normalized title gives a different fingerprint', async () => {
  const { snapshot, signal } = fixture();
  const original = await makeHandoff(snapshot, signal);
  for (const change of [{ project: 'mdviewer' }, { project: null }, { rule: 'monitor.stale' },
    { version: 'desk-rules/2' }, { title: 'A different problem' }]) {
    assert.notEqual((await makeHandoff(snapshot, { ...signal, ...change })).fingerprint, original.fingerprint);
  }
});

test('v2 rejects a fingerprint computed with the earlier title-free identity', async () => {
  const { snapshot, signal } = fixture();
  const packet = await makeHandoff(snapshot, signal);
  packet.schema = 'pulseboard.handoff/2';
  packet.fingerprint = sha([packet.project, packet.rule.id, packet.rule.version]).slice(0, 12);
  await assert.rejects(parseHandoff(JSON.stringify(packet)), /fingerprint/);
});
