import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  const discoveryRoot = path.join(temp, 'discovery');
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
    const { renderAlibiReleaseRegistry, resolveAlibiCheckout, syncAlibi } = syncModule;
    const oldReleases = [...ALIBI_RELEASES];
    const nextReleases = ['unattributed', ...oldReleases.slice(1), VERSION];
    assert.match(renderAlibiReleaseRegistry(oldReleases), /npm run sync:alibi -- <alibi-repository>/);
    assert.doesNotMatch(renderAlibiReleaseRegistry(oldReleases), /sync:alibi -- --write/);
    const registryFile = path.join(pulseboard, 'src/alibi-releases.mjs');
    const siblingPulseboard = path.join(discoveryRoot, 'Pulseboard');
    const siblingAlibi = path.join(discoveryRoot, 'Alibi');
    mkdirSync(siblingPulseboard, { recursive: true });
    mkdirSync(siblingAlibi, { recursive: true });
    writeFileSync(path.join(siblingAlibi, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club' }));
    const discovered = resolveAlibiCheckout({ pulseboardRoot: siblingPulseboard, currentDirectory: siblingPulseboard, environment: {} });
    assert.deepEqual(discovered, { root: realpathSync(siblingAlibi), source: 'Pulseboard sibling discovery' });
    assert.equal(resolveAlibiCheckout({ pulseboardRoot: siblingPulseboard, currentDirectory: siblingAlibi, environment: {} }).source, 'current directory');
    assert.equal(resolveAlibiCheckout({ rootArgument: siblingAlibi, pulseboardRoot: siblingPulseboard, environment: { ALIBI_REPO: siblingPulseboard } }).source, 'path argument');
    assert.equal(resolveAlibiCheckout({ pulseboardRoot: siblingPulseboard, environment: { ALIBI_REPO: siblingAlibi } }).source, 'ALIBI_REPO');
    const secondSibling = path.join(discoveryRoot, 'alibi-copy');
    mkdirSync(secondSibling);
    writeFileSync(path.join(secondSibling, 'package.json'), JSON.stringify({ name: 'alibi-puzzle-club' }));
    assert.throws(() => resolveAlibiCheckout({ pulseboardRoot: siblingPulseboard, currentDirectory: siblingPulseboard, environment: {} }), /multiple Alibi checkouts/);
    rmSync(secondSibling, { recursive: true });
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
    assert.equal(synced.status, 'updated');
    assert.equal(synced.addedRelease, VERSION);
    assert.ok(synced.changedFiles.includes('Pulseboard/observatory/src/alibi-releases.mjs'));
    assert.ok(synced.changedFiles.includes('Alibi/observatory/browser.js'));
    assert.deepEqual(synced.releases, nextReleases);
    assert.deepEqual(projects.alibi.releases, nextReleases, 'successful sync must update the in-process collector contract');
    assert.equal(readFileSync(registryFile, 'utf8'), renderAlibiReleaseRegistry(nextReleases));
    assert.equal(readFileSync(outsideRegistry, 'utf8'), 'keep this file unchanged', 'sync must not accept a caller-controlled registry path');
    const host = checker(alibi);
    assert.equal(host.status, 0, host.stderr || host.stdout);
    assert.equal(JSON.parse(host.stdout).alibi.packageVersion, VERSION);
    assert.equal(JSON.parse(host.stdout).alibi.catalogueTag, 'v' + VERSION);

    const checked = syncAlibi(alibi, { mode: 'check' });
    assert.equal(checked.status, 'in-sync');
    assert.deepEqual(checked.changedFiles, []);
    assert.equal(checked.registered, true);
    assert.equal(checked.packageVersion, VERSION);
    const cliReport = spawnSync(process.execPath, ['adapters/sync-alibi.mjs', '--check', '--json', alibi], { cwd: pulseboard, encoding: 'utf8' });
    assert.equal(cliReport.status, 0, cliReport.stderr || cliReport.stdout);
    assert.equal(JSON.parse(cliReport.stdout).checkoutSource, 'path argument');
    assert.equal(JSON.parse(cliReport.stdout).status, 'in-sync');
    const envReport = spawnSync(process.execPath, ['adapters/sync-alibi.mjs', '--check', '--json'], {
      cwd: pulseboard, encoding: 'utf8', env: { ...process.env, ALIBI_REPO: alibi },
    });
    assert.equal(envReport.status, 0, envReport.stderr || envReport.stdout);
    assert.equal(JSON.parse(envReport.stdout).checkoutSource, 'ALIBI_REPO');

    writeFileSync(path.join(alibi, 'content/releases.json'), JSON.stringify([{ version: VERSION, tag: 'wrong-tag' }]));
    const staleCatalogue = checker(alibi);
    assert.notEqual(staleCatalogue.status, 0);
    assert.match(staleCatalogue.stderr, /content\/releases\.json must contain exactly one matching/);
    writeFileSync(path.join(alibi, 'content/releases.json'), JSON.stringify([{ version: VERSION, tag: 'v' + VERSION }]));

    makeAlibi(alibi, '0.11.8');
    assert.throws(() => syncAlibi(alibi, { mode: 'check' }), error => {
      assert.match(error.message, /0\.11\.8 is missing from the Pulseboard collector contract/);
      assert.match(error.message, /npm run sync:alibi -- <alibi-repository>/);
      assert.doesNotMatch(error.message, /sync:alibi -- --write/);
      return true;
    });
    const rejectedReport = spawnSync(process.execPath, ['adapters/sync-alibi.mjs', '--check', '--json', alibi], { cwd: pulseboard, encoding: 'utf8' });
    assert.notEqual(rejectedReport.status, 0);
    const rejectedJson = JSON.parse(rejectedReport.stdout);
    assert.equal(rejectedJson.ok, false);
    assert.match(rejectedJson.error.message, /0\.11\.8 is missing from the Pulseboard collector contract/);
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
