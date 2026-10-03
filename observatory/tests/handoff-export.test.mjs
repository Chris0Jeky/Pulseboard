// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from '../public/desk-demo.mjs';
import { buildSignals, makeHandoff } from '../public/desk-model.mjs';
import { makeIdentifiedHandoff as browserExport } from '../public/desk-handoff-export.mjs';
import { makeIdentifiedHandoff as checkedExport, parseHandoff } from '../public/desk-handoff.mjs';

const NOW = Date.UTC(2026, 9, 3, 12);
test('the small browser producer emits receiver-valid v2 for every demo rule and supported window', async () => {
  let checked = 0;
  for (const scenario of ['release', 'quiet', 'blind', 'pressure']) for (const days of [1, 7, 14]) {
    const snapshot = makeDemo(scenario, { days, now: NOW });
    for (const signal of buildSignals(snapshot, NOW)) {
      const packet = await browserExport(snapshot, signal);
      assert.deepEqual(await parseHandoff(JSON.stringify(packet)), packet);
      assert.deepEqual(packet, await checkedExport(snapshot, signal));
      const { schema, fingerprint, ...fields } = packet;
      const { schema: _v1, ...original } = makeHandoff(snapshot, signal);
      assert.equal(schema, 'pulseboard.handoff/2');
      assert.match(fingerprint, /^[a-f0-9]{12}$/);
      assert.deepEqual(fields, original);
      checked++;
    }
  }
  assert.ok(checked >= 20);
});

test('the producer freezes evidence and window before asynchronous hashing', async () => {
  const snapshot = makeDemo('release', { now: NOW });
  const signal = buildSignals(snapshot, NOW)[0];
  const expected = structuredClone(makeHandoff(snapshot, signal, true));
  const preparing = browserExport(snapshot, signal, true);
  snapshot.window.start = 0;
  signal.evidence.mutated = true;
  signal.detail = 'changed during preparation';
  const packet = await preparing;
  assert.deepEqual(packet.evidence, expected.evidence);
  assert.deepEqual(packet.window, expected.window);
  assert.equal(packet.observation, expected.observation);
  assert.equal(packet.stale, true);
});
