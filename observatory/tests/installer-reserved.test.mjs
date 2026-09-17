import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isReservedInstallTarget } from '../adapters/build-embed.mjs';

test('Windows reserved installer paths are case-insensitive', () => {
  const root = path.resolve('/tmp/observatory-host');
  for (const target of [
    'Observatory/Check.mjs',
    'OBSERVATORY/README.MD',
    'Observatory/Check.Local.mjs',
    'OBSERVATORY.LOCK.JSON',
    'Observatory\\Check.mjs',
  ]) {
    assert.equal(isReservedInstallTarget(target, root, 'win32'), true, target);
  }
  assert.equal(isReservedInstallTarget('observatory/check-copy.mjs', root, 'win32'), false);
});

test('case folding is not imposed on case-sensitive platforms', () => {
  const root = path.resolve('/tmp/observatory-host');
  assert.equal(isReservedInstallTarget('Observatory/Check.mjs', root, 'linux'), false);
  assert.equal(isReservedInstallTarget('observatory/check.mjs', root, 'linux'), true);
});
