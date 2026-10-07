import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertGithubActionsExport, previewGithubActionsExport } from '../run-receipts/github-actions.mjs';
import { importRunReceiptFile, readRunReceiptSummary } from '../run-receipts/store.mjs';
import { makeRunReceiptQuestionCard } from '../run-receipts/model.mjs';
import { makePublicPulse } from '../public/desk-bridge.mjs';
import { assets } from '../src/assets.mjs';
import { openDatabase } from '../src/sqlite.mjs';
import { fixture, mapping, now } from './helpers/github-actions-export.mjs';
const convert = input => convertGithubActionsExport(JSON.stringify(input), mapping, { now });

test('parallel job-seconds, retry identity and observed job envelopes stay distinct', () => {
  const file = convert(fixture());
  assert.equal(file.schema, 'pulseboard.run-receipts/1');
  assert.equal(file.coverage.complete, false);
  assert.deepEqual(file.receipts.map(r => r.resources), [[{ unit: 'runner_seconds', value: 90 }], [{ unit: 'runner_seconds', value: 20 }]]);
  assert.deepEqual(file.receipts.map(r => r.status), ['failed', 'succeeded']);
  assert.equal(file.receipts[0].startedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(file.receipts[0].endedAt, '2026-09-01T10:01:00.000Z');
  assert.equal(file.receipts[1].retryOf, file.receipts[0].id);
  assert.ok(file.receipts.every(r => r.cost === null && r.outcome.state === 'unverified' && r.outcome.verificationRef === null));
  assert.doesNotMatch(JSON.stringify(file), /private-|instruction-marker|2099|https/);
});

test('pagination and input order cannot change the canonical converted receipts', () => {
  const input = fixture(), expected = convert(input);
  input.attempts.reverse();
  const first = input.attempts[1], [a, b] = first.jobPages[0].jobs;
  first.jobPages = [{ total_count: 2, jobs: [b] }, { total_count: 2, jobs: [a] }];
  assert.deepEqual(convert(input), expected);
});

test('conversion imports idempotently and feeds the existing private question card', async t => {
  const file = convert(fixture()), db = openDatabase();
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8'));
  assert.equal((await importRunReceiptFile(db, JSON.stringify(file), { now })).imported, 2);
  assert.equal((await importRunReceiptFile(db, JSON.stringify(file), { now })).duplicates, 2);
  const summary = await readRunReceiptSummary(db, { project: mapping.project,
    start: Date.parse(file.coverage.start), end: Date.parse(file.coverage.end) });
  assert.equal(summary.durationMs, 80000);
  assert.deepEqual(summary.resources, [{ unit: 'runner_seconds', value: 110 }]);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.equal(summary.coverage.complete, false);
  const card = makeRunReceiptQuestionCard(summary);
  assert.deepEqual(card.evidence, { receipts: 2, failed: 1, cancelled: 0, retries: 1, runnerSeconds: 110, verifiedAccepted: 0 });
  assert.throws(() => makePublicPulse(card));
  assert.equal([...assets].some(value => String(value).includes('run-receipts')), false);
});

test('preview strips receipt, run, job and raw provider text while explaining measurement limits', () => {
  const preview = previewGithubActionsExport(JSON.stringify(fixture()), mapping, { now });
  assert.equal(preview.visibility, 'private');
  assert.equal(preview.receiptCount, 2);
  assert.equal(preview.outcomes.unverified, 2);
  assert.doesNotMatch(JSON.stringify(preview), /9001|9101|private-|instruction-marker/);
  assert.match(preview.limitations.join(' '), /not billable/i);
});

for (const [label, mutate] of [
  ['repository mismatch', x => x.attempts[0].run.repository.id++],
  ['workflow mismatch', x => x.attempts[0].run.workflow_id++],
  ['job run mismatch', x => x.attempts[0].jobPages[0].jobs[0].run_id++],
  ['job attempt mismatch', x => x.attempts[0].jobPages[0].jobs[0].run_attempt++],
  ['job head mismatch', x => x.attempts[0].jobPages[0].jobs[0].head_sha = 'b'.repeat(40)],
  ['missing attempt identity', x => delete x.attempts[0].jobPages[0].jobs[0].run_attempt],
  ['unsettled run', x => x.attempts[0].run.status = 'in_progress'],
  ['unsettled job', x => x.attempts[0].jobPages[0].jobs[0].status = 'queued'],
  ['unsupported run outcome', x => x.attempts[0].run.conclusion = 'neutral'],
  ['unsupported job outcome', x => x.attempts[0].jobPages[0].jobs[0].conclusion = 'unknown'],
  ['missing page', x => x.attempts[0].jobPages[0].total_count++],
  ['duplicate job', x => x.attempts[0].jobPages[0].jobs[1] = x.attempts[0].jobPages[0].jobs[0]],
  ['duplicate attempt', x => x.attempts.push(x.attempts[0])],
  ['missing prior retry', x => x.attempts.shift()],
  ['missing job timing', x => x.attempts[0].jobPages[0].jobs[0].completed_at = null],
  ['reversed timing', x => x.attempts[0].jobPages[0].jobs[0].completed_at = '2026-09-01T09:00:00Z'],
  ['unrepresentable seconds', x => x.attempts[0].jobPages[0].jobs[0].completed_at = '2026-09-01T10:01:00.123Z'],
  ['out of coverage', x => x.coverage.start = '2026-09-01T10:02:00Z'],
  ['unsafe numeric id', x => x.attempts[0].run.id = Number.MAX_SAFE_INTEGER + 1],
  ['unknown envelope field', x => x.execute = 'private-instruction'],
  ['fabricated complete flag', x => x.coverage.complete = true],
  ['future generation', x => x.generatedAt = '2099-10-07T00:00:00Z'],
]) {
  test(`refuses ${label} instead of silently dropping evidence`, () => {
    const input = fixture(); mutate(input);
    assert.throws(() => convert(input));
  });
}

for (const conclusion of ['cancelled', 'timed_out', 'skipped']) {
  test(`retains ${conclusion} attempts without a verified-outcome claim`, () => {
    const input = fixture(); input.attempts[0].run.conclusion = conclusion;
    const file = convert(input);
    assert.equal(file.receipts[0].status, conclusion.replace('_', '-'));
    assert.equal(file.receipts[0].outcome.state, 'unverified');
  });
}

test('rejects unknown mappings and excessive export bytes before conversion', () => {
  assert.throws(() => convertGithubActionsExport(' '.repeat(262145), mapping));
  assert.throws(() => convertGithubActionsExport(JSON.stringify(fixture()), { ...mapping, project: 'unknown' }));
  assert.throws(() => convertGithubActionsExport(JSON.stringify(fixture()), { ...mapping, token: 'private' }));
});

test('provider conclusions must be strings, not coercible arrays', () => {
  const input = fixture(); input.attempts[0].run.conclusion = ['success'];
  assert.throws(() => convert(input));
});

test('job-envelope and non-billing qualifications survive database import and question-card export', async t => {
  const file = convert(fixture()), db = openDatabase();
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8'));
  await importRunReceiptFile(db, JSON.stringify(file), { now });
  const summary = await readRunReceiptSummary(db, { project: mapping.project,
    start: Date.parse(file.coverage.start), end: Date.parse(file.coverage.end) });
  const card = makeRunReceiptQuestionCard(summary);
  assert.match(summary.limitations.join(' '), /observed job envelope/);
  assert.match(card.limitations.join(' '), /not billable time or CPU time/);
});

for (const [label, mutate] of [
  ['zero jobs', x => { x.attempts[0].jobPages[0] = { total_count: 0, jobs: [] }; }],
  ['inconsistent page totals', x => { const p = x.attempts[0].jobPages[0]; x.attempts[0].jobPages = [{ total_count: 2, jobs: [p.jobs[0]] }, { total_count: 3, jobs: [p.jobs[1]] }]; }],
  ['job reused across attempts', x => x.attempts[1].jobPages[0].jobs[0].id = x.attempts[0].jobPages[0].jobs[0].id],
  ['nonexistent date', x => x.attempts[0].jobPages[0].jobs[0].started_at = '2026-02-30T00:00:00Z'],
  ['excess attempt count', x => x.attempts = Array.from({ length: 257 }, () => x.attempts[0])],
]) {
  test(`refuses ${label} with no fabricated zero or partial result`, () => {
    const input = fixture(); mutate(input);
    assert.throws(() => convert(input));
  });
}
