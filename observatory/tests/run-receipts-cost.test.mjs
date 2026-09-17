import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { importRunReceiptFile, readRunReceiptSummary } from '../run-receipts/store.mjs';

const start = '2026-09-01T00:00:00.000Z';
const end = '2026-09-02T00:00:00.000Z';
const generatedAt = '2026-09-02T00:01:00.000Z';
const receipt = (id, run, startedAt, endedAt, kind, minor) => ({
  id,
  run,
  project: 'commitatlas',
  startedAt,
  endedAt,
  status: 'succeeded',
  attempt: 1,
  retryOf: null,
  resources: [{ unit: 'runner_seconds', value: 10 }],
  cost: { kind, minor, currency: 'USD', sourceTime: generatedAt },
  outcome: { state: 'verified-accepted', verificationRef: `check-${run}` },
});
function document({ complete = true, kinds = ['estimated', 'estimated'] } = {}) {
  return {
    schema: 'pulseboard.run-receipts/1',
    source: { kind: 'github-actions-file', id: 'cost-export' },
    generatedAt,
    coverage: { start, end, complete, limitations: complete ? ['manual-export'] : ['manual-export', 'partial-history'] },
    receipts: [
      receipt('cost-1', '1', '2026-09-01T01:00:00.000Z', '2026-09-01T01:00:10.000Z', kinds[0], 10),
      receipt('cost-2', '2', '2026-09-01T02:00:00.000Z', '2026-09-01T02:00:10.000Z', kinds[1], 20),
    ],
  };
}
const encode = value => JSON.stringify(value);
function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const options = { project: 'commitatlas', start: Date.parse(start), end: Date.parse(end) };

test('mixed actual and estimated costs stay separate and produce an abstention', async t => {
  const DB = database(t), input = document({ kinds: ['actual', 'estimated'] });
  await importRunReceiptFile(DB, encode(input));
  const summary = await readRunReceiptSummary(DB, options);
  assert.deepEqual(summary.costs.map(cost => [cost.kind, cost.currency, cost.minor]), [
    ['actual', 'USD', 10],
    ['estimated', 'USD', 20],
  ]);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /mixes cost kinds\/currencies/i);

  const conflict = structuredClone(input);
  conflict.receipts[0].resources[0].value = 11;
  await assert.rejects(importRunReceiptFile(DB, encode(conflict)), /conflicting run receipt identity/i);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, 2);
});

test('incomplete source coverage prevents a unit-cost claim even with one currency and kind', async t => {
  const DB = database(t);
  await importRunReceiptFile(DB, encode(document({ complete: false })));
  const summary = await readRunReceiptSummary(DB, options);
  assert.equal(summary.outcomes['verified-accepted'], 2);
  assert.equal(summary.coverage.complete, false);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /coverage is incomplete/i);
});

test('a complete export cannot certify a wider summary window than it covers', async t => {
  const DB = database(t), input = document();
  input.coverage.start = '2026-09-01T00:30:00.000Z';
  input.coverage.end = '2026-09-01T03:00:00.000Z';
  await importRunReceiptFile(DB, encode(input));

  const summary = await readRunReceiptSummary(DB, options);
  assert.equal(summary.attempts.receipts, 2);
  assert.equal(summary.outcomes['verified-accepted'], 2);
  assert.equal(summary.coverage.complete, false);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /coverage is incomplete/i);
});

function splitCoverage(sameSource) {
  const first = document(), second = document();
  first.source.id = 'source-a';
  second.source.id = sameSource ? 'source-a' : 'source-b';
  first.coverage.end = second.coverage.start = '2026-09-01T12:00:00.000Z';
  first.receipts = [first.receipts[0]];
  second.receipts = [receipt('cost-2', '2', '2026-09-01T13:00:00.000Z',
    '2026-09-01T13:00:10.000Z', 'estimated', 20)];
  return [first, second];
}

test('different sources cannot fill one another\'s coverage gaps', async t => {
  const DB = database(t);
  for (const input of splitCoverage(false)) await importRunReceiptFile(DB, encode(input));
  const summary = await readRunReceiptSummary(DB, options);
  assert.equal(summary.coverage.sources, 2);
  assert.equal(summary.attempts.receipts, 2);
  assert.equal(summary.coverage.complete, false);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /coverage is incomplete/i);
});

test('adjacent complete exports from the same source can cover the window', async t => {
  const DB = database(t);
  for (const input of splitCoverage(true)) await importRunReceiptFile(DB, encode(input));
  const summary = await readRunReceiptSummary(DB, options);
  assert.equal(summary.coverage.sources, 1);
  assert.equal(summary.coverage.complete, true);
  assert.equal(summary.costPerVerifiedAccepted.valueMinor, 15);
});

test('colon-bearing source and run identifiers stay distinct', async t => {
  const DB = database(t), first = document(), second = document();
  first.source.id = 'a:b';
  second.source.id = 'a';
  first.receipts = [{ ...first.receipts[0], run: 'c' }];
  second.receipts = [{ ...second.receipts[1], run: 'b:c' }];
  for (const input of [first, second]) await importRunReceiptFile(DB, encode(input));
  const summary = await readRunReceiptSummary(DB, options);
  assert.equal(summary.attempts.receipts, 2);
  assert.equal(summary.attempts.distinctRuns, 2);
  assert.equal(summary.coverage.sources, 2);
  assert.equal(summary.coverage.complete, true);
  assert.equal(summary.costPerVerifiedAccepted.valueMinor, 15);
});
