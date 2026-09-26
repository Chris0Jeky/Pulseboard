import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { install, buildEmbed, assertArtifactShape } from '../adapters/build-embed.mjs';
const runChecker = root => spawnSync(process.execPath, ['observatory/check.mjs'], { cwd: root, encoding: 'utf8' });
function writeAlibiRelease(root, version = '0.11.6', tag = 'v' + version) {
  mkdirSync(path.join(root, 'content'), { recursive: true });
  writeFileSync(path.join(root, 'content/releases.json'), JSON.stringify([{ version, tag }]));
}
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
test('Alibi artifact publishes only its bounded context handle and registered release', () => {
  const code = buildEmbed('alibi', { endpoint: 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect-stat/alibi' });
  const config = JSON.parse(/const config = (\{.*\});/.exec(code)[1].replaceAll('\\u003c', '<'));
  assert.equal(config.contextGlobal, 'ALIBI_OBSERVATORY_CONTEXT');
  assert.deepEqual(config.publicFlag, { global: 'ALIBI_CONFIG', key: 'standalone', expected: false });
  assert.equal(config.origin, 'https://alibi-after-hours-preview.commit-atlas.workers.dev');
  assert.equal(config.endpoint, 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect-stat/alibi');
  assert.deepEqual(config.project.releases, ['unattributed', '0.11.3', '0.11.4', '0.11.5', '0.11.6', '0.12.0', '0.13.0']);
  assert.equal(code.includes('ALIBI_CONFIG.version'), false);
  assert.ok(code.includes('createStatisticObserver') && code.includes('mountStatisticObserver'));
  assert.equal(/MAX_BYTES|MAX_BATCH/.test(code), false);
  assert.equal(code.includes('CLIENT_BATCH_LIMIT'), true);
  new vm.Script(code);
  assert.throws(() => buildEmbed('alibi', { endpoint: 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/alibi' }), /statistic collector endpoint/);
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

test('installer emits one shared host checker and LF guidance', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    install('mdviewer', root, 'public/observer.js');
    const checker = readFileSync(path.join(root, 'observatory/check.mjs'), 'utf8');
    assert.match(checker, /Generated by Pulseboard Observatory/);
    assert.equal(checker.includes('\r'), false);
    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).targets, ['public/observer.js']);
    const readme = readFileSync(path.join(root, 'observatory/README.md'), 'utf8');
    assert.match(readme, /public\/observer\.js text eol=lf/);
    assert.match(readme, /observatory\/check\.mjs text eol=lf/);
    assert.match(readme, /check\.local\.mjs/);
  } finally { rmSync(root, { recursive: true }); }
});
test('host checker normalises CRLF but rejects real artifact drift', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    install('mdviewer', root, 'public/observer.js');
    const target = path.join(root, 'public/observer.js');
    writeFileSync(target, readFileSync(target, 'utf8').replaceAll('\n', '\r\n'));
    const normalised = runChecker(root);
    assert.equal(normalised.status, 0, normalised.stderr || normalised.stdout);
    writeFileSync(target, readFileSync(target, 'utf8') + '\n// local edit\n');
    const drift = runChecker(root);
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr + drift.stdout, /integrity mismatch/i);
  } finally { rmSync(root, { recursive: true }); }
});
test('host checker delegates product policy to an optional local module', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club', version: '0.11.6' }));
    writeAlibiRelease(root);
    install('alibi', root, 'observatory/browser.js');
    writeFileSync(path.join(root, 'observatory/check.local.mjs'), `export default ({ source, artifacts }) => {
      if (source !== 'Chris0Jeky/Pulseboard:observatory') throw new Error('wrong source');
      if (artifacts.length !== 1 || artifacts[0].project !== 'alibi') throw new Error('wrong artifact');
      if (!artifacts[0].content.includes('ALIBI_OBSERVATORY_CONTEXT')) throw new Error('missing Alibi policy input');
      console.log('local-policy-ok');
    };\n`);
    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /local-policy-ok/);
  } finally { rmSync(root, { recursive: true }); }
});
test('host checker reports the registered Alibi app release and rejects contract drift', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club', version: '0.11.6' }));
    writeAlibiRelease(root);
    install('alibi', root, 'observatory/browser.js', 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect-stat/alibi');
    const healthy = runChecker(root);
    assert.equal(healthy.status, 0, healthy.stderr || healthy.stdout);
    const report = JSON.parse(healthy.stdout);
    assert.equal(report.alibi.packageVersion, '0.11.6');
    assert.equal(report.alibi.catalogueTag, 'v0.11.6');
    assert.ok(report.alibi.registeredReleases.includes('0.11.6'));
    assert.match(report.alibi.artifactSha256, /^[a-f0-9]{64}$/);

    writeAlibiRelease(root, '0.11.6', 'wrong-tag');
    const catalogueDrift = runChecker(root);
    assert.notEqual(catalogueDrift.status, 0);
    assert.match(catalogueDrift.stderr + catalogueDrift.stdout, /content\/releases\.json must contain exactly one matching v0\.11\.6 record/);
    writeAlibiRelease(root);

    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club', version: '0.11.7' }));
    const drift = runChecker(root);
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr + drift.stdout, /package version 0\.11\.7 is not registered/i);
  } finally { rmSync(root, { recursive: true }); }
});
test('installer preserves host notes and refuses an edited shared checker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    install('mdviewer', root, 'public/observer.js');
    const readmePath = path.join(root, 'observatory/README.md');
    writeFileSync(readmePath, '# Host-specific Observatory notes\n');
    install('commitatlas', root, 'site/observer.js');
    assert.equal(readFileSync(readmePath, 'utf8'), '# Host-specific Observatory notes\n');
    const healthy = runChecker(root);
    assert.equal(healthy.status, 0, healthy.stderr || healthy.stdout);
    assert.deepEqual(JSON.parse(healthy.stdout).targets, ['public/observer.js', 'site/observer.js']);
    const checkerPath = path.join(root, 'observatory/check.mjs');
    writeFileSync(checkerPath, '// hand-written checker\n');
    assert.throws(() => install('mdviewer', root, 'public/observer.js'), /shared host checker has local edits/i);
    assert.equal(readFileSync(checkerPath, 'utf8'), '// hand-written checker\n');
  } finally { rmSync(root, { recursive: true }); }
});
test('installer accepts checkout-only CRLF for generated artifacts and auxiliary files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    install('mdviewer', root, 'public/observer.js');
    for (const relative of ['public/observer.js', 'observatory/check.mjs', 'observatory/README.md']) {
      const file = path.join(root, relative);
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('\n', '\r\n'));
    }
    assert.doesNotThrow(() => install('commitatlas', root, 'site/observer.js'));
    const readme = readFileSync(path.join(root, 'observatory/README.md'), 'utf8');
    assert.match(readme, /public\/observer\.js text eol=lf/);
    assert.match(readme, /site\/observer\.js text eol=lf/);
    assert.equal(readme.includes('\r'), false);
    assert.equal(readFileSync(path.join(root, 'observatory/check.mjs'), 'utf8').includes('\r'), false);
    const healthy = runChecker(root);
    assert.equal(healthy.status, 0, healthy.stderr || healthy.stdout);
    assert.doesNotThrow(() => install('mdviewer', root, 'public/observer.js'));
    assert.equal(readFileSync(path.join(root, 'public/observer.js'), 'utf8').includes('\r'), false);
  } finally { rmSync(root, { recursive: true }); }
});
test('installer reserves every generated auxiliary path from browser artifacts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    for (const target of ['observatory/check.mjs', 'observatory/README.md', 'observatory/check.local.mjs', 'observatory\\check.mjs']) {
      assert.throws(() => install('mdviewer', root, target), /reserved/i, target);
    }
    assert.throws(() => install('mdviewer', root, 'observatory/./README.md'), /reserved/i);
  } finally { rmSync(root, { recursive: true }); }
});
test('installer rejects a symlinked auxiliary directory even when it stays inside the repository', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-'));
  try {
    const physical = path.join(root, 'tools', 'obs');
    mkdirSync(physical, { recursive: true });
    symlinkSync(physical, path.join(root, 'observatory'), 'dir');
    assert.throws(() => install('mdviewer', root, 'public/observer.js'), /auxiliary|parent.*symlink/i);
  } finally { rmSync(root, { recursive: true }); }
});
test('Taskdeck cannot accidentally acquire a public embed', () => assert.throws(() => buildEmbed('taskdeck'), /no public collection origin/));
