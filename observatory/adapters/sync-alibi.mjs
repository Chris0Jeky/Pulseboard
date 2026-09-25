import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALIBI_RELEASES } from '../src/alibi-releases.mjs';
import { projects } from '../src/projects.mjs';
import { buildEmbed, install } from './build-embed.mjs';

const SOURCE = 'Chris0Jeky/Pulseboard:observatory';
const PACKAGE_NAME = 'alibi-puzzle-club';
const TARGET = 'observatory/browser.js';
const ENDPOINT = 'https://pulseboard-observatory.commit-atlas.workers.dev/v1/collect/alibi';
const REGISTRY = fileURLToPath(new URL('../src/alibi-releases.mjs', import.meta.url));
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const normalise = value => String(value).replaceAll('\r\n', '\n');
const sha256 = value => createHash('sha256').update(normalise(value)).digest('hex');

function safeFile(root, relative, label) {
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error(label + ' path leaves the Alibi repository');
  let current = root;
  for (const part of path.relative(root, path.dirname(full)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const parent = lstatSync(current, { throwIfNoEntry: false });
    if (parent?.isSymbolicLink()) throw new Error(label + ' path contains a symlink');
  }
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(label + ' is missing or is not a regular file');
  const resolved = realpathSync(full);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(label + ' path leaves the Alibi repository');
  return full;
}

function safeRegistryPath(registryFile, registryRoot) {
  const full = path.resolve(registryFile);
  const root = realpathSync(registryRoot);
  if (full === root || !full.startsWith(root + path.sep)) throw new Error('Pulseboard Alibi release registry leaves the repository');
  let current = root;
  for (const part of path.relative(root, path.dirname(full)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const parent = lstatSync(current, { throwIfNoEntry: false });
    if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('Pulseboard Alibi release registry path contains an unsafe directory');
  }
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Pulseboard Alibi release registry is missing or is not a regular file');
  if (!realpathSync(full).startsWith(root + path.sep)) throw new Error('Pulseboard Alibi release registry leaves the repository');
  return full;
}

function snapshotManagedFiles(root, relatives, owner = 'Alibi') {
  return relatives.map(relative => {
    const full = path.resolve(root, relative);
    if (!full.startsWith(root + path.sep)) throw new Error('Managed Alibi output path leaves the repository');
    let current = root;
    for (const part of path.relative(root, path.dirname(full)).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const parent = lstatSync(current, { throwIfNoEntry: false });
      if (!parent?.isDirectory() || parent.isSymbolicLink()) throw new Error('Managed Alibi output path contains an unsafe directory');
    }
    const stat = lstatSync(full, { throwIfNoEntry: false });
    const label = `${owner}/${relative.split(path.sep).join('/')}`;
    if (!stat) return { full, label, existed: false };
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Managed Alibi output is not a regular file: ' + relative);
    return { full, label, existed: true, bytes: readFileSync(full) };
  });
}

function restoreManagedFiles(snapshots) {
  const failures = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      const current = lstatSync(snapshot.full, { throwIfNoEntry: false });
      if (!snapshot.existed) {
        if (current) {
          if (!current.isFile() || current.isSymbolicLink()) throw new Error('refusing to remove a changed non-file');
          unlinkSync(snapshot.full);
        }
      } else {
        if (current && (!current.isFile() || current.isSymbolicLink())) throw new Error('refusing to overwrite a changed non-file');
        if (!current || !readFileSync(snapshot.full).equals(snapshot.bytes)) writeFileSync(snapshot.full, snapshot.bytes);
      }
    } catch (error) {
      failures.push(`${snapshot.full}: ${error.message}`);
    }
  }
  return failures;
}

function parseConfig(content) {
  const lines = normalise(content).split('\n').filter(line => line.startsWith('const config = '));
  if (lines.length !== 1) throw new Error('Alibi Observatory artifact has no unique generated configuration');
  const match = /^const config = (\{.*\});$/.exec(lines[0]);
  if (!match) throw new Error('Alibi Observatory artifact configuration is malformed');
  const config = JSON.parse(match[1]);
  if (config.id !== 'alibi' || !Array.isArray(config.project?.releases)) throw new Error('Alibi Observatory artifact has no closed release contract');
  return config;
}

function readAlibi(rootInput) {
  const root = realpathSync(rootInput);
  const packageJson = JSON.parse(readFileSync(safeFile(root, 'package.json', 'Alibi package manifest'), 'utf8'));
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== 'string' || !SEMVER.test(packageJson.version)) {
    throw new Error('Expected alibi-puzzle-club with a stable x.y.z package version');
  }
  const releases = JSON.parse(readFileSync(safeFile(root, 'content/releases.json', 'Alibi release catalogue'), 'utf8'));
  if (!Array.isArray(releases)) throw new Error('Alibi release catalogue must be an array');
  const records = releases.filter(release => release?.version === packageJson.version);
  if (records.length !== 1 || records[0].tag !== 'v' + packageJson.version) {
    throw new Error(`Alibi package ${packageJson.version} must have exactly one matching v${packageJson.version} record in content/releases.json`);
  }
  const lockPath = safeFile(root, 'observatory.lock.json', 'Alibi Observatory lock');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.source !== SOURCE) throw new Error('Alibi Observatory lock has an unexpected source');
  const entries = lock.installs ?? (typeof lock.target === 'string' ? { [lock.target]: { project: lock.project, sha256: lock.sha256 } } : null);
  if (!entries || Object.getPrototypeOf(entries) !== Object.prototype) throw new Error('Alibi Observatory lock has an unsupported shape');
  const entry = entries[TARGET];
  if (entry?.project !== 'alibi' || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error(`Alibi Observatory lock does not own ${TARGET}`);
  const artifactPath = safeFile(root, TARGET, 'Alibi Observatory artifact');
  const artifact = readFileSync(artifactPath, 'utf8');
  if (sha256(artifact) !== entry.sha256) throw new Error('Alibi Observatory artifact differs from its locked bytes; inspect local edits before syncing');
  const config = parseConfig(artifact);
  if (config.endpoint !== ENDPOINT) throw new Error('Alibi Observatory artifact does not use the already approved collector endpoint');
  return { root, version: packageJson.version, registry: releases, artifactPath, artifact, config, lock };
}

function validateReleases(releases) {
  if (!Array.isArray(releases) || releases[0] !== 'unattributed' || releases.some((release, index) =>
    typeof release !== 'string' || (index > 0 && !SEMVER.test(release)))) throw new Error('Alibi release registry must start with unattributed and then contain stable x.y.z versions');
  if (new Set(releases).size !== releases.length) throw new Error('Alibi release registry contains duplicates');
  if (releases.slice(1).some((release, index, versions) => index > 0 && compareVersion(versions[index - 1], release) > 0)) {
    throw new Error('Alibi release registry versions must be in ascending order');
  }
  return [...releases];
}

function compareVersion(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function renderAlibiReleaseRegistry(releases) {
  const values = validateReleases(releases);
  return '// Generated by npm run sync:alibi -- <alibi-repository>.\n'
    + '// This closed list feeds both collector validation and the host adapter.\n'
    + `export const ALIBI_RELEASES = Object.freeze(${JSON.stringify(values, null, 2)});\n`;
}

const PULSEBOARD_ROOT = realpathSync(path.resolve(path.dirname(REGISTRY), '../..'));

function hasAlibiManifest(root) {
  try {
    const rootStat = lstatSync(root, { throwIfNoEntry: false });
    const manifestPath = path.join(root, 'package.json');
    const manifestStat = lstatSync(manifestPath, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || !manifestStat?.isFile() || manifestStat.isSymbolicLink()) return false;
    return JSON.parse(readFileSync(manifestPath, 'utf8')).name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

function resolveExistingPath(value, source) {
  try {
    return { root: realpathSync(value), source };
  } catch (error) {
    throw new Error(`Alibi checkout from ${source} cannot be resolved: ${error.message}`);
  }
}

export function resolveAlibiCheckout({ rootArgument, environment = process.env, currentDirectory = process.cwd(), pulseboardRoot = PULSEBOARD_ROOT } = {}) {
  if (typeof rootArgument === 'string' && rootArgument.trim()) return resolveExistingPath(rootArgument.trim(), 'path argument');
  if (typeof environment.ALIBI_REPO === 'string' && environment.ALIBI_REPO.trim()) {
    return resolveExistingPath(environment.ALIBI_REPO.trim(), 'ALIBI_REPO');
  }
  if (hasAlibiManifest(currentDirectory)) return resolveExistingPath(currentDirectory, 'current directory');

  const siblingRoot = path.dirname(realpathSync(pulseboardRoot));
  let candidates;
  try {
    candidates = readdirSync(siblingRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && hasAlibiManifest(path.join(siblingRoot, entry.name)))
      .map(entry => path.join(siblingRoot, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    throw new Error(`Could not inspect Pulseboard's sibling checkouts: ${error.message}`);
  }
  if (candidates.length === 1) return resolveExistingPath(candidates[0], 'Pulseboard sibling discovery');
  if (candidates.length > 1) {
    const names = candidates.map(candidate => path.basename(candidate)).join(', ');
    throw new Error(`Found multiple Alibi checkouts beside Pulseboard (${names}); pass the intended path or set ALIBI_REPO`);
  }
  throw new Error('No Alibi checkout found. Pass its path, set ALIBI_REPO, or place one Alibi checkout beside Pulseboard.');
}

export function syncAlibi(rootInput, { mode = 'check' } = {}) {
  if (!['check', 'write'].includes(mode)) throw new Error('Mode must be check or write');
  const alibi = readAlibi(rootInput);
  const current = validateReleases(projects.alibi.releases ?? ALIBI_RELEASES);
  const registryFile = safeRegistryPath(REGISTRY, PULSEBOARD_ROOT);
  const registryBytes = readFileSync(registryFile, 'utf8');
  if (normalise(registryBytes) !== renderAlibiReleaseRegistry(current)) throw new Error('Pulseboard Alibi release registry has local edits or drift; inspect before syncing');
  const wasRegistered = current.includes(alibi.version);
  if (mode === 'check') {
    if (!wasRegistered) throw new Error(`Alibi ${alibi.version} is missing from the Pulseboard collector contract; run npm run sync:alibi -- <alibi-repository>`);
    const generated = buildExpectedEmbed(current);
    if (normalise(alibi.artifact) !== normalise(generated)) throw new Error('Alibi Observatory artifact is stale; regenerate it with npm run sync:alibi -- <alibi-repository>');
    return { mode, status: 'in-sync', project: 'alibi', packageVersion: alibi.version, registered: true, addedRelease: null,
      releases: current, target: TARGET, sha256: sha256(generated), bytes: Buffer.byteLength(generated), changedFiles: [] };
  }

  const next = wasRegistered ? current : ['unattributed', ...new Set([...current.slice(1), alibi.version].sort(compareVersion))];
  const previousReleases = projects.alibi.releases;
  const snapshots = [
    ...snapshotManagedFiles(alibi.root, ['observatory/browser.js', 'observatory/check.mjs', 'observatory/README.md', 'observatory.lock.json']),
    { full: registryFile, label: 'Pulseboard/observatory/src/alibi-releases.mjs', existed: true, bytes: Buffer.from(registryBytes, 'utf8') },
  ];
  try {
    if (!wasRegistered) writeFileSync(registryFile, renderAlibiReleaseRegistry(next), 'utf8');
    projects.alibi.releases = next;
    const installed = install('alibi', alibi.root, TARGET, ENDPOINT);
    const generated = buildExpectedEmbed(next);
    const changedFiles = snapshots.filter(snapshot => {
      const stat = lstatSync(snapshot.full, { throwIfNoEntry: false });
      if (!snapshot.existed) return Boolean(stat);
      return !stat?.isFile() || stat.isSymbolicLink() || !readFileSync(snapshot.full).equals(snapshot.bytes);
    }).map(snapshot => snapshot.label);
    return { mode, status: changedFiles.length ? 'updated' : 'unchanged', project: 'alibi', packageVersion: alibi.version, registered: true,
      addedRelease: wasRegistered ? null : alibi.version, releases: next, target: TARGET, sha256: installed.sha256,
      bytes: Buffer.byteLength(generated), changedFiles };
  } catch (error) {
    projects.alibi.releases = previousReleases;
    const rollbackFailures = restoreManagedFiles(snapshots);
    if (rollbackFailures.length) {
      throw new AggregateError([error, ...rollbackFailures.map(message => new Error(message))],
        `Alibi sync failed and rollback was incomplete: ${error.message}; ${rollbackFailures.join('; ')}`);
    }
    throw error;
  }
}

function buildExpectedEmbed(releases) {
  projects.alibi.releases = releases;
  return buildEmbed('alibi', { endpoint: ENDPOINT });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2).filter(argument => argument !== '--');
  const json = args.includes('--json');
  const filtered = args.filter(argument => argument !== '--json');
  const [mode, root, ...extra] = filtered;
  const usage = 'Usage: node adapters/sync-alibi.mjs --check|--write [--json] [alibi-repository]; without a path, set ALIBI_REPO or allow unique sibling discovery';
  if (!['--check', '--write'].includes(mode) || extra.length > 0) {
    if (json) console.log(JSON.stringify({ schema: 'pulseboard.alibi-sync/1', ok: false, error: { code: 'USAGE', message: usage } }));
    else console.error(usage);
    process.exitCode = 2;
  } else {
    try {
      const checkout = resolveAlibiCheckout({ rootArgument: root });
      const result = syncAlibi(checkout.root, { mode: mode.slice(2) });
      console.log(JSON.stringify({ schema: 'pulseboard.alibi-sync/1', ok: true, checkoutSource: checkout.source, ...result }, null, 2));
    } catch (error) {
      if (json) console.log(JSON.stringify({ schema: 'pulseboard.alibi-sync/1', ok: false, error: { code: 'ALIBI_SYNC_FAILED', message: error.message } }, null, 2));
      else console.error(error.message);
      process.exitCode = 1;
    }
  }
}
