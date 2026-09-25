import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '0.11.7';
const ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/alibi';
const sourceObservatory = fileURLToPath(new URL('../', import.meta.url));
const checker = root => spawnSync(process.execPath, ['observatory/check.mjs'], { cwd: root, encoding: 'utf8' });

function makeAlibi(root, version = VERSION) {
  mkdirSync(path.join(root, 'content'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club', version }));
  writeFileSync(path.join(root, 'content/releases.json'), JSON.stringify([{ version, tag: 'v' + version }]));
}

test('Alibi release sync is repository-scoped, validates the catalogue and rolls back a late host write failure', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'observatory-alibi-sync-'));
  const pulseboard = path.join(temp, 'pulseboard');
  const alibi = path.join(temp, 'alibi');
  const lateAlibi = path.join(temp, 'late-alibi');
  try {
    mkdirSync(pulseboard, { recursive: true });
    cpSync(path.join(sourceObservatory, 'adapters'), path.join(pulseboard, 'adapters'), { recursive: true });
    cpSync(path.join(sourceObservatory, 'src'), path.join(pulseboard, 'src'), { recursive: true });
    const [syncModule, releasesModule, projectsModule, installModule] = await Promise.all([
      import(pathToFileURL(path.join(pulseboard, 'adapters/sync-alibi.mjs')).href),
      import(pathToFileURL(path.join(pulseboard, 'src/alibi-releases.mjs')).href),
      import(pathToFileURL(path.join(pulseboard, 'src/projects.mjs')).href),
      import(pathToFileURL(path.join(pulseboard, 'adapters/build-embed.mjs')).href),
    ]);
    const { ALIBI_RELEASES } = releasesModule;
    const { projects } = projectsModule;
    const { install } = installModule;
    const { renderAlibiReleaseRegistry, syncAlibi } = syncModule;
    const oldReleases = [...ALIBI_RELEASES];
    const nextReleases = ['unattributed', ...oldReleases.slice(1), VERSION];
    const registryFile = path.join(pulseboard, 'src/alibi-releases.mjs');
    const hostFiles = root => [
      'observatory/browser.js',
      'observatory/check.mjs',
      'observatory/README.md',
      'observatory.lock.json',
    ].map(relative => [relative, readFileSync(path.join(root, relative))]);

    makeAlibi(alibi);
    install('alibi', alibi, 'observatory/browser.js', ENDPOINT);
    const outsideRegistry = path.join(temp, 'outside.mjs');
    writeFileSync(outsideRegistry, 'keep this file unchanged');
    const synced = syncAlibi(alibi, { mode: 'write', registryFile: outsideRegistry });
    assert.equal(synced.addedRelease, VERSION);
    assert.deepEqual(synced.releases, nextReleases);
    assert.deepEqual(projects.alibi.releases, nextReleases, 'successful sync must update the in-process collector contract');
    assert.equal(readFileSync(registryFile, 'utf8'), renderAlibiReleaseRegistry(nextReleases));
    assert.equal(readFileSync(outsideRegistry, 'utf8'), 'keep this file unchanged', 'sync must not accept a caller-controlled registry path');
    const host = checker(alibi);
    assert.equal(host.status, 0, host.stderr || host.stdout);
    assert.equal(JSON.parse(host.stdout).alibi.packageVersion, VERSION);
    assert.equal(JSON.parse(host.stdout).alibi.catalogueTag, 'v' + VERSION);

    const checked = syncAlibi(alibi, { mode: 'check' });
    assert.equal(checked.registered, true);
    assert.equal(checked.packageVersion, VERSION);

    writeFileSync(path.join(alibi, 'content/releases.json'), JSON.stringify([{ version: VERSION, tag: 'wrong-tag' }]));
    const staleCatalogue = checker(alibi);
    assert.notEqual(staleCatalogue.status, 0);
    assert.match(staleCatalogue.stderr, /content\/releases\.json must contain exactly one matching/);
    writeFileSync(path.join(alibi, 'content/releases.json'), JSON.stringify([{ version: VERSION, tag: 'v' + VERSION }]));

    makeAlibi(alibi, '0.11.8');
    assert.throws(() => syncAlibi(alibi, { mode: 'check' }), /0\.11\.8 is missing from the Pulseboard collector contract/);
    makeAlibi(alibi);

    projects.alibi.releases = oldReleases;
    writeFileSync(registryFile, renderAlibiReleaseRegistry(oldReleases));
    makeAlibi(lateAlibi);
    install('alibi', lateAlibi, 'observatory/browser.js', ENDPOINT);
    const beforeHost = hostFiles(lateAlibi);
    const beforeRegistry = readFileSync(registryFile);
    const lock = path.join(lateAlibi, 'observatory.lock.json');
    const lockMode = (await import('node:fs')).statSync(lock).mode & 0o777;
    try {
      chmodSync(lock, 0o444);
      assert.throws(() => syncAlibi(lateAlibi, { mode: 'write' }), /EACCES|EPERM|permission denied|read-only/i);
    } finally {
      chmodSync(lock, lockMode);
    }
    assert.equal(readFileSync(registryFile).compare(beforeRegistry), 0, 'failed late host write must restore Pulseboard release registration');
    for (const [relative, bytes] of beforeHost) {
      assert.equal(readFileSync(path.join(lateAlibi, relative)).compare(bytes), 0, `failed sync must restore ${relative}`);
    }
    assert.deepEqual(projects.alibi.releases, oldReleases, 'failed sync must restore temporary module state');
  } finally {
    rmSync(temp, { recursive: true });
  }
});
