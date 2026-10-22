// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCHEMA_VERSION } from '../src/worker.mjs';

/** JSON with line/block comments; quoted strings (including escaped quotes) stay intact. */
export function parseJsonc(source) {
  return JSON.parse(source.replace(/("(?:\\[\s\S]|[^"\\])*")|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, string) => string ?? ' '));
}

const channels = {
  collection: 'COLLECT_PROJECTS', statistics: 'COLLECT_STAT_PROJECTS',
  product: 'COLLECT_PRODUCT_PROJECTS', voices: 'COLLECT_VOICE_PROJECTS',
};

/** Read only top-level production vars, never env.preview or process environment. */
export function productionExpected(config) {
  const vars = config?.vars;
  if (!['true', 'false'].includes(vars?.COLLECT_ENABLED)
    || Object.values(channels).some(key => typeof vars?.[key] !== 'string')) {
    throw new Error('Production collection vars are missing or invalid');
  }
  return {
    schema: SCHEMA_VERSION, enabled: vars.COLLECT_ENABLED === 'true',
    ...Object.fromEntries(Object.entries(channels).map(([channel, key]) =>
      [channel, vars[key].split(',').map(id => id.trim()).filter(Boolean)])),
  };
}

const sameSet = (actual, expected) => Array.isArray(actual)
  && actual.every(id => typeof id === 'string')
  && new Set(actual).size === new Set(expected).size
  && expected.every(id => actual.includes(id));

/** Pure validator. body is parsed JSON or JSON text; expected has schema, enabled and four id lists. */
export function checkReadyz(body, expected) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return ['/readyz body is not valid JSON']; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['/readyz body must be an object'];
  const problems = [];
  if (body.ready !== true) problems.push('ready must be true');
  if (body.schema !== expected.schema) problems.push(`schema must equal ${expected.schema}`);
  if (body.collection?.enabled !== expected.enabled) {
    problems.push(`collection.enabled must match COLLECT_ENABLED (${expected.enabled})`);
  }
  for (const [channel, key] of Object.entries(channels)) {
    if (!sameSet(body[channel]?.admitted, expected[channel])) {
      problems.push(`${channel}.admitted must match ${key} (expected: ${expected[channel].join(', ') || 'empty'})`);
    }
  }
  if (!Array.isArray(body.collection?.invalid) || body.collection.invalid.length !== 0) {
    problems.push('collection.invalid must be an empty array');
  }
  if (!Array.isArray(body.probes?.unconfigured) || body.probes.unconfigured.length !== 0) {
    problems.push('probes.unconfigured must be an empty array');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let problems;
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/check-readyz.mjs [file|-]');
    const expected = productionExpected(parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
    const input = process.argv[2];
    const body = readFileSync(!input || input === '-' ? 0 : input, 'utf8');
    problems = checkReadyz(body, expected);
  } catch {
    // Do not echo input, configuration, filesystem errors or parser excerpts into CI logs.
    problems = ['Could not read readiness input or production configuration; usage: node scripts/check-readyz.mjs [file|-]'];
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else console.log('/readyz matches production configuration');
}
