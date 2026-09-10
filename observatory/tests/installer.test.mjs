import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { install, buildEmbed } from '../adapters/build-embed.mjs';
test('generated browser script parses and remains inert while unconfigured', () => {
  const code = buildEmbed('mdviewer'); new vm.Script(code);
  const context = { document: { readyState: 'complete' } }; vm.runInNewContext(code, context);
  assert.equal(context.PulseboardUsage, null);
});
test('generated artifact keeps no module statement or server-only constant, on any line ending', () => {
  const code = buildEmbed('mdviewer');
  assert.deepEqual(code.split('\n').filter(line => /^(?:import|export)\b/.test(line)), []);
  assert.equal(/MAX_BYTES|MAX_BATCH/.test(code), false);
  // The reader normalises CRLF, so a Windows checkout builds the same artifact a Linux one does.
  assert.equal(code.includes('\r'), false);
});
test('installer is repeatable, refuses edited files, and confines paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    const a = install('mdviewer', root, 'public/observer.js'); const b = install('mdviewer', root, 'public/observer.js'); assert.deepEqual(a, b);
    writeFileSync(path.join(root, 'public/observer.js'), 'my work'); assert.throws(() => install('mdviewer', root, 'public/observer.js'), /refusing overwrite/);
    assert.throws(() => install('mdviewer', root, '../escape.js'), /relative path/);
    assert.equal(readFileSync(path.join(root, 'public/observer.js'), 'utf8'), 'my work');
  } finally { rmSync(root, { recursive: true }); }
});
test('installer refuses symlink escape', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-')), outside = mkdtempSync(path.join(tmpdir(), 'observatory-outside-'));
  try { symlinkSync(outside, path.join(root, 'linked')); assert.throws(() => install('mdviewer', root, 'linked/embed.js'), /Symlink/); }
  finally { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); }
});
test('Taskdeck cannot accidentally acquire a public embed', () => assert.throws(() => buildEmbed('taskdeck'), /no public collection origin/));
