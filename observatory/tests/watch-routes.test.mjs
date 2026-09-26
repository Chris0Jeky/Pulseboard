// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle as legacy } from '../src/worker.mjs';
import { handle as wrapped } from '../src/watch-worker.mjs';
import entry from '../src/entry.mjs';

const ORIGIN = projects.alibi.origin, TOKEN = 't'.repeat(32);
const SESSION = '3b241101-e2bb-4255-8caf-4136c566a962';

function database(t, withWatchSchema) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  if (withWatchSchema) DB.exec(readFileSync(new URL('../watch/schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = DB => ({ DB, READ_TOKEN: TOKEN, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi',
  COLLECT_PRODUCT_PROJECTS: 'alibi', WATCH_ENABLED: 'false', WATCH_READ_TOKEN: 'w'.repeat(40), WATCH_SOURCES_JSON: '[]' });

// Every request is rebuilt per handler because a body can be read once.
const requests = [
  () => new Request('https://desk.test/readyz'),
  () => new Request('https://desk.test/healthz'),
  () => new Request('https://collector.test/v1/collect-stat/alibi', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, counts: [{ event: 'page.view', route: 'home', release: '0.13.0', n: 1 }] }) }),
  () => new Request('https://desk.test/v1/statistics/alibi', { headers: { authorization: 'Bearer ' + TOKEN } }),
  () => new Request('https://desk.test/v1/statistics/alibi'),
  () => new Request('https://collector.test/v1/product/alibi', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, session: SESSION, release: '0.13.0', context: { device: 'desktop' },
      events: [{ name: 'puzzle.completed', route: 'puzzle', seq: 1, ms: 1000, props: { hints: 1 } }] }) }),
  () => new Request('https://desk.test/v1/product/alibi?days=1', { headers: { authorization: 'Bearer ' + TOKEN } }),
  () => new Request('https://collector.test/v1/consent/alibi', { headers: { Origin: ORIGIN } }),
  () => new Request('https://collector.test/v1/consent/alibi', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } }),
  () => new Request('https://desk.test/v1/summary', { headers: { authorization: 'Bearer ' + TOKEN } }),
  () => new Request('https://desk.test/v1/unknown-route'),
];
// Response bodies can carry wall-clock stamps; compare everything else exactly.
const stable = text => text.replace(/\b1\d{12}\b/g, 'MS')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, 'T');
async function observe(response) {
  const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== 'date'));
  return { status: response.status, headers, body: stable(await response.text()) };
}

test('the Watch wrapper routes every Desk route exactly as the legacy worker does', async t => {
  const legacyEnv = env(database(t, false)), wrappedEnv = env(database(t, true));
  const statuses = [];
  for (const make of requests) {
    const path = new URL(make().url).pathname + ' ' + make().method;
    const expected = await observe(await legacy(make(), legacyEnv));
    assert.deepEqual(await observe(await wrapped(make(), wrappedEnv)), expected, path + ' through watch-worker');
    statuses.push(expected.status);
  }
  // Guard against a vacuous match: the writes were admitted and the authenticated reads succeeded.
  assert.deepEqual(statuses.slice(0, 8), [200, 200, 202, 200, 401, 202, 200, 200]);
  const ready = await (await wrapped(new Request('https://desk.test/readyz'), wrappedEnv)).json();
  assert.equal(ready.schema, 4);
});

test('the deployed entry is the Watch wrapper and keeps the scheduled handler', async t => {
  assert.equal(typeof entry.fetch, 'function');
  assert.equal(typeof entry.scheduled, 'function');
  const wrappedEnv = env(database(t, true));
  const response = await entry.fetch(new Request('https://desk.test/readyz'), wrappedEnv, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schema, 4);
  assert.equal((await entry.fetch(new Request('https://desk.test/v1/watch/readyz'), wrappedEnv, {})).status, 401);
});
