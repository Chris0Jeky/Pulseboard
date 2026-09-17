import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { handle } from '../src/worker.mjs';

const token = 'r'.repeat(64);

test('portfolio read refuses an invalid collection allowlist', async t => {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  const response = await handle(new Request('https://desk.test/v1/portfolio?days=7', {
    headers: { authorization: `Bearer ${token}` },
  }), {
    DB,
    READ_TOKEN: token,
    COLLECT_ENABLED: 'true',
    COLLECT_PROJECTS: 'alibi,Alibi',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'invalid_collection_configuration',
    invalid: ['Alibi'],
  });
});
