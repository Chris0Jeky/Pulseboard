import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoundedRunReceiptFile } from '../run-receipts/file-adapter.mjs';
import { RUN_RECEIPT_MAX_BYTES } from '../run-receipts/contracts.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'receipt-fd-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'input');
  fs.writeFileSync(input, 'good');
  return { root, input };
}

test('input replacement after its path check is rejected, not read as reviewed evidence', t => {
  const { root, input } = fixture(t), original = fs.openSync;
  let swapped = false;
  const stub = t.mock.method(fs, 'openSync', function (filename, ...args) {
    if (filename === input && !swapped) {
      swapped = true;
      fs.renameSync(input, join(root, 'original'));
      fs.writeFileSync(input, 'evil');
    }
    return original.call(this, filename, ...args);
  });
  try { assert.throws(() => readBoundedRunReceiptFile(input), /changed/); }
  finally { stub.mock.restore(); }
  assert.equal(swapped, true);
});

test('input growth cannot make descriptor reads exceed the byte ceiling plus one', t => {
  const { input } = fixture(t), original = fs.readSync;
  let grown = false, requested = 0, fd;
  const stub = t.mock.method(fs, 'readSync', function (descriptor, buffer, offset, length, position) {
    fd = descriptor;
    requested += length;
    if (!grown) { grown = true; fs.writeFileSync(input, 'x'.repeat(RUN_RECEIPT_MAX_BYTES + 4096)); }
    return original.call(this, descriptor, buffer, offset, length, position);
  });
  try { assert.throws(() => readBoundedRunReceiptFile(input), /256 KiB/); }
  finally { stub.mock.restore(); }
  assert.equal(grown, true);
  assert.ok(requested <= RUN_RECEIPT_MAX_BYTES + 1, 'read requests exceeded the hard bound');
  assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
});

test('descriptor identity is rechecked after reading and always closed', t => {
  const { root, input } = fixture(t), original = fs.readSync;
  let swapped = false, fd;
  const stub = t.mock.method(fs, 'readSync', function (descriptor, ...args) {
    fd = descriptor;
    const result = original.call(this, descriptor, ...args);
    if (!swapped) {
      swapped = true;
      fs.renameSync(input, join(root, 'original'));
      fs.writeFileSync(input, 'evil');
    }
    return result;
  });
  try { assert.throws(() => readBoundedRunReceiptFile(input), /changed/); }
  finally { stub.mock.restore(); }
  assert.equal(swapped, true);
  assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
});
