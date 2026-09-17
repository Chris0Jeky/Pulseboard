import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/sqlite.mjs';
import { previewRunReceiptFile } from '../run-receipts/contracts.mjs';
import { importRunReceiptFile } from '../run-receipts/store.mjs';

const source = { kind: 'github-actions-file', id: 'overlapping-export' };
const coverageStart = '2026-09-01T00:00:00.000Z';
const firstEnd = '2026-09-02T00:00:00.000Z';
const secondEnd = '2026-09-03T00:00:00.000Z';
const firstGenerated = '2026-09-02T00:05:00.000Z';
const secondGenerated = '2026-09-03T00:05:00.000Z';
const observatory = fileURLToPath(new URL('..', import.meta.url));
const adapter = fileURLToPath(new URL('../run-receipts/file-adapter.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../run-receipts/examples/github-actions.sample.json', import.meta.url));

const receipt = ({ id, run, startedAt, endedAt, value }) => ({
  id,
  run,
  project: 'commitatlas',
  startedAt,
  endedAt,
  status: 'succeeded',
  attempt: 1,
  retryOf: null,
  resources: [{ unit: 'runner_seconds', value }],
  cost: null,
  outcome: { state: 'unverified', verificationRef: null },
});

const envelope = ({ generatedAt, end, receipts }) => ({
  schema: 'pulseboard.run-receipts/1',
  source,
  generatedAt,
  coverage: { start: coverageStart, end, complete: true, limitations: ['manual-export'] },
  receipts,
});

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../run-receipts/schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}

test('successive overlapping exports keep unchanged receipt evidence idempotent', async t => {
  const DB = database(t);
  const unchanged = receipt({
    id: 'gha-100-1',
    run: '100',
    startedAt: '2026-09-01T01:00:00.000Z',
    endedAt: '2026-09-01T01:01:00.000Z',
    value: 60,
  });
  const first = envelope({ generatedAt: firstGenerated, end: firstEnd, receipts: [unchanged] });
  assert.deepEqual(await importRunReceiptFile(DB, JSON.stringify(first), { now: Date.parse(firstGenerated) + 1 }), {
    received: 1,
    imported: 1,
    duplicates: 0,
    visibility: 'private',
  });

  const added = receipt({
    id: 'gha-200-1',
    run: '200',
    startedAt: '2026-09-02T01:00:00.000Z',
    endedAt: '2026-09-02T01:00:30.000Z',
    value: 30,
  });
  const later = envelope({ generatedAt: secondGenerated, end: secondEnd, receipts: [unchanged, added] });
  assert.deepEqual(await importRunReceiptFile(DB, JSON.stringify(later), { now: Date.parse(secondGenerated) + 1 }), {
    received: 2,
    imported: 1,
    duplicates: 1,
    visibility: 'private',
  });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, 2);
});

test('preview refuses resource aggregates outside the safe integer range', () => {
  const receipts = Array.from({ length: 10 }, (_, index) => receipt({
    id: `gha-large-${index}-1`,
    run: `large-${index}`,
    startedAt: `2026-09-01T04:${String(index).padStart(2, '0')}:00.000Z`,
    endedAt: `2026-09-01T04:${String(index).padStart(2, '0')}:01.000Z`,
    value: 1_000_000_000_000_000,
  }));
  const input = envelope({ generatedAt: firstGenerated, end: firstEnd, receipts });
  assert.throws(() => previewRunReceiptFile(JSON.stringify(input)), /safe integer range/i);
});

test('the documented import path creates missing database parents', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pulseboard-run-receipts-review-'));
  try {
    const databasePath = path.join(root, 'observatory', '.data', 'private-run-receipts.sqlite');
    const result = spawnSync(process.execPath, [adapter, 'import', sample, databasePath], {
      cwd: observatory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { received: 2, imported: 2, duplicates: 0, visibility: 'private' });
    const DB = openDatabase(databasePath);
    try {
      assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM private_run_receipts').first()).n, 2);
    } finally { DB.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
