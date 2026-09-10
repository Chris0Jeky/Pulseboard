import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { projects } from '../src/projects.mjs';
// Sources may be checked out with CRLF (core.autocrlf); the strip patterns below are anchored on bare newlines.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
/** The artifact is a plain script: no module statements survive, and no server-only constant is published. */
export function assertArtifactShape(content) {
  const leaked = content.split('\n').find(line => /^(?:import|export)\b/.test(line));
  if (leaked) throw new Error('Generated artifact still contains a module statement: ' + leaked.slice(0, 60));
  if (/MAX_BYTES|MAX_BATCH/.test(content)) throw new Error('Generated artifact still contains server-only constants');
  return content;
}
export function buildEmbed(id, options = {}) {
  if (!Object.hasOwn(projects, id)) throw new Error('Register the project in src/projects.mjs first');
  const project = projects[id];
  if (!project.origin) throw new Error('This project deliberately has no public collection origin');
  const config = { id, project, origin: project.origin, endpoint: '', scopePath: new URL(project.probe.url).pathname, release: 'unattributed', route: 'home', clicks: [], ...options };
  if (id === 'alibi') config.publicFlag = { global: 'ALIBI_CONFIG', key: 'standalone', expected: false };
  if (config.endpoint) {
    const u = new URL(config.endpoint);
    if (u.protocol !== 'https:' || u.pathname !== '/v1/collect/' + id || u.search || u.hash || u.username || u.password) throw new Error('Expected the exact HTTPS project collector endpoint');
  }
  // JSON escapes prevent accidental HTML script termination when embedding in an offline artifact.
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  const contract = read('../src/contracts.mjs').split('export function validateBatch')[0].replace(/^export const MAX_(?:BYTES|BATCH) =.*\n/gm, '').replace(/^export /gm, '');
  const browser = read('../src/browser.mjs').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const embed = read('./embed.mjs').replace(/^export /gm, '');
  return assertArtifactShape(`/* SPDX-License-Identifier: GPL-3.0-only\n * Pulseboard Observatory 0.1.0. Generated; see observatory.lock.json.\n * Disabled until endpoint is configured. No dynamic/CDN dependency. */\n(function () {\n'use strict';\n${contract}\n${browser}\n${embed}\nconst config = ${json};\nfunction start() { globalThis.PulseboardUsage?.dispose(); globalThis.PulseboardUsage = mountObserver(config, createObserver); }\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();\nglobalThis.addEventListener?.('pageshow', event => { if (event.persisted) start(); });\n})();\n`);
}
export function install(id, root, target, endpoint = '') {
  const base = realpathSync(root), full = path.resolve(base, target);
  if (path.isAbsolute(target) || !full.startsWith(base + path.sep) || target.split(/[\\/]/).includes('..')) throw new Error('Target must be a relative path inside the repository');
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
  const old = lockStat ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  if (targetStat && (!targetStat.isFile() || !old || old.target !== target || old.sha256 !== digest(readFileSync(full)))) throw new Error('Existing file has local edits or is unowned; refusing overwrite');
  // Nothing is written or checksummed until the artifact parses as a plain script and holds its published shape.
  const content = buildEmbed(id, { endpoint }); new vm.Script(content); assertArtifactShape(content);
  mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, content);
  writeFileSync(lockPath, JSON.stringify({ version: '0.1.0', project: id, target, sha256: digest(content), source: 'Chris0Jeky/Pulseboard:observatory' }, null, 2) + '\n');
  return { target, sha256: digest(content) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [id, root, target, endpoint = ''] = process.argv.slice(2);
  if (!id || !root || !target) { console.error('Usage: node adapters/build-embed.mjs PROJECT REPOSITORY_ROOT RELATIVE_OUTPUT [HTTPS_ENDPOINT]'); process.exitCode = 2; }
  else console.log(JSON.stringify(install(id, root, target, endpoint), null, 2));
}
