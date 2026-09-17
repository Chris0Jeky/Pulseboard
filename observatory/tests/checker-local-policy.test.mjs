import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { install } from '../adapters/build-embed.mjs';

const runChecker = root => spawnSync(process.execPath, ['observatory/check.mjs'], { cwd: root, encoding: 'utf8' });

test('host checker rejects a dangling local-policy symlink', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-policy-test-'));
  try {
    install('mdviewer', root, 'public/observer.js');
    symlinkSync(path.join(root, 'missing-policy.mjs'), path.join(root, 'observatory/check.local.mjs'), 'file');
    const result = runChecker(root);
    assert.notEqual(result.status, 0, 'a dangling policy hook must not be treated as absent');
    assert.match(result.stderr + result.stdout, /check\.local\.mjs.*regular file/i);
  } finally {
    rmSync(root, { recursive: true });
  }
});
