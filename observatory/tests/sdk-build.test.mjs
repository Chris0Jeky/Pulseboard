import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSdk, writeSdk, isPristineSdk, SDK_COLLECTOR } from '../adapters/build-sdk.mjs';
import { projects } from '../src/projects.mjs';
import { SDK_VERSION } from '../sdk/pulseboard-sdk.mjs';
import { makeRuntime, byClass } from './sdk-fakes.mjs';

const configOf = code => JSON.parse(/^const config = (\{.*\});$/m.exec(code)[1]);

test('the artifact is deterministic, LF-only, hash-stamped and carries only the client contract', () => {
  const a = buildSdk('alibi'), b = buildSdk('alibi');
  assert.equal(a, b);
  assert.equal(a.includes('\r'), false);
  const [header] = a.split('(function () {');
  assert.ok(header.includes('pulseboard-sdk ' + SDK_VERSION + ' for alibi.'));
  const hash = /sha256 of the body below: ([0-9a-f]{64})/.exec(header)[1];
  assert.equal(createHash('sha256').update(a.slice(header.length)).digest('hex'), hash);
  assert.equal(isPristineSdk(a), true);
  assert.equal(isPristineSdk(a.replace("'use strict';", "'use strict'; void 0;")), false);
  assert.deepEqual(a.split('\n').filter(line => /^(?:import|export)\b/.test(line)), []);
  const config = configOf(a);
  assert.deepEqual(Object.keys(config), ['id', 'label', 'origin', 'collector', 'release', 'route', 'project']);
  assert.equal(config.collector, SDK_COLLECTOR);
  assert.equal(config.origin, projects.alibi.origin);
  assert.equal(config.release, projects.alibi.releases.at(-1), 'defaults to the newest registered release');
  assert.deepEqual(Object.keys(config.project), ['events', 'routes', 'releases']);
  for (const secret of ['probe', 'marker', 'dailyLimit', 'binding', 'ALIBI']) assert.equal(JSON.stringify(config).includes(secret), false, secret);
  assert.equal(configOf(buildSdk('alibi', { release: '0.12.0' })).release, '0.12.0');
  assert.throws(() => buildSdk('alibi', { release: '9.9.9' }), /registered releases/);
  assert.throws(() => buildSdk('taskdeck'), /no public collection origin/);
  assert.throws(() => buildSdk('nope'), /Register the project/);
});

test('the artifact parses under node --check and runs as a classic script exposing window.Pulseboard', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-sdk-'));
  try {
    const file = path.join(dir, 'pulseboard.js');
    writeFileSync(file, buildSdk('mdviewer'));
    execFileSync(process.execPath, ['--check', file]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const code = buildSdk('mdviewer');
  const h = makeRuntime({ origin: projects.mdviewer.origin, region: 'eea', loading: true });
  const context = h.runtime;
  context.globalThis = context;
  Object.assign(context, { URL, URLSearchParams, Object, JSON, Math, Date, Number, String, Array, Set, Map, Promise, Uint8Array, TypeError, Error, RegExp });
  vm.createContext(context);
  vm.runInContext(code, context);
  const api = context.Pulseboard;
  assert.deepEqual(Object.keys(api), ['version', 'route', 'count', 'track', 'consent']);
  assert.equal(api.version, SDK_VERSION);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(h.body.children.length, 0, 'waits for DOMContentLoaded');
  h.document.emit('DOMContentLoaded');
  assert.equal(h.body.children[0].className, 'pb-bar');
  assert.equal(api.count('export.print_requested'), true);
  await new Promise(resolve => setImmediate(resolve)); // the region hint answers `eea`
  assert.equal(api.track('export.done', {}), false, 'journeys wait for OK in the EEA');
  byClass(h.body, 'pb-ok')[0].emit('click');
  assert.equal(api.consent.get().journeys, true);
  assert.equal(api.track('export.done', { pages: 3 }), true);
  // A second copy of the script does not mount a second bar or replace the API.
  vm.runInContext(code, context);
  assert.equal(context.Pulseboard, api);
  assert.equal(byClass(h.body, 'pb-pill').length, 1);
  // bfcache restore of a disposed instance mounts a fresh one; a live one is left alone.
  context.emit('pageshow', { persisted: true });
  assert.equal(byClass(h.body, 'pb-pill').length, 1);
  context.emit('pagehide', { persisted: false });
  context.emit('pageshow', { persisted: true });
  assert.equal(api.count('export.print_requested'), true, 'remounted after a disposed restore');
  assert.equal(byClass(h.body, 'pb-pill').length, 1, 'the stale notice is replaced, not duplicated');
});

test('writeSdk writes inside the target repository only and never over an edited or foreign file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pb-host-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'pb-outside-'));
  try {
    const result = writeSdk('alibi', root, 'public/pulseboard.js', { release: '0.13.0' });
    const written = readFileSync(path.join(root, 'public/pulseboard.js'), 'utf8');
    assert.equal(written, buildSdk('alibi', { release: '0.13.0' }));
    assert.equal(result.sha256, createHash('sha256').update(written).digest('hex'));
    assert.equal(result.release, '0.13.0');
    assert.doesNotThrow(() => writeSdk('alibi', root, 'public/pulseboard.js'), 'a pristine artifact may be regenerated');
    writeFileSync(path.join(root, 'public/pulseboard.js'), written.replace('Beta', 'Gamma'));
    assert.throws(() => writeSdk('alibi', root, 'public/pulseboard.js'), /not an unedited Pulseboard SDK artifact/);
    writeFileSync(path.join(root, 'app.js'), 'console.log(1);\n');
    assert.throws(() => writeSdk('alibi', root, 'app.js'), /refusing overwrite/);
    for (const target of ['../escape.js', path.join(outside, 'abs.js'), 'a/../../escape.js']) {
      assert.throws(() => writeSdk('alibi', root, target), /relative path inside the repository/, target);
    }
    for (const target of ['observatory.lock.json', 'OBSERVATORY.LOCK.JSON', 'observatory/check.local.mjs']) {
      if (target === 'OBSERVATORY.LOCK.JSON' && process.platform !== 'win32') continue;
      assert.throws(() => writeSdk('alibi', root, target), /reserved/, target);
    }
    let linked = false;
    try { symlinkSync(outside, path.join(root, 'out'), 'junction'); linked = true; } catch { /* Symlinks may be unavailable. */ }
    if (linked) assert.throws(() => writeSdk('alibi', root, 'out/pulseboard.js'), /Symlink leaves repository/);
    mkdirSync(path.join(root, 'nested'), { recursive: true });
    assert.doesNotThrow(() => writeSdk('mdviewer', root, 'nested/deeper/pb.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('the CLI prints the artifact for a bare id and refuses a half-specified target', () => {
  const script = fileURLToPath(new URL('../adapters/build-sdk.mjs', import.meta.url));
  const printed = execFileSync(process.execPath, [script, 'mdviewer'], { encoding: 'utf8' });
  assert.equal(printed, buildSdk('mdviewer'));
  assert.throws(() => execFileSync(process.execPath, [script, 'mdviewer', '.'], { stdio: 'pipe' }), /Give both/);
});
