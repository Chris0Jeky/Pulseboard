import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture, mapping, now } from './helpers/github-actions-export.mjs';
import { convertGithubActionsExport } from '../run-receipts/github-actions.mjs';
import { writeGithubActionsReceipt } from '../run-receipts/github-actions-file.mjs';

const script = fileURLToPath(new URL('../run-receipts/github-actions-file.mjs', import.meta.url));
function paths(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'actions-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'raw.json'), map = join(root, 'mapping.json'), output = join(root, 'receipt.json');
  fs.writeFileSync(input, JSON.stringify(fixture())); fs.writeFileSync(map, JSON.stringify(mapping));
  return { root, input, map, output };
}
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 });

test('default CLI preview creates no output and explicit write publishes the same reviewed conversion', t => {
  const { root, input, map, output } = paths(t);
  const preview = run([input, map]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).receiptCount, 2);
  assert.deepEqual(fs.readdirSync(root).sort(), ['mapping.json', 'raw.json']);
  const wrote = run(['write', input, map, output]);
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.deepEqual(JSON.parse(wrote.stdout), JSON.parse(preview.stdout));
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), convertGithubActionsExport(fs.readFileSync(input, 'utf8'), mapping, { now }));
  if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.doesNotMatch(wrote.stdout, /9001|private-|instruction-marker/);
  assert.deepEqual(fs.readdirSync(root).sort(), ['mapping.json', 'raw.json', 'receipt.json']);
});

test('explicit write never overwrites an existing output', t => {
  const { input, map, output } = paths(t);
  fs.writeFileSync(output, 'keep-this-file');
  const result = run(['write', input, map, output]);
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(output, 'utf8'), 'keep-this-file');
});

test('malformed private input is rejected before output creation and not echoed', t => {
  const { root, input, map, output } = paths(t);
  fs.writeFileSync(input, 'hush42-private');
  const result = run(['write', input, map, output]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /hush42/);
  assert.deepEqual(fs.readdirSync(root).sort(), ['mapping.json', 'raw.json']);
});

test('unknown CLI flags and extra arguments do not publish files', t => {
  const { input, map, output } = paths(t);
  for (const args of [['write', input, map, output, 'extra'], ['--fetch', input, map]]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(fs.existsSync(output), false);
  }
});

test('a failed temporary write does not publish a partial receipt or leave temporary files', t => {
  const { root, output } = paths(t), original = fs.writeFileSync;
  const stub = t.mock.method(fs, 'writeFileSync', function (filename, ...args) {
    if (typeof filename === 'number') {
      original.call(this, filename, '{');
      throw new Error('private-write-error-marker');
    }
    return original.call(this, filename, ...args);
  });
  try { assert.throws(() => writeGithubActionsReceipt(JSON.stringify(fixture()), mapping, output, { now })); }
  finally { stub.mock.restore(); }
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ['mapping.json', 'raw.json']);
});
