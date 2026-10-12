// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/sqlite.mjs';
import { handleWatch } from '../watch/api.mjs';
import { ingest } from '../watch/store.mjs';
const now = Date.parse('2026-10-12T00:00:00Z');
const schema = readFileSync(new URL('../watch/schema.sql', import.meta.url), 'utf8');
const source = { id: 'test-app', project: 'alibi', environment: 'preview', kind: 'app', token: 's'.repeat(40),
  assets: ['puzzle'], allowedKinds: ['http.request'], heartbeatSeconds: 60, dailyLimit: 100, enabled: true };
const event = () => ({ id: crypto.randomUUID(), at: now - 1000, kind: 'http.request', asset: 'puzzle', method: 'GET', status: 200 });
const heartbeat = () => ({ id: crypto.randomUUID(), at: now - 1000, kind: 'sensor.heartbeat', sampling: 'full', dropped: 0 });
function database(t) { const db = openDatabase(); db.exec(schema); t.after(() => db.close()); return db; }
function post(db, events, s = source) {
  return handleWatch(new Request(`https://watch.test/v1/watch/events/${s.id}`, { method: 'POST',
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'pulseboard.security-events/1', events }) }),
  { DB: db, WATCH_ENABLED: 'true', WATCH_SOURCES_JSON: JSON.stringify([s]) }, now);
}

test('changed event identity returns 409, charges attempts, and admits no part of the batch', async t => {
  const db = database(t), original = event();
  assert.equal((await post(db, [original])).status, 202);
  const response = await post(db, [event(), heartbeat(), { ...original, status: 500 }]);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'identity_conflict');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM watch_events').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM watch_sensors').first()).n, 0);
  assert.equal((await db.prepare('SELECT used FROM watch_budget').first()).used, 4);
  assert.equal(JSON.parse((await db.prepare('SELECT data FROM watch_events').first()).data).status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('exact and key-reordered replays remain idempotent, including historical unsorted data', async t => {
  const db = database(t), original = event();
  await post(db, [original]);
  // Simulate a prior writer retaining a different JSON property order.
  const reversed = Object.fromEntries(Object.entries(original).reverse());
  await db.prepare('UPDATE watch_events SET data=?').bind(JSON.stringify(reversed)).run();
  for (const repeated of [original, reversed]) {
    const response = await post(db, [repeated]); assert.equal(response.status, 202);
    assert.equal((await response.json()).inserted, 0);
  }
  assert.equal((await db.prepare('SELECT used FROM watch_budget').first()).used, 3);
});

test('two connections cannot successfully acknowledge contradictory concurrent submissions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-race-'));
  const a = openDatabase(join(dir, 'watch.sqlite')); a.exec(schema);
  const b = openDatabase(join(dir, 'watch.sqlite'));
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const wrap = db => ({ prepare: db.prepare, async batch(statements) {
    if (++arrivals === 2) release(); await barrier; return db.batch(statements);
  } });
  const original = event();
  const responses = await Promise.all([post(wrap(a), [event(), original]), post(wrap(b), [event(), { ...original, status: 500 }])]);
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 409]);
  assert.equal((await a.prepare('SELECT COUNT(*) n FROM watch_events').first()).n, 2);
  assert.equal((await a.prepare('SELECT used FROM watch_budget').first()).used, 4);
});

test('conflicting heartbeats cannot refresh sensor state; exact retries still consume budget', async t => {
  const db = database(t), beat = heartbeat();
  await post(db, [beat]);
  assert.equal((await post(db, [{ ...beat, at: now }])).status, 409);
  assert.equal((await post(db, [beat])).status, 202);
  const sensor = await db.prepare('SELECT observed,received FROM watch_sensors').first();
  assert.equal(sensor.observed, beat.at); assert.equal(sensor.received, now);
  assert.equal((await db.prepare('SELECT used FROM watch_budget').first()).used, 3);
});

test('exhausted budget takes precedence and source identities stay independent', async t => {
  const db = database(t), original = event(), limited = { ...source, dailyLimit: 1 };
  await post(db, [original], limited);
  assert.equal((await post(db, [{ ...original, status: 500 }], limited)).status, 429);
  assert.equal((await db.prepare('SELECT used FROM watch_budget').first()).used, 1);
  assert.equal((await ingest(db, { ...source, id: 'other-app' }, [{ ...original, status: 500 }], now)).inserted, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM watch_events').first()).n, 2);
});

test('adding or removing optional evidence is a conflict, not a replay', async t => {
  const db = database(t), original = event(), timed = { ...event(), durationMs: 0 };
  await post(db, [original, timed]);
  assert.equal((await post(db, [{ ...original, durationMs: 0 }])).status, 409);
  const { durationMs, ...withoutDuration } = timed;
  assert.equal((await post(db, [withoutDuration])).status, 409);
  const response = await post(db, [event()]);
  assert.equal(response.status, 202, 'a refused reservation must not poison later admissions');
  assert.equal((await response.json()).inserted, 1);
  assert.equal((await db.prepare('SELECT used FROM watch_budget').first()).used, 5);
});

test('storage errors roll back both evidence and attempt reservation', async t => {
  const db = database(t);
  db.exec(`CREATE TRIGGER fail_watch_insert BEFORE INSERT ON watch_events
    WHEN NEW.kind='sensor.heartbeat' BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END`);
  const response = await post(db, [event(), heartbeat()]);
  assert.equal(response.status, 503);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM watch_events').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM watch_budget').first()).n, 0);
});
