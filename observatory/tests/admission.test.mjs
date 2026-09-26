import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { makeDemo } from '../public/desk-demo.mjs';
import { buildSignals, makeBrief } from '../public/desk-model.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';

const now = Date.UTC(2026, 8, 17, 12);
const token = 'r'.repeat(64);
const authenticated = path => new Request('https://desk.test' + path, { headers: { authorization: `Bearer ${token}` } });
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}

test('collection configuration is exact, registry-aware and fail-closed', async () => {
  const { collectionAdmission } = await import('../src/admission.mjs');
  const valid = collectionAdmission({ COLLECT_ENABLED: 'true', COLLECT_PROJECTS: ' alibi, mdviewer, alibi ' });
  assert.deepEqual(valid, { enabled: true, valid: true, configured: ['alibi', 'mdviewer'], admitted: ['alibi', 'mdviewer'], invalid: [] });
  const disabled = collectionAdmission({ COLLECT_ENABLED: 'false', COLLECT_PROJECTS: 'alibi' });
  assert.equal(disabled.valid, true); assert.deepEqual(disabled.admitted, []);
  // Case and separator mistakes are configuration errors, never aliases for registered ids.
  for (const value of ['Alibi', 'mdviewer;commitatlas', 'taskdeck', 'alibi,missing']) {
    const result = collectionAdmission({ COLLECT_ENABLED: 'true', COLLECT_PROJECTS: value });
    assert.equal(result.valid, false, value); assert.deepEqual(result.admitted, [], value); assert.ok(result.invalid.length > 0, value);
  }
});

test('every committed wrangler collection allowlist resolves to eligible registered projects', async () => {
  const { collectionAdmission } = await import('../src/admission.mjs');
  const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const lists = [...source.matchAll(/"COLLECT_PROJECTS"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
  assert.equal(lists.length, 2);
  for (const value of lists) {
    const result = collectionAdmission({ COLLECT_ENABLED: 'true', COLLECT_PROJECTS: value });
    assert.equal(result.valid, true, value); assert.deepEqual(result.invalid, [], value);
  }
});

test('every committed product allowlist admits exactly the ids it lists, and production admits the shipped SDK v3 hosts', async () => {
  const { productAdmission } = await import('../src/admission.mjs');
  const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const lists = [...source.matchAll(/"COLLECT_PRODUCT_PROJECTS"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
  assert.equal(lists.length, 2);
  for (const value of lists.filter(Boolean)) assert.deepEqual(productAdmission({ COLLECT_PRODUCT_PROJECTS: value }), value.split(','), value);
  assert.deepEqual(lists, ['portfolio,alibi,commitatlas,idleharbor', ''], 'production admits the shipped SDK v3 hosts (q-13, q-20, q-21); preview admits none');
});

test('every committed statistics allowlist parses exactly, so a typo can never silently admit nothing', async () => {
  const { statAdmission } = await import('../src/stat-contract.mjs');
  const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const lists = [...source.matchAll(/"COLLECT_STAT_PROJECTS"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
  assert.equal(lists.length, 2);
  for (const value of lists) assert.deepEqual(statAdmission({ COLLECT_STAT_PROJECTS: value }), value.split(','), value);
  assert.deepEqual(lists, ['alibi,portfolio,commitatlas,idleharbor', 'alibi'], 'production counts the shipped hosts; preview counts Alibi');
});

test('readiness exposes admission and rejects an invalid allowlist', async t => {
  const DB = database(t);
  const good = await handle(new Request('https://desk.test/readyz'), { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi' });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { ready: true, schema: 4,
    collection: { enabled: true, configured: ['alibi'], admitted: ['alibi'], invalid: [] },
    statistics: { configured: false, admitted: [] }, product: { configured: false, admitted: [] } });
  const counted = await handle(new Request('https://desk.test/readyz'), { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi, mdviewer' });
  assert.deepEqual((await counted.json()).statistics, { configured: true, admitted: [] }, 'a malformed statistics list is visible as configured but admitting nothing');
  const bad = await handle(new Request('https://desk.test/readyz'), { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi,Alibi' });
  assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { ready: false, schema: 4,
    collection: { enabled: true, configured: ['alibi', 'Alibi'], admitted: [], invalid: ['Alibi'] },
    statistics: { configured: false, admitted: [] }, product: { configured: false, admitted: [] } });
});

test('portfolio v2 distinguishes eligible, admitted and local-only projects', async t => {
  const DB = database(t);
  const registry = {
    web: { label: 'Web', origin: 'https://web.test', probe: null, dailyLimit: 100 },
    local: { label: 'Local', origin: null, probe: null, dailyLimit: 100 },
  };
  const admitted = await readPortfolio(DB, { now, projects: registry, collectionEnabled: true, admittedProjects: ['web'] });
  assert.equal(admitted.schema, 'pulseboard.portfolio/2');
  assert.deepEqual(admitted.projects.map(p => [p.id, p.collectionEligible, p.collectionAdmitted]),
    [['web', true, true], ['local', false, false]]);
  assert.equal(assertPortfolio(admitted), admitted);
  const impossible = structuredClone(admitted); impossible.collectionEnabled = false;
  assert.throws(() => assertPortfolio(impossible), /admission/i);

  const excluded = await readPortfolio(DB, { now, projects: registry, collectionEnabled: true, admittedProjects: [] });
  const signal = buildSignals(excluded, now).find(item => item.rule === 'collection.not_admitted');
  assert.equal(signal.project, 'web'); assert.match(signal.detail, /zero event count/i);
  assert.match(makeBrief(excluded, [signal]), /Browser admission: 0\/1 eligible projects/);

  const retained = structuredClone(excluded);
  retained.projects.find(project => project.id === 'web').totals.events = 7;
  const retainedSignal = buildSignals(retained, now).find(item => item.rule === 'collection.not_admitted');
  assert.doesNotMatch(retainedSignal.detail, /zero event count/i);
  assert.match(retainedSignal.detail, /7 retained events/i);
  assert.doesNotMatch(makeBrief(retained, [retainedSignal]), /zero event count/i);
});

test('summary and portfolio endpoints share per-project admission truth', async t => {
  const DB = database(t);
  const env = { DB, READ_TOKEN: token, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi' };
  const summaryResponse = await handle(authenticated('/v1/summary'), env);
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.equal(summary.collectionEnabled, true); assert.equal(summary.collectionConfigurationValid, true);
  assert.equal(summary.projects.find(p => p.id === 'alibi').collectionAdmitted, true);
  assert.equal(summary.projects.find(p => p.id === 'mdviewer').collectionAdmitted, false);
  assert.equal(summary.projects.find(p => p.id === 'taskdeck').collectionEligible, false);

  const portfolioResponse = await handle(authenticated('/v1/portfolio?days=7'), env);
  assert.equal(portfolioResponse.status, 200);
  const portfolio = await portfolioResponse.json();
  assert.equal(portfolio.schema, 'pulseboard.portfolio/2');
  assert.equal(portfolio.projects.find(p => p.id === 'alibi').collectionAdmitted, true);
  assert.equal(portfolio.projects.find(p => p.id === 'mdviewer').collectionAdmitted, false);
  assert.equal(portfolio.projects.find(p => p.id === 'taskdeck').collectionEligible, false);
});
