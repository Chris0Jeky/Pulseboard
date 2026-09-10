import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { install, buildEmbed, assertArtifactShape } from '../adapters/build-embed.mjs';
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
test('the artifact publishes the client contract only, never operator data', () => {
  const code = buildEmbed('mdviewer'), serialised = /const config = (\{.*\});/.exec(code)[1].replaceAll('\\u003c', '<');
  for (const operatorOnly of ['probe', 'marker', 'dailyLimit', 'label', 'MDviewer']) assert.equal(serialised.includes(operatorOnly), false, operatorOnly + ' leaked into the artifact');
  const config = JSON.parse(serialised);
  assert.deepEqual(Object.keys(config.project).sort(), ['events', 'measurements', 'releases', 'routes']);
  assert.ok(config.project.events.includes('export.print_requested'));
});
test('embed options are an allowlist, not an arbitrary override', () => {
  assert.throws(() => buildEmbed('mdviewer', { origin: 'https://attacker.test' }), /Unsupported embed option: origin/);
  assert.throws(() => buildEmbed('mdviewer', { project: { events: ['anything'] } }), /Unsupported embed option: project/);
  assert.throws(() => buildEmbed('mdviewer', { scopePath: '/' }), /Unsupported embed option: scopePath/);
  assert.equal(buildEmbed('mdviewer', { route: 'editor', clicks: [] }).includes('"route":"editor"'), true);
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
test('two installs in one repository keep separate lock entries', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    const first = install('mdviewer', root, 'public/observer.js'), second = install('commitatlas', root, 'site/observer.js');
    const lock = JSON.parse(readFileSync(path.join(root, 'observatory.lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock.installs).sort(), ['public/observer.js', 'site/observer.js']);
    assert.equal(lock.installs['public/observer.js'].project, 'mdviewer');
    assert.equal(lock.installs['site/observer.js'].sha256, second.sha256);
    // The second install must not have orphaned the first: reinstalling it is still repeatable, not an "unowned" refusal.
    assert.deepEqual(install('mdviewer', root, 'public/observer.js'), first);
  } finally { rmSync(root, { recursive: true }); }
});
test('a lock file in the original single-entry shape still owns its target', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    const { sha256 } = install('mdviewer', root, 'public/observer.js');
    writeFileSync(path.join(root, 'observatory.lock.json'), JSON.stringify({ version: '0.1.0', project: 'mdviewer', target: 'public/observer.js', sha256 }));
    assert.equal(install('mdviewer', root, 'public/observer.js').sha256, sha256);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(root, 'observatory.lock.json'), 'utf8')).installs), ['public/observer.js']);
  } finally { rmSync(root, { recursive: true }); }
});
test('a malformed artifact is rejected before any file is written', () => {
  assert.throws(() => assertArtifactShape("import { x } from './y.mjs';\n(function () {})();\n"), /module statement/);
  assert.throws(() => assertArtifactShape("export function mount() {}\n"), /module statement/);
  assert.throws(() => assertArtifactShape('const limit = MAX_BYTES;\n'), /server-only constants/);
});
test('Taskdeck cannot accidentally acquire a public embed', () => assert.throws(() => buildEmbed('taskdeck'), /no public collection origin/));
