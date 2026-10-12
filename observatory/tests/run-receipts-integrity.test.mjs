import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/sqlite.mjs';
import { parseRunReceiptFile } from '../run-receipts/contracts.mjs';
import { importRunReceiptFile, readRunReceiptSummary } from '../run-receipts/store.mjs';

const schema = readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8');
const sample = readFileSync(new URL('../run-receipts/examples/github-actions.sample.json', import.meta.url), 'utf8');
const now = Date.parse('2026-10-12T00:00:00Z');
function fixture() {
  const value = JSON.parse(sample);
  value.coverage = { ...value.coverage, complete: true, limitations: ['billing-estimate'] };
  value.receipts = [value.receipts[0]];
  value.receipts[0].outcome = { state: 'verified-accepted', verificationRef: 'synthetic-check' };
  return value;
}
function database(t) {
  const db = openDatabase(); db.exec(schema); t.after(() => db.close()); return db;
}

// Both importers finish all preflight reads before either transaction may run.
// The losing batch inserts a distinct row first, so rejection must undo that row too.
for (const conflict of [true, false]) {
  test(`two connections serialize ${conflict ? 'conflicting' : 'identical'} receipt identities`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-race-'));
    const a = openDatabase(join(dir, 'private.sqlite')); a.exec(schema);
    const b = openDatabase(join(dir, 'private.sqlite'));
    t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
    const first = fixture(), second = fixture();
    const unique = { ...structuredClone(second.receipts[0]), id: 'synthetic-unique', run: 'unique' };
    if (conflict) second.receipts[0].cost.minor++;
    second.receipts.unshift(unique);
    let arrivals = 0, release, committed;
    const barrier = new Promise(resolve => { release = resolve; });
    const winner = new Promise(resolve => { committed = resolve; });
    const wrap = (db, wins) => ({ prepare: db.prepare, async batch(statements) {
      if (++arrivals === 2) release();
      await barrier;
      if (!wins) await winner;
      try { return await db.batch(statements); } finally { if (wins) committed(); }
    } });
    const results = await Promise.allSettled([
      importRunReceiptFile(wrap(a, true), JSON.stringify(first), { now }),
      importRunReceiptFile(wrap(b, false), JSON.stringify(second), { now }),
    ]);
    assert.equal(arrivals, 2);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].value.imported, 1);
    if (conflict) {
      assert.equal(results[1].status, 'rejected', 'contradictory evidence must not report a successful duplicate');
      assert.match(results[1].reason.message, /Conflicting run receipt identity/);
    } else {
      assert.deepEqual(results[1].value, { received: 2, imported: 1, duplicates: 1, visibility: 'private' });
    }
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, conflict ? 1 : 2);
    assert.equal((await a.prepare("SELECT cost_minor FROM private_run_receipts WHERE run_id='100'").first()).cost_minor, 1);
  });
}

test('complete coverage rejects an explicit partial-history limitation before writing', async t => {
  const db = database(t), value = fixture(); value.coverage.limitations.push('partial-history');
  assert.throws(() => parseRunReceiptFile(JSON.stringify(value)), /partial.history/i);
  await assert.rejects(importRunReceiptFile(db, JSON.stringify(value), { now }), /partial.history/i);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, 0);
});

test('historical contradictory coverage abstains at read time without erasing costs', async t => {
  const db = database(t), value = fixture();
  await importRunReceiptFile(db, JSON.stringify(value), { now });
  await db.prepare('UPDATE private_run_receipts SET coverage_limitations=?').bind('["partial-history"]').run();
  const summary = await readRunReceiptSummary(db, { project: 'commitatlas',
    start: Date.parse(value.coverage.start), end: Date.parse(value.coverage.end) });
  assert.equal(summary.coverage.complete, false);
  assert.deepEqual(summary.coverage.limitations, ['partial-history']);
  assert.equal(summary.costPerVerifiedAccepted, null);
  assert.match(summary.costAbstention, /coverage is incomplete/i);
  assert.equal(summary.costs[0].minor, 1);
});

test('non-history limitations do not contradict declared complete coverage', async t => {
  const db = database(t), value = fixture();
  await importRunReceiptFile(db, JSON.stringify(value), { now });
  const summary = await readRunReceiptSummary(db, { project: 'commitatlas',
    start: Date.parse(value.coverage.start), end: Date.parse(value.coverage.end) });
  assert.equal(summary.coverage.complete, true);
  assert.equal(summary.costPerVerifiedAccepted.valueMinor, 1);
});
