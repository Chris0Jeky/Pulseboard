import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { projects } from '../src/projects.mjs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
export function buildEmbed(id, options = {}) {
  if (!Object.hasOwn(projects, id)) throw new Error('Register the project in src/projects.mjs first');
  const project = projects[id];
  if (!project.origin) throw new Error('This project deliberately has no public collection origin');
  const config = { id, project, origin: project.origin, endpoint: '', scopePath: new URL(project.probe.url).pathname, release: 'unattributed', route: 'home', clicks: [], ...options };
  // JSON escapes prevent accidental HTML script termination when embedding in an offline artifact.
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  const contract = read('../src/contracts.mjs').replace(/^export /gm, '');
  const browser = read('../src/browser.mjs').replace(/^import .*;\n/, '').replace(/^export /gm, '');
  const embed = read('./embed.mjs').replace(/^export /gm, '');
  return `/* SPDX-License-Identifier: GPL-3.0-only\n * Pulseboard Observatory 0.1.0. Generated; see observatory.lock.json.\n * Disabled until endpoint is configured. No dynamic/CDN dependency. */\n(function () {\n'use strict';\n${contract}\n${browser}\n${embed}\nconst config = ${json};\nfunction start() { globalThis.PulseboardUsage = mountObserver(config, createObserver); }\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();\n})();\n`;
}
export function install(id, root, target, endpoint = '') {
  const base = realpathSync(root), full = path.resolve(base, target);
  if (path.isAbsolute(target) || !full.startsWith(base + path.sep) || target.split(/[\\/]/).includes('..')) throw new Error('Target must be a relative path inside the repository');
  // Do not follow symlink parents into another tree.
  let parent = path.dirname(full);
  while (!existsSync(parent)) parent = path.dirname(parent);
  if (realpathSync(parent) !== base && !realpathSync(parent).startsWith(base + path.sep)) throw new Error('Symlink leaves repository');
  if (existsSync(full) && realpathSync(full) !== full) throw new Error('Refusing a symlink target');
  const lockPath = path.join(base, 'observatory.lock.json');
  const old = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  if (existsSync(full) && (!old || old.target !== target || old.sha256 !== digest(readFileSync(full)))) throw new Error('Existing file has local edits or is unowned; refusing overwrite');
  const content = buildEmbed(id, { endpoint });
  mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, content);
  writeFileSync(lockPath, JSON.stringify({ version: '0.1.0', project: id, target, sha256: digest(content), source: 'Chris0Jeky/Pulseboard:observatory' }, null, 2) + '\n');
  return { target, sha256: digest(content) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [id, root, target, endpoint = ''] = process.argv.slice(2);
  if (!id || !root || !target) { console.error('Usage: node adapters/build-embed.mjs PROJECT REPOSITORY_ROOT RELATIVE_OUTPUT [HTTPS_ENDPOINT]'); process.exitCode = 2; }
  else console.log(JSON.stringify(install(id, root, target, endpoint), null, 2));
}
