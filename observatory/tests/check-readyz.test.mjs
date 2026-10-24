// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReadyz, parseJsonc, productionExpected } from '../scripts/check-readyz.mjs';
import { handle, SCHEMA_VERSION } from '../src/worker.mjs';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const expected = productionExpected(config);
const hosts = ['alibi', 'portfolio', 'commitatlas', 'idleharbor', 'developer-lens', 'wealthlens', 'mdviewer'];
const productionBody = () => ({
  ready: true, schema: 6,
  collection: { enabled: true, configured: ['alibi'], admitted: ['alibi'], invalid: [] },
  statistics: { configured: true, admitted: [...hosts] },
  product: { configured: true, admitted: [...hosts] },
  voices: { configured: true, admitted: ['alibi'] },
  probes: { configured: [...hosts], unconfigured: [] },
});

// Exercise the real handler without storage or network access.
async function workerReadiness(vars) {
  const response = await handle(new Request('https://example.test/readyz'), {
    ...vars,
    DB: { prepare: () => ({ all: async () => ({ results: [] }), first: async () => ({ version: SCHEMA_VERSION }) }) },
    ALIBI: { fetch() {} },
    COMMITATLAS: { fetch() {} },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('disabled collection with retained lists matches Worker admission and configured fields', async () => {
  const vars = { ...config.vars, COLLECT_ENABLED: 'false' };
  const body = await workerReadiness(vars), off = productionExpected({ vars });
  assert.equal(body.ready, true);
  for (const channel of ['collection', 'statistics', 'product', 'voices']) assert.deepEqual(body[channel].admitted, []);
  assert.deepEqual(checkReadyz(body, off), []);
  for (const channel of ['collection', 'statistics', 'product', 'voices']) {
    const wrong = structuredClone(body);
    wrong[channel].configured = channel === 'collection' ? [] : false;
    assert.ok(checkReadyz(wrong, off).some(problem => problem.startsWith(`${channel}.configured`)));
  }
});

test('omitted optional channel vars match the healthy Worker response', async () => {
  for (const key of ['COLLECT_PROJECTS', 'COLLECT_STAT_PROJECTS', 'COLLECT_PRODUCT_PROJECTS', 'COLLECT_VOICE_PROJECTS']) {
    const vars = { ...config.vars }; delete vars[key];
    const body = await workerReadiness(vars);
    assert.deepEqual(checkReadyz(body, productionExpected({ vars })), []);
  }
});

test('missing or invalid COLLECT_ENABLED disables admission without making the Worker unready', async () => {
  for (const value of [undefined, '', 'invalid', 'TRUE', true]) {
    const vars = { ...config.vars, COLLECT_ENABLED: value };
    if (value === undefined) delete vars.COLLECT_ENABLED;
    const body = await workerReadiness(vars);
    assert.equal(body.collection.enabled, false);
    assert.deepEqual(checkReadyz(body, productionExpected({ vars })), []);
  }
  assert.deepEqual(checkReadyz(await workerReadiness({}), productionExpected({ env: config.env })), []);
});

test('channel parsing matches the Worker exact-list and voice-registry rules', async () => {
  for (const [key, value] of [
    ['COLLECT_STAT_PROJECTS', ' alibi'], ['COLLECT_PRODUCT_PROJECTS', 'alibi,alibi'],
    ['COLLECT_VOICE_PROJECTS', 'portfolio'], ['COLLECT_VOICE_PROJECTS', ''],
  ]) {
    const vars = { ...config.vars, [key]: value };
    assert.deepEqual(checkReadyz(await workerReadiness(vars), productionExpected({ vars })), []);
  }
});

test('JSONC trailing commas work outside strings, including comments and nested containers', () => {
  const source = String.raw`{
    "marker": ",}", "quoted": "escaped \" ,]", "url": "https://example.test/,}",
    "nested": [{"ids": ["alibi", /* before closing array */],},], // before closing object
  }`;
  assert.deepEqual(parseJsonc(source), {
    marker: ',}', quoted: 'escaped " ,]', url: 'https://example.test/,}', nested: [{ ids: ['alibi'] }],
  });
  for (const invalid of ['{"n":,}', '[,]', '[1,,]', '{"n":1,,}']) {
    assert.throws(() => parseJsonc(invalid), SyntaxError);
  }
});

test('current production readiness passes against production vars and the exported schema', () => {
  assert.equal(expected.schema, SCHEMA_VERSION);
  assert.deepEqual(checkReadyz(productionBody(), expected), []);
  assert.deepEqual(checkReadyz(JSON.stringify(productionBody()), expected), []);
  assert.deepEqual(expected.collection, ['alibi']);
  assert.notDeepEqual(expected.collection, config.env.preview.vars.COLLECT_PROJECTS.split(','));
});

test('admission lists are sets and unknown top-level fields are allowed without mutation', () => {
  const body = productionBody();
  body.statistics.admitted.reverse(); body.product.admitted.push('alibi');
  body.future = { field: true };
  const before = structuredClone(body), expectedBefore = structuredClone(expected);
  assert.deepEqual(checkReadyz(body, expected), []);
  assert.deepEqual(body, before); assert.deepEqual(expected, expectedBefore);
});

for (const [name, mutate, message] of [
  ['not ready', b => { b.ready = false; }, 'ready must be true'],
  ['string ready', b => { b.ready = 'true'; }, 'ready must be true'],
  ['wrong schema', b => { b.schema = 5; }, 'schema must equal 6'],
  ['string schema', b => { b.schema = '6'; }, 'schema must equal 6'],
  ['disabled collection', b => { b.collection.enabled = false; }, 'collection.enabled must match COLLECT_ENABLED (true)'],
  ['invalid collection', b => { b.collection.invalid = ['unknown']; }, 'collection.invalid must be an empty array'],
  ['missing probe binding', b => { b.probes.unconfigured = [{ project: 'alibi', reason: 'service_binding_unavailable' }]; }, 'probes.unconfigured must be an empty array'],
  ['missing probes', b => { delete b.probes; }, 'probes.unconfigured must be an empty array'],
]) test(`readiness rejects ${name}`, () => {
  const body = productionBody(); mutate(body);
  assert.deepEqual(checkReadyz(body, expected), [message]);
});

for (const [channel, key] of Object.entries({
  collection: 'COLLECT_PROJECTS', statistics: 'COLLECT_STAT_PROJECTS', product: 'COLLECT_PRODUCT_PROJECTS', voices: 'COLLECT_VOICE_PROJECTS',
})) for (const [name, change] of [
  ['empty', b => { b[channel].admitted = []; }],
  ['wrong', b => { b[channel].admitted[0] = 'unknown'; }],
  ['extra', b => { b[channel].admitted.push('unknown'); }],
  ['missing', b => { delete b[channel].admitted; }],
  ['non-array', b => { b[channel].admitted = 'alibi'; }],
]) test(`readiness rejects ${name} ${channel} admission`, () => {
  const body = productionBody(); change(body);
  assert.deepEqual(checkReadyz(body, expected), [
    `${channel}.admitted must match ${key} (expected: ${expected[channel].join(', ')})`,
  ]);
});

test('malformed JSON and non-object JSON return problems without throwing', () => {
  for (const body of ['', '{', '{"ready":true', 'not JSON']) {
    assert.deepEqual(checkReadyz(body, expected), ['/readyz body is not valid JSON']);
  }
  for (const body of ['null', '[]', 'true', '6', null, undefined]) {
    assert.deepEqual(checkReadyz(body, expected), ['/readyz body must be an object']);
  }
  assert.ok(checkReadyz({}, expected).length > 1, 'all missing fields are reported');
});

test('empty-list guards reject missing, null and string values', () => {
  for (const channel of ['collection', 'probes']) for (const value of [undefined, null, '']) {
    const field = channel === 'collection' ? 'invalid' : 'unconfigured';
    const body = productionBody(); body[channel][field] = value;
    assert.deepEqual(checkReadyz(body, expected), [`${channel}.${field} must be an empty array`]);
  }
});

test('JSONC comments preserve URLs, escaped quotes, backslashes and comment-like strings', () => {
  const source = String.raw`{
    // production URL, not a comment inside the value
    "url": "https://example.test/a//b", /* block comment */
    "quoted": "escaped \" // still a string", "path": "C:\\temp", "marker": "/* literal */"
  }`;
  assert.deepEqual(parseJsonc(source), {
    url: 'https://example.test/a//b', quoted: 'escaped " // still a string', path: 'C:\\temp', marker: '/* literal */',
  });
  assert.throws(() => parseJsonc('{"n":1/* comment */2}'), SyntaxError);
  assert.throws(() => parseJsonc('{/* unterminated'), SyntaxError);
});

test('expected configuration uses only production, trims lists and supports collection off', () => {
  const vars = { COLLECT_ENABLED: 'false', COLLECT_PROJECTS: '', COLLECT_STAT_PROJECTS: '', COLLECT_PRODUCT_PROJECTS: '', COLLECT_VOICE_PROJECTS: '' };
  const off = productionExpected({ vars, env: config.env });
  const body = productionBody(); body.collection.enabled = false;
  for (const channel of ['collection', 'statistics', 'product', 'voices']) {
    body[channel].admitted = [];
    body[channel].configured = channel === 'collection' ? [] : false;
  }
  assert.deepEqual(checkReadyz(body, off), []);
  assert.deepEqual(productionExpected({ vars: { ...vars, COLLECT_PROJECTS: ' alibi, mdviewer ' } }).configured.collection, ['alibi', 'mdviewer']);
  assert.equal(productionExpected({ env: config.env }).enabled, false);
});

test('CLI accepts stdin and rejects malformed JSON without a stack trace', () => {
  const script = fileURLToPath(new URL('../scripts/check-readyz.mjs', import.meta.url));
  const run = input => spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  const good = run(JSON.stringify(productionBody()));
  assert.equal(good.status, 0, good.stderr);
  const bad = run('{');
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr.trim(), '/readyz body is not valid JSON');
});
