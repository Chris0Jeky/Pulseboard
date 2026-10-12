import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle, probeAll } from '../src/worker.mjs';

const now = Date.parse('2026-10-12T00:00:00Z');
const bound = Object.entries(projects).filter(([, p]) => p.probe?.binding);
const direct = Object.entries(projects).filter(([, p]) => p.probe && !p.probe.binding);
function database(t) {
  const db = openDatabase(); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close()); return db;
}
const row = (db, id) => db.prepare('SELECT * FROM probes WHERE project=?').bind(id).first();
const healthy = async url => new Response(Object.values(projects).find(p => p.probe?.url === url).probe.marker);

for (const [label, binding] of [['missing', undefined], ['null', null], ['empty', {}], ['non-callable', { fetch: true }]]) {
  test(`${label} bindings do not fabricate outages or call the public transport`, async t => {
    const DB = database(t), calls = [];
    const env = { DB, ...Object.fromEntries(bound.map(([, p]) => [p.probe.binding, binding])) };
    for (let tick = 0; tick < 3; tick++) await probeAll(env, async url => { calls.push(url); return healthy(url); }, now + tick * 900000);
    for (const [id, p] of bound) {
      assert.equal(await row(DB, id), null, 'no target measurement took place');
      assert.equal((await DB.prepare('SELECT COUNT(*) n FROM probe_history WHERE project=?').bind(id).first()).n, 0);
      assert.ok(!calls.includes(p.probe.url), 'a required service binding cannot fall back to public transport');
    }
    assert.equal(calls.length, direct.length * 3);
    for (const [id] of direct) assert.equal((await row(DB, id)).state, 'up');
  });
}

test('readiness reports bounded unconfigured diagnostics separately from collector readiness', async t => {
  const DB = database(t);
  const response = await handle(new Request('https://desk.test/readyz'), { DB });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.deepEqual(body.probes, { configured: direct.map(([id]) => id),
    unconfigured: bound.map(([project]) => ({ project, reason: 'service_binding_unavailable' })) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('binding loss preserves prior evidence; restored bindings measure the target again', async t => {
  const DB = database(t), calls = [];
  const bindings = Object.fromEntries(bound.map(([id, p]) => [p.probe.binding, {
    id, async fetch(url) { assert.equal(this.id, id); calls.push(url); return healthy(url); },
  }]));
  for (let tick = 0; tick < 2; tick++) await probeAll({ DB, ...bindings }, healthy, now + tick * 900000);
  const before = await row(DB, bound[0][0]);
  await probeAll({ DB }, healthy, now + 2 * 900000);
  assert.deepEqual(await row(DB, bound[0][0]), before, 'configuration failure does not rewrite freshness or streaks');
  await probeAll({ DB, ...bindings }, healthy, now + 3 * 900000);
  assert.equal((await row(DB, bound[0][0])).checked, now + 3 * 900000);
  assert.equal(calls.length, bound.length * 3);
  const body = await (await handle(new Request('https://desk.test/readyz'), { DB, ...bindings })).json();
  assert.equal(body.probes.unconfigured.length, 0);
  assert.equal(body.probes.configured.length, direct.length + bound.length);
});

for (const failure of ['http', 'throw']) {
  test(`real bound ${failure} failures still create down observations`, async t => {
    const DB = database(t), bindings = Object.fromEntries(bound.map(([, p]) => [p.probe.binding, {
      async fetch() { if (failure === 'throw') throw new Error('synthetic transport failure'); return new Response('failure', { status: 503 }); },
    }]));
    for (let tick = 0; tick < 3; tick++) await probeAll({ DB, ...bindings }, healthy, now + tick * 900000);
    for (const [id] of bound) {
      const stored = await row(DB, id);
      assert.equal(stored.state, 'down'); assert.equal(stored.failures, 3);
      assert.equal(stored.status, failure === 'http' ? 503 : 0);
      assert.equal((await DB.prepare('SELECT COUNT(*) n FROM probe_history WHERE project=? AND ok=0').bind(id).first()).n, 3);
    }
  });
}
