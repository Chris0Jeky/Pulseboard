import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectionAdmission } from '../src/admission.mjs';
import { openDatabase } from '../src/sqlite.mjs';
import { handle } from '../src/worker.mjs';

const BOUNDS_ERROR = 'configuration_exceeds_bounds';
const token = 'r'.repeat(64);

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}

test('collection admission fails oversized policies closed with bounded diagnostics', () => {
  for (const value of [
    Array.from({ length: 20_000 }, (_, index) => `missing-${index}`).join(','),
    'x'.repeat(10_000),
  ]) {
    const admission = collectionAdmission({ COLLECT_ENABLED: 'true', COLLECT_PROJECTS: value });
    assert.equal(admission.valid, false);
    assert.deepEqual(admission.configured, []);
    assert.deepEqual(admission.admitted, []);
    assert.deepEqual(admission.invalid, [BOUNDS_ERROR]);
    assert.ok(JSON.stringify(admission).length < 256);
  }
});

test('readiness and protected portfolio errors stay small for pathological allowlists', async t => {
  const DB = database(t);
  const COLLECT_PROJECTS = Array.from({ length: 20_000 }, (_, index) => `missing-${index}`).join(',');
  const env = { DB, READ_TOKEN: token, COLLECT_ENABLED: 'true', COLLECT_PROJECTS };

  const readiness = await handle(new Request('https://desk.test/readyz'), env);
  const readinessText = await readiness.text();
  assert.equal(readiness.status, 503);
  assert.ok(readinessText.length < 512);
  assert.deepEqual(JSON.parse(readinessText).collection.invalid, [BOUNDS_ERROR]);

  const portfolio = await handle(new Request('https://desk.test/v1/portfolio?days=7', {
    headers: { authorization: `Bearer ${token}` },
  }), env);
  const portfolioText = await portfolio.text();
  assert.equal(portfolio.status, 503);
  assert.ok(portfolioText.length < 256);
  assert.deepEqual(JSON.parse(portfolioText), {
    error: 'invalid_collection_configuration',
    invalid: [BOUNDS_ERROR],
  });
});
