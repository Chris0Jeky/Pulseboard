// SPDX-License-Identifier: GPL-3.0-only
/** Public synthetic producer vectors. No telemetry, credentials or consumer implementation is read. */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDemo } from '../public/desk-demo.mjs';
import { buildSignals, makeHandoff } from '../public/desk-model.mjs';
import { handoffIdentity, makeIdentifiedHandoff } from '../public/desk-handoff-export.mjs';

const NOW = Date.UTC(2026, 9, 3, 12);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

export async function buildHandoffFixtures() {
  const cases = [];
  for (const days of [1, 7, 14]) {
    const snapshot = makeDemo('release', { now: NOW, days });
    for (const scope of ['project', 'portfolio']) {
      const stale = scope === 'portfolio';
      const signals = buildSignals(snapshot, NOW, stale);
      const signal = signals.find(row => stale ? row.rule === 'snapshot.refresh_failed'
        : row.project === 'alibi' && row.rule === 'monitor.down');
      if (!signal) throw new Error('Synthetic producer observation is unavailable');
      for (const version of [1, 2]) {
        const packet = version === 1 ? makeHandoff(snapshot, signal, stale)
          : await makeIdentifiedHandoff(snapshot, signal, stale);
        const text = JSON.stringify(packet, null, 2) + '\n';
        cases.push({ id: `${scope}-${days}d-v${version}`, text, fileSha256: digest(text),
          ...await handoffIdentity(packet) });
      }
    }
  }
  return { schema: 'pulseboard.handoff-fixtures/1', synthetic: true,
    description: 'Invented producer conformance vectors. Never treat these files as live evidence.', cases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node adapters/handoff-fixtures.mjs (writes synthetic JSON to stdout only)');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await buildHandoffFixtures(), null, 2));
  }
}
