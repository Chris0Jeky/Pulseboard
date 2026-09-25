import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildHostChecker, buildHostReadme, HOST_CHECKER, HOST_README } from './check-installed.mjs';
import { projects } from '../src/projects.mjs';
// Sources may be checked out with CRLF (core.autocrlf); the strip patterns below are anchored on bare newlines.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const normalise = value => String(value).replaceAll('\r\n', '\n');
/** The artifact is a plain script: no module statements survive, and no server-only constant is published. */
export function assertArtifactShape(content) {
  const leaked = content.split('\n').find(line => /^(?:import|export)\b/.test(line));
  if (leaked) throw new Error('Generated artifact still contains a module statement: ' + leaked.slice(0, 60));
  if (/MAX_BYTES|MAX_BATCH/.test(content)) throw new Error('Generated artifact still contains server-only constants');
  return content;
}
const EMBED_OPTIONS = ['endpoint', 'release', 'route', 'clicks'];
export function buildEmbed(id, options = {}) {
  if (!Object.hasOwn(projects, id)) throw new Error('Register the project in src/projects.mjs first');
  const unsupported = Object.keys(options).find(key => !EMBED_OPTIONS.includes(key));
  if (unsupported) throw new Error('Unsupported embed option: ' + unsupported);
  const project = projects[id];
  if (!project.origin) throw new Error('This project deliberately has no public collection origin');
  // Only the client-side contract is published. Probe URLs, markers, budgets and labels are operator data.
  const contractOnly = { events: project.events, routes: project.routes, releases: project.releases, measurements: project.measurements };
  const config = { id, project: contractOnly, origin: project.origin, endpoint: '',
    scopePath: project.probe ? new URL(project.probe.url).pathname : '/',
    release: 'unattributed', route: 'home', clicks: [], ...options };
  if (project.contextGlobal !== undefined) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(project.contextGlobal)) throw new Error('Project context global must be a bounded identifier');
    config.contextGlobal = project.contextGlobal;
  }
  if (id === 'alibi') config.publicFlag = { global: 'ALIBI_CONFIG', key: 'standalone', expected: false };
  if (id === 'alibi') {
    // Alibi uses the aggregate statistic route. The retired raw route is never
    // generated here; its opt-out key is preserved by the stat-embed control.
    if (config.endpoint) {
      let u;
      try {
        u = new URL(config.endpoint);
      } catch {
        throw new Error('Expected the exact HTTPS statistic collector endpoint');
      }
      if (u.protocol !== 'https:' || u.pathname !== '/v1/collect-stat/alibi' || u.search || u.hash || u.username || u.password) throw new Error('Expected the exact HTTPS statistic collector endpoint');
    }
    // JSON escapes prevent accidental HTML script termination when embedding in an offline artifact.
    const json = JSON.stringify(config).replaceAll('<', '\\u003c');
    // Only the two client modules are published: aggregate transport plus
    // statistic control. Server validation from stat-contract stays server-side.
    // Stripping covers only module declarations so vm.Script shape stays plain.
    const statBrowser = read('../src/stat-browser.mjs').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    const statEmbed = read('./stat-embed.mjs').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    return assertArtifactShape(`/* SPDX-License-Identifier: GPL-3.0-only
 * Pulseboard Observatory 0.1.0. Generated; see observatory.lock.json.
 * Disabled until endpoint is configured. No dynamic/CDN dependency. */
(function () {
'use strict';
${statBrowser}
${statEmbed}
const config = ${json};
function start() { globalThis.PulseboardUsage?.dispose(); globalThis.PulseboardUsage = mountStatisticObserver(config, createStatisticObserver); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
globalThis.addEventListener?.('pageshow', event => { if (event.persisted && globalThis.PulseboardUsage?.resume?.() === undefined) start(); });
})();
`);
  }
  if (config.endpoint) {
    const u = new URL(config.endpoint);
    if (u.protocol !== 'https:' || u.pathname !== '/v1/collect/' + id || u.search || u.hash || u.username || u.password) throw new Error('Expected the exact HTTPS project collector endpoint');
  }
  // JSON escapes prevent accidental HTML script termination when embedding in an offline artifact.
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  const contract = read('../src/contracts.mjs').split('export function validateBatch')[0].replace(/^export const MAX_(?:BYTES|BATCH) =.*\n/gm, '').replace(/^export /gm, '');
  const browser = read('../src/browser.mjs').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const embed = read('./embed.mjs').replace(/^export /gm, '');
  return assertArtifactShape(`/* SPDX-License-Identifier: GPL-3.0-only
 * Pulseboard Observatory 0.1.0. Generated; see observatory.lock.json.
 * Disabled until endpoint is configured. No dynamic/CDN dependency. */
(function () {
'use strict';
${contract}
${browser}
${embed}
const config = ${json};
function start() { globalThis.PulseboardUsage?.dispose(); globalThis.PulseboardUsage = mountObserver(config, createObserver); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
globalThis.addEventListener?.('pageshow', event => { if (event.persisted && globalThis.PulseboardUsage?.resume?.() === undefined) start(); });
})();
`);
}
const SOURCE = 'Chris0Jeky/Pulseboard:observatory';
/** The lock is keyed by target so two installs in one repository do not clobber each other; the original single-entry shape migrates on read. */
function readLock(lockPath, present) {
  const empty = { version: '0.1.0', source: SOURCE, installs: {} };
  if (!present) return empty;
  const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (raw?.installs && Object.getPrototypeOf(raw.installs) === Object.prototype) return { ...empty, installs: { ...raw.installs } };
  if (typeof raw?.target === 'string') return { ...empty, installs: { [raw.target.split(/[\\/]/).join('/')]: { project: raw.project, sha256: raw.sha256 } } };
  return empty;
}
const RESERVED_INSTALL_TARGETS = [HOST_CHECKER, HOST_README, 'observatory/check.local.mjs', 'observatory.lock.json'];
/** Windows normally resolves path aliases case-insensitively; reject every alias before any write occurs. */
export function isReservedInstallTarget(target, base, platform = process.platform) {
  const fold = value => platform === 'win32' ? value.toLowerCase() : value;
  const key = fold(target.split(/[\\/]/).join('/'));
  const full = fold(path.resolve(base, target));
  return RESERVED_INSTALL_TARGETS.some(relative => fold(relative) === key || fold(path.resolve(base, relative)) === full);
}
export function install(id, root, target, endpoint = '') {
  const base = realpathSync(root), full = path.resolve(base, target), key = target.split(/[\\/]/).join('/');
  if (path.isAbsolute(target) || !full.startsWith(base + path.sep) || target.split(/[\\/]/).includes('..')) throw new Error('Target must be a relative path inside the repository');
  if (isReservedInstallTarget(target, base)) throw new Error('Target is reserved for Observatory installer metadata');
  // Do not follow symlink parents into another tree. lstat, never existsSync: a dangling symlink is still a symlink.
  let parent = path.dirname(full);
  while (!lstatSync(parent, { throwIfNoEntry: false })) parent = path.dirname(parent);
  let resolved; try { resolved = realpathSync(parent); } catch { throw new Error('Symlink leaves repository'); }
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Symlink leaves repository');
  const targetStat = lstatSync(full, { throwIfNoEntry: false });
  if (targetStat?.isSymbolicLink()) throw new Error('Refusing a symlink target');
  const lockPath = path.join(base, 'observatory.lock.json');
  const lockStat = lstatSync(lockPath, { throwIfNoEntry: false });
  if (full === lockPath || lockStat?.isSymbolicLink()) throw new Error('Refusing reserved or symlinked lock path');
  const lock = readLock(lockPath, !!lockStat), owned = lock.installs[key];
  if (targetStat && (!targetStat.isFile() || !owned || owned.sha256 !== digest(normalise(readFileSync(full, 'utf8'))))) throw new Error('Existing file has local edits or is unowned; refusing overwrite');
  // Nothing is written or checksummed until the artifact parses as a plain script and holds its published shape.
  const content = buildEmbed(id, { endpoint }); new vm.Script(content); assertArtifactShape(content);
  const expectedHash = digest(content), checkerContent = buildHostChecker();
  const inspectAuxiliary = (relative, label) => {
    const candidate = path.resolve(base, relative);
    let logicalParent = path.dirname(candidate);
    while (logicalParent !== base) {
      if (lstatSync(logicalParent, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(label + ' auxiliary parent must not be a symlink');
      logicalParent = path.dirname(logicalParent);
    }
    let ancestor = path.dirname(candidate);
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = path.dirname(ancestor);
    const resolvedAncestor = realpathSync(ancestor);
    if (resolvedAncestor !== base && !resolvedAncestor.startsWith(base + path.sep)) throw new Error(label + ' parent leaves repository');
    const stat = lstatSync(candidate, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error(label + ' must be a regular file');
    return { candidate, stat };
  };
  const checker = inspectAuxiliary(HOST_CHECKER, 'Shared host checker');
  if (checker.stat && normalise(readFileSync(checker.candidate, 'utf8')) !== checkerContent) throw new Error('Shared host checker has local edits; move host-specific assertions to observatory/check.local.mjs, remove the old checker, and reinstall');
  const readme = inspectAuxiliary(HOST_README, 'Observatory host README');
  const previousReadme = buildHostReadme(Object.keys(lock.installs));
  const manageReadme = !readme.stat || normalise(readFileSync(readme.candidate, 'utf8')) === previousReadme;

  mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, content);
  const writtenHash = digest(readFileSync(full));
  if (writtenHash !== expectedHash) throw new Error('Generated artifact changed while writing; refusing lock update');
  lock.installs[key] = { project: id, sha256: writtenHash };
  mkdirSync(path.dirname(checker.candidate), { recursive: true }); writeFileSync(checker.candidate, checkerContent);
  if (manageReadme) writeFileSync(readme.candidate, buildHostReadme(Object.keys(lock.installs)));
  writeFileSync(lockPath, JSON.stringify({ version: '0.1.0', source: SOURCE, installs: lock.installs }, null, 2) + '\n');
  return { target, sha256: writtenHash };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [id, root, target, endpoint = ''] = process.argv.slice(2);
  if (!id || !root || !target) { console.error('Usage: node adapters/build-embed.mjs PROJECT REPOSITORY_ROOT RELATIVE_OUTPUT [HTTPS_ENDPOINT]'); process.exitCode = 2; }
  else console.log(JSON.stringify(install(id, root, target, endpoint), null, 2));
}