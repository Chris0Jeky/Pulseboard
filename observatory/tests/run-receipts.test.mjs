import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { assets } from '../src/assets.mjs';
import { makePublicPulse } from '../public/desk-bridge.mjs';
import { parseRunReceiptFile, previewRunReceiptFile } from '../run-receipts/contracts.mjs';
import { importRunReceiptFile, readRunReceiptSummary } from '../run-receipts/store.mjs';
import { makeRunReceiptQuestionCard } from '../run-receipts/model.mjs';

const generatedAt = '2026-09-02T00:05:00.000Z';
const coverage = {
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-09-02T00:00:00.000Z',
  complete: true,
  limitations: ['manual-export', 'provider-retries-unavailable'],
};
const receipt = ({
  id,
  run,
  project = 'commitatlas',
  startedAt,
  endedAt,
  status,
  attempt = 1,
  retryOf = null,
  runnerSeconds,
  costMinor,
  outcomeState = 'unverified',
  verificationRef = null,
}) => ({
  id,
  run,
  project,
  startedAt,
  endedAt,
  status,
  attempt,
  retryOf,
  resources: [{ unit: 'runner_seconds', value: runnerSeconds }],
  cost: costMinor === null ? null : {
    kind: 'estimated',
    minor: costMinor,
    currency: 'USD',
    sourceTime: generatedAt,
  },
  outcome: { state: outcomeState, verificationRef },
});

function fixture() {
  return {
    schema: 'pulseboard.run-receipts/1',
    source: { kind: 'github-actions-file', id: 'github-actions-export' },
    generatedAt,
    coverage,
    receipts: [
      receipt({ id: 'gha-100-1', run: '100', startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-01T00:01:00.000Z',
        status: 'succeeded', runnerSeconds: 60, costMinor: 10, outcomeState: 'verified-accepted', verificationRef: 'check-100' }),
      receipt({ id: 'gha-101-1', run: '101', startedAt: '2026-09-01T01:00:00.000Z', endedAt: '2026-09-01T01:00:30.000Z',
        status: 'cancelled', runnerSeconds: 30, costMinor: 5 }),
      receipt({ id: 'gha-102-1', run: '102', startedAt: '2026-09-01T02:00:00.000Z', endedAt: '2026-09-01T02:00:20.000Z',
        status: 'failed', runnerSeconds: 20, costMinor: 3 }),
      receipt({ id: 'gha-102-2', run: '102', startedAt: '2026-09-01T02:05:00.000Z', endedAt: '2026-09-01T02:05:25.000Z',
        status: 'succeeded', attempt: 2, retryOf: 'gha-102-1', runnerSeconds: 25, costMinor: 4,
        outcomeState: 'verified-accepted', verificationRef: 'check-102' }),
      receipt({ id: 'gha-200-1', run: '200', project: 'alibi', startedAt: '2026-09-01T03:00:00.000Z',
        endedAt: '2026-09-01T03:00:10.000Z', status: 'cancelled', runnerSeconds: 10, costMinor: null }),
    ],
  };
}
const text = value => JSON.stringify(value);

function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}

test('a bounded GitHub Actions file previews aggregates without exposing run identities', () => {
  const parsed = parseRunReceiptFile(text(fixture()));
  assert.equal(parsed.schema, 'pulseboard.private-run-receipts/1');
  assert.equal(parsed.visibility, 'private');
  assert.equal(parsed.trust, 'unverified-file');
  assert.equal(parsed.receipts.length, 5);
  assert.equal(parsed.receipts[3].durationMs, 25_000);

  const preview = previewRunReceiptFile(text(fixture()));
  assert.deepEqual(preview.projects, [
    { project: 'alibi', receipts: 1 },
    { project: 'commitatlas', receipts: 4 },
  ]);
  assert.deepEqual(preview.statuses, { succeeded: 2, failed: 1, cancelled: 2, 'timed-out': 0, skipped: 0 });
  assert.equal(preview.totalDurationMs, 145_000);
  assert.deepEqual(preview.resources, [{ unit: 'runner_seconds', value: 145 }]);
  assert.equal(preview.visibility, 'private');
  assert.deepEqual(preview.redacted, ['receipt ids', 'run ids', 'retry links', 'verification references']);

  const serialized = JSON.stringify(preview);
  for (const secret of ['gha-100-1', 'gha-102-1', 'check-100', 'check-102']) assert.equal(serialized.includes(secret), false, secret);
});

test('the closed receipt contract rejects unknown, unsafe, ambiguous and unbounded input', () => {
  const invalid = [];
  const withPrompt = fixture(); withPrompt.receipts[0].prompt = 'private source code'; invalid.push(withPrompt);
  const badProject = fixture(); badProject.receipts[0].project = 'unknown-project'; invalid.push(badProject);
  const badUnit = fixture(); badUnit.receipts[0].resources[0].unit = 'usd'; invalid.push(badUnit);
  const badCurrency = fixture(); badCurrency.receipts[0].cost.currency = 'usd'; invalid.push(badCurrency);
  const badRetry = fixture(); badRetry.receipts[3].retryOf = 'missing-receipt'; invalid.push(badRetry);
  const duplicate = fixture(); duplicate.receipts[1].id = duplicate.receipts[0].id; invalid.push(duplicate);
  const unsafeSource = fixture(); unsafeSource.source.id = 'ghp_EXAMPLECREDENTIAL'; invalid.push(unsafeSource);
  const unsafeLimitation = fixture(); unsafeLimitation.coverage.limitations = ['https://private.example']; invalid.push(unsafeLimitation);
  const wrongOutcome = fixture(); wrongOutcome.receipts[0].outcome.verificationRef = null; invalid.push(wrongOutcome);
  const extraEnvelope = fixture(); extraEnvelope.taskBody = 'instruction-shaped imported text'; invalid.push(extraEnvelope);

  for (const candidate of invalid) assert.throws(() => parseRunReceiptFile(text(candidate)), TypeError);
  assert.throws(() => parseRunReceiptFile(' '.repeat(262_145)), /256 KiB/i);
});

test('import is atomic and idempotent, and project totals reconcile retries and cancellations', async t => {
  const db = database(t);
  const first = await importRunReceiptFile(db, text(fixture()), { now: Date.parse(generatedAt) + 1 });
  assert.deepEqual(first, { received: 5, imported: 5, duplicates: 0, visibility: 'private' });
  const second = await importRunReceiptFile(db, text(fixture()), { now: Date.parse(generatedAt) + 2 });
  assert.deepEqual(second, { received: 5, imported: 0, duplicates: 5, visibility: 'private' });

  const bad = fixture(); bad.receipts.push({ ...bad.receipts[0], id: 'gha-invalid', resources: [{ unit: 'unknown', value: 1 }] });
  await assert.rejects(importRunReceiptFile(db, text(bad)), TypeError);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, 5);

  const summary = await readRunReceiptSummary(db, {
    project: 'commitatlas',
    start: Date.parse(coverage.start),
    end: Date.parse(coverage.end),
  });
  assert.equal(summary.schema, 'pulseboard.private-run-summary/1');
  assert.equal(summary.visibility, 'private');
  assert.deepEqual(summary.statuses, { succeeded: 2, failed: 1, cancelled: 1, 'timed-out': 0, skipped: 0 });
  assert.deepEqual(summary.attempts, { receipts: 4, distinctRuns: 3, retries: 1 });
  assert.equal(summary.durationMs, 135_000);
  assert.deepEqual(summary.resources, [{ unit: 'runner_seconds', value: 135 }]);
  assert.deepEqual(summary.costs, [{ kind: 'estimated', currency: 'USD', minor: 22, receipts: 4,
    sourceTime: { earliest: Date.parse(generatedAt), latest: Date.parse(generatedAt) } }]);
  assert.deepEqual(summary.outcomes, { 'verified-accepted': 2, 'verified-rejected': 0, unverified: 2, 'not-applicable': 0 });
  assert.deepEqual(summary.costPerVerifiedAccepted, {
    kind: 'estimated', currency: 'USD', numeratorMinor: 22, denominator: 2, valueMinor: 11,
  });
  assert.deepEqual(summary.coverage, {
    complete: true,
    sources: 1,
    limitations: ['manual-export', 'provider-retries-unavailable'],
  });

  const card = makeRunReceiptQuestionCard(summary);
  assert.equal(card.visibility, 'private');
  assert.equal(card.project, 'commitatlas');
  assert.match(card.question, /retried|cancelled/i);
  assert.deepEqual(card.evidence, {
    receipts: 4,
    failed: 1,
    cancelled: 1,
    retries: 1,
    runnerSeconds: 135,
    verifiedAccepted: 2,
  });
  assert.deepEqual(card.costPerVerifiedAccepted, summary.costPerVerifiedAccepted);
  assert.equal(JSON.stringify(card).includes('gha-'), false);
});

test('cost per verified accepted outcome abstains when the denominator or cost coverage is missing', async t => {
  const db = database(t);
  await importRunReceiptFile(db, text(fixture()));
  const summary = await readRunReceiptSummary(db, {
    project: 'alibi',
    start: Date.parse(coverage.start),
    end: Date.parse(coverage.end),
  });
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /no verified accepted outcome/i);
  const card = makeRunReceiptQuestionCard(summary);
  assert.equal(card.costPerVerifiedAccepted, null);
  assert.match(card.limitations.join(' '), /cannot be calculated/i);
});

test('run receipts cannot enter the public pulse exporter or static asset surface', () => {
  const parsed = parseRunReceiptFile(text(fixture()));
  assert.throws(() => makePublicPulse(parsed, ['commitatlas'], Date.parse(generatedAt)), /supported snapshot/i);
  assert.equal([...assets.keys()].some(path => path.includes('run-receipt')), false);
  assert.equal(parsed.visibility, 'private');
});
