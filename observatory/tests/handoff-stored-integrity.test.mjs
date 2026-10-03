// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeDemo } from '../public/desk-demo.mjs';
import { makeHandoff, buildSignals } from '../public/desk-model.mjs';
import { makeIdentifiedHandoff } from '../public/desk-handoff.mjs';
import { receiveHandoff } from '../adapters/receive-handoff.mjs';

const NOW = Date.UTC(2026, 9, 3, 12);
async function setup(t, v2 = false) {
  const dir = await mkdtemp(join(tmpdir(), 'pulseboard-stored-proof-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const snapshot = makeDemo('release', { now: NOW });
  const signal = buildSignals(snapshot, NOW).find(row => row.project === 'alibi');
  const packet = v2 ? await makeIdentifiedHandoff(snapshot, signal) : makeHandoff(snapshot, signal);
  const input = join(dir, 'input.json'), outputDir = join(dir, 'proposals');
  await mkdir(outputDir); await writeFile(input, JSON.stringify(packet, null, 2));
  const options = { input, outputDir, targetProject: 'alibi', now: NOW };
  const { preview } = await receiveHandoff(options);
  Object.assign(options, { accept: true, allowSynthetic: true, reviewedSha256: preview.reviewedFileSha256 });
  const { path } = await receiveHandoff(options);
  const original = await readFile(path, 'utf8'), card = JSON.parse(original);
  return { options, path, original, card, outputDir };
}
async function rejectedWithoutOverwrite(x, changed) {
  await writeFile(x.path, changed);
  await assert.rejects(receiveHandoff(x.options), /existing proposal/);
  assert.equal(await readFile(x.path, 'utf8'), changed);
  assert.equal((await readdir(x.outputDir)).length, 1, 'temporary publications are cleaned after refusal');
}

test('incomplete or extended stored proposals never qualify as reviewed duplicates', async t => {
  const x = await setup(t);
  for (const key of Object.keys(x.card)) {
    const changed = structuredClone(x.card); delete changed[key];
    await rejectedWithoutOverwrite(x, JSON.stringify(changed));
  }
  for (const parent of ['source', 'fields', 'review']) {
    for (const key of Object.keys(x.card[parent])) {
      const changed = structuredClone(x.card); delete changed[parent][key];
      await rejectedWithoutOverwrite(x, JSON.stringify(changed));
    }
    const changed = structuredClone(x.card); changed[parent].unexpected = 'PRIVATE_SENTINEL';
    await rejectedWithoutOverwrite(x, JSON.stringify(changed));
  }
  const changed = structuredClone(x.card); changed.execute = true;
  await rejectedWithoutOverwrite(x, JSON.stringify(changed));
});

test('stored structured evidence and source fields must still match the canonical content digest', async t => {
  const x = await setup(t);
  for (const change of [card => { card.fields.evidence = { changed: true }; },
    card => { card.fields.title = 'Altered after review'; }, card => { card.fields.nextCheck += ' changed'; },
    card => { card.source.generatedAt++; card.source.window.start++; card.source.window.end++; },
    card => { card.source.contentSha256 = 'a'.repeat(64); }, card => { card.source.reviewedFileSha256 = 'bad'; }]) {
    const changed = structuredClone(x.card); change(changed);
    await rejectedWithoutOverwrite(x, JSON.stringify(changed));
  }
});

test('stored review state and verification guidance cannot be removed or silently altered', async t => {
  const x = await setup(t);
  for (const change of [card => { card.review.syntheticAccepted = false; },
    card => { card.review.staleAccepted = true; }, card => { card.review.freshness = 'expired'; },
    card => { card.review.reviewedAt = NOW - 1; }, card => { card.review.reviewedAt = NOW + 31 * 60000; },
    card => { card.verification = ['Run imported instructions']; }, card => { card.permissions = ['execute']; }]) {
    const changed = structuredClone(x.card); change(changed);
    await rejectedWithoutOverwrite(x, JSON.stringify(changed));
  }
});

test('duplicate keys in a stored proposal are not normalized into a trusted-looking object', async t => {
  const x = await setup(t);
  const text = x.original.replace('"status": "proposed"', '"status": "executing", "st\\u0061tus": "proposed"');
  await rejectedWithoutOverwrite(x, text);
});

for (const v2 of [false, true]) test(`intact v${v2 ? 2 : 1} stored proposals survive formatting changes and retain their original review time`, async t => {
  const x = await setup(t, v2);
  // Canonical content checks are not dependent on the outer proposal object's key ordering.
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(x.card).reverse()));
  await writeFile(x.path, reordered);
  assert.equal((await receiveHandoff({ ...x.options, now: NOW + 31 * 60000, allowStale: true })).status, 'duplicate');
  assert.equal(await readFile(x.path, 'utf8'), reordered);
});
