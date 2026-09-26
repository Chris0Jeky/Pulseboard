import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ALIBI_RELEASES } from '../src/alibi-releases.mjs';

// A probe release one patch past the newest registered release, so registering a
// new Alibi version never requires editing this test.
const VERSION = (([major, minor, patch]) => `${major}.${minor}.${patch + 1}`)(
  ALIBI_RELEASES.at(-1).split('.').map(Number),
);
const ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect-stat/alibi';
const LEGACY_ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/alibi';
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
    const generatedText = readFileSync(path.join(alibi, 'observatory/browser.js'), 'utf8');
    assert.ok(generatedText.includes(ENDPOINT), 'synced artifact uses the new stat route');
    assert.equal(generatedText.includes(`"endpoint":"${LEGACY_ENDPOINT}"`), false, 'synced config does not use the retired raw endpoint');
    assert.ok(generatedText.includes('createStatisticObserver') && generatedText.includes('mountStatisticObserver'));
    assert.ok(generatedText.includes('ALIBI_OBSERVATORY_CONTEXT'));
    assert.equal(/MAX_BYTES|MAX_BATCH/.test(generatedText), false);
    const configLines = generatedText.split('\n').filter(line => line.startsWith('const config = '));
    assert.equal(configLines.length, 1, 'generated artifact keeps one config line for host checker/sync parser');
    const parsed = JSON.parse(/^const config = (\{.*\});$/.exec(configLines[0])[1]);
    assert.equal(parsed.endpoint, ENDPOINT);
    assert.equal(parsed.origin, 'https://alibi-after-hours-preview.commit-atlas.workers.dev');
    const host = checker(alibi);
    assert.equal(host.status, 0, host.stderr || host.stdout);
    assert.equal(JSON.parse(host.stdout).alibi.packageVersion, VERSION);
    assert.equal(JSON.parse(host.stdout).alibi.catalogueTag, 'v' + VERSION);

    const checked = syncAlibi(alibi, { mode: 'check' });
    assert.equal(checked.status, 'in-sync');
    assert.deepEqual(checked.changedFiles, []);
    assert.equal(checked.registered, true);
    assert.equal(checked.packageVersion, VERSION);
    const artifactPath = path.join(alibi, 'observatory/browser.js');
    const cleanBytes = readFileSync(artifactPath);
    const legacyBytes = String(cleanBytes).replace(`"endpoint":"${ENDPOINT}"`, `"endpoint":"${LEGACY_ENDPOINT}"`);
    assert.notEqual(legacyBytes, String(cleanBytes));
    writeFileSync(artifactPath, legacyBytes);
    const lockPath = path.join(alibi, 'observatory.lock.json');
    const migrateLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    migrateLock.installs['observatory/browser.js'].sha256 = createHash('sha256').update(legacyBytes).digest('hex');
    writeFileSync(lockPath, JSON.stringify(migrateLock, null, 2) + '\n');
    assert.throws(() => syncAlibi(alibi, { mode: 'check' }), /retired raw collector endpoint/);
    assert.equal(syncAlibi(alibi, { mode: 'write' }).status, 'updated', 'write migrates an owned legacy artifact');
    assert.equal(readFileSync(artifactPath, 'utf8'), String(cleanBytes));
    writeFileSync(artifactPath, String(cleanBytes).replace(ENDPOINT, 'https://example.test/v1/collect-stat/alibi'));
    assert.throws(() => syncAlibi(alibi, { mode: 'check' }), /differs from its locked bytes/);
    writeFileSync(artifactPath, cleanBytes);
    assert.equal(syncAlibi(alibi, { mode: 'check' }).status, 'in-sync', 'restored artifact is in-sync again');
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
