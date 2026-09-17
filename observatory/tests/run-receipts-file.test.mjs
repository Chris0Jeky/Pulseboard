import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/sqlite.mjs';
import { RUN_RECEIPT_MAX_BYTES } from '../run-receipts/contracts.mjs';

const observatory = fileURLToPath(new URL('..', import.meta.url));
const adapter = fileURLToPath(new URL('../run-receipts/file-adapter.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../run-receipts/examples/github-actions.sample.json', import.meta.url));
const run = args => spawnSync(process.execPath, [adapter, ...args], { cwd: observatory, encoding: 'utf8' });

test('the CLI previews before an explicit idempotent local import', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pulseboard-run-receipts-'));
  try {
    const databasePath = path.join(root, 'private.sqlite');
    const previewResult = run(['preview', sample]);
    assert.equal(previewResult.status, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.visibility, 'private');
    assert.equal(preview.receiptCount, 2);
    assert.equal(preview.totalDurationMs, 90_000);
    assert.equal(previewResult.stdout.includes('synthetic-100-1'), false);
    assert.equal(previewResult.stdout.includes('synthetic-101-1'), false);

    const first = run(['import', sample, databasePath]);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), { received: 2, imported: 2, duplicates: 0, visibility: 'private' });
    const second = run(['import', sample, databasePath]);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { received: 2, imported: 0, duplicates: 2, visibility: 'private' });

    const DB = openDatabase(databasePath);
    try { assert.equal(DB.prepare('SELECT COUNT(*) AS n FROM private_run_receipts')._execute().results[0].n, 2); }
    finally { DB.close(); }
  } finally { rmSync(root, { recursive: true }); }
});

test('the file adapter rejects oversized and non-file input before JSON parsing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pulseboard-run-receipts-'));
  try {
    const oversized = path.join(root, 'oversized.json');
    writeFileSync(oversized, ' '.repeat(RUN_RECEIPT_MAX_BYTES + 1));
    const tooLarge = run(['preview', oversized]);
    assert.equal(tooLarge.status, 1);
    assert.match(tooLarge.stderr, /256 KiB/i);

    const directory = run(['preview', root]);
    assert.equal(directory.status, 1);
    assert.match(directory.stderr, /regular file/i);

    assert.ok(readFileSync(sample, 'utf8').includes('pulseboard.run-receipts/1'));
  } finally { rmSync(root, { recursive: true }); }
});
