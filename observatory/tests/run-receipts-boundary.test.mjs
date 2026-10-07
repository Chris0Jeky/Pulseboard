import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/sqlite.mjs';
import { importRunReceiptPath, readBoundedRunReceiptFile } from '../run-receipts/file-adapter.mjs';
import { RUN_RECEIPT_MAX_BYTES } from '../run-receipts/contracts.mjs';

const sample = readFileSync(new URL('../run-receipts/examples/github-actions.sample.json', import.meta.url), 'utf8');
const adapter = fileURLToPath(new URL('../run-receipts/file-adapter.mjs', import.meta.url));
const now = Date.parse('2026-10-07T12:00:00Z');
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'receipt-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const [label, bytes, options] of [
  ['invalid JSON', '{"private-note":"secret-body-marker",', {}],
  ['unknown fields', JSON.stringify({ ...JSON.parse(sample), instructions: 'secret-body-marker' }), {}],
  ['oversized bytes', ' '.repeat(RUN_RECEIPT_MAX_BYTES + 1), {}],
  ['invalid UTF-8', Buffer.from([0xff, 0xfe]), {}],
  ['future export', sample.replace('2026-09-02T00:05:00.000Z', '2099-09-02T00:05:00.000Z'), {}],
  ['invalid import time', sample, { now: NaN }],
  ['null import time', sample, { now: null }],
]) {
  test(`rejected ${label} creates neither output parent nor database`, async t => {
    const root = directory(t), input = join(root, 'input.json'), parent = join(root, 'not-created');
    writeFileSync(input, bytes);
    await assert.rejects(importRunReceiptPath(input, join(parent, 'private.sqlite'), { now, ...options }));
    assert.equal(existsSync(parent), false, 'validation must precede all output mutation');
  });
}

test('missing and directory inputs do not create an output database', async t => {
  const root = directory(t), output = join(root, 'private.sqlite');
  for (const input of [join(root, 'missing.json'), root]) {
    await assert.rejects(importRunReceiptPath(input, output, { now }));
    assert.equal(existsSync(output), false);
  }
});

test('invalid input leaves an existing database byte-identical without installing the private schema', async t => {
  const root = directory(t), input = join(root, 'invalid.json'), output = join(root, 'existing.sqlite');
  const db = openDatabase(output);
  db.exec('CREATE TABLE keep(value TEXT); INSERT INTO keep VALUES (\'untouched\');');
  db.close();
  const before = readFileSync(output);
  writeFileSync(input, '{');
  await assert.rejects(importRunReceiptPath(input, output, { now }));
  assert.equal(readFileSync(output).equals(before), true, 'existing database bytes changed');
});

test('input and output symlinks are refused without changing the target database', async t => {
  const root = directory(t), input = join(root, 'input.json'), link = join(root, 'input-link.json');
  const target = join(root, 'target.sqlite'), output = join(root, 'output-link.sqlite');
  writeFileSync(input, sample);
  const db = openDatabase(target);
  db.exec('CREATE TABLE keep(value TEXT);');
  db.close();
  try { symlinkSync(input, link); symlinkSync(target, output); }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlinks require host permission'); throw error; }
  const before = readFileSync(target);
  await assert.rejects(importRunReceiptPath(link, join(root, 'not-created.sqlite'), { now }));
  assert.equal(existsSync(join(root, 'not-created.sqlite')), false);
  await assert.rejects(importRunReceiptPath(input, output, { now }));
  assert.equal(readFileSync(target).equals(before), true, 'symlink target bytes changed');
});

test('CLI rejects extra import arguments without creating a database', t => {
  const root = directory(t), input = join(root, 'input.json'), output = join(root, 'not-created.sqlite');
  writeFileSync(input, sample);
  const result = spawnSync(process.execPath, [adapter, 'import', input, output, '--unreviewed'], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(output), false);
});

test('CLI parsing and filesystem errors do not echo private source text or paths', t => {
  const root = directory(t), input = join(root, 'secret-filename-marker.json');
  writeFileSync(input, 'hush42-private-note-not-json');
  for (const name of [input, join(root, 'secret-filename-marker', 'missing.json')]) {
    const result = spawnSync(process.execPath, [adapter, 'preview', name], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /hush42|secret-body-marker|secret-filename-marker/);
  }
});

test('bounded input accepts exact byte ceiling including multibyte UTF-8', t => {
  const root = directory(t), input = join(root, 'boundary.txt');
  const text = 'é'.repeat(RUN_RECEIPT_MAX_BYTES / 2);
  writeFileSync(input, text);
  assert.equal(readBoundedRunReceiptFile(input), text);
  writeFileSync(input, text + 'x');
  assert.throws(() => readBoundedRunReceiptFile(input), /256 KiB/);
});
