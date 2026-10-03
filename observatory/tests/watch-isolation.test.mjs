// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import entry from '../src/entry.mjs';
import { projects } from '../src/projects.mjs';
import { handleWatch } from '../watch/api.mjs';
import { watchBanner } from '../src/local.mjs';

const DAY = 86400000, NOW = Date.UTC(2026, 9, 1, 12);
function setup(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  t.mock.method(Date, 'now', () => NOW);
  const errors = [];
  t.mock.method(console, 'error', message => errors.push(message));
  return { DB, errors };
}
async function runSchedule(DB, extra = {}) {
  const targets = Object.values(projects).filter(p => p.probe), seen = [];
  await DB.prepare('INSERT OR REPLACE INTO probe_history VALUES(?,?,?,?)').bind('mdviewer', NOW - 31 * DAY, 1, 5).run();
  await entry.scheduled(null, { DB, WATCH_ENABLED: 'false', ...extra }, null, async url => {
    const target = targets.find(p => p.probe.url === url);
    assert.ok(target, 'no unregistered probe target');
    seen.push(url);
    return new Response(target.probe.marker);
  });
  assert.deepEqual(seen, targets.map(p => p.probe.url));
  const history = (await DB.prepare('SELECT * FROM probe_history').all()).results;
  assert.equal(history.length, targets.length, 'real core retention removed the old history row');
  assert.ok(history.every(row => row.checked === NOW && row.ok === 1));
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM probes').first()).n, targets.length);
}

test('real entry scheduling is quiet without optional Watch tables and still probes and expires core history', async t => {
  const { DB, errors } = setup(t);
  await runSchedule(DB);
  assert.deepEqual(errors, []);
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'watch_%'").first()).n, 0, 'absence is not an invitation to install Watch');
});

test('partial Watch installation is reported, but never prevents real core scheduling', async t => {
  const { DB, errors } = setup(t);
  DB.exec('CREATE TABLE watch_schema (id INTEGER PRIMARY KEY, version INTEGER)');
  await runSchedule(DB);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Watch retention unavailable/);
  assert.doesNotMatch(errors[0], /no such table|SELECT|DELETE/);
});

test('explicitly enabled Watch without tables remains an actionable warning', async t => {
  const { DB, errors } = setup(t);
  await runSchedule(DB, { WATCH_ENABLED: 'true' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Watch retention unavailable/);
});

test('disabled Watch with installed tables expires receipts, budget and sensors without removing recent data', async t => {
  const { DB, errors } = setup(t);
  DB.exec(readFileSync(new URL('../watch/schema.sql', import.meta.url), 'utf8'));
  for (const [source, when] of [['old', NOW - 8 * DAY], ['recent', NOW - DAY]]) {
    await DB.prepare('INSERT INTO watch_events VALUES(?,?,?,?,?,?,?)').bind(source, crypto.randomUUID(), when, when, 'check.ok', 'home', '{}').run();
    await DB.prepare('INSERT INTO watch_budget VALUES(?,?,?,?)').bind(source, new Date(when).toISOString().slice(0, 10), 1, 'receipt').run();
    await DB.prepare('INSERT INTO watch_sensors VALUES(?,?,?,?,?)').bind(source, when, when, 'full', 0).run();
  }
  await runSchedule(DB);
  for (const table of ['watch_events', 'watch_budget', 'watch_sensors']) {
    assert.deepEqual((await DB.prepare(`SELECT source FROM ${table}`).all()).results.map(r => r.source), ['recent']);
  }
  assert.deepEqual(errors, []);
});

test('unknown and known source failures both hash before refusal without touching storage', async t => {
  const producer = 'p'.repeat(40);
  const source = { id: 'known', project: 'alibi', environment: 'preview', kind: 'app', token: producer,
    assets: ['home'], allowedKinds: ['check.ok'], heartbeatSeconds: 60, dailyLimit: 100, enabled: true };
  let reads = 0;
  const env = { WATCH_ENABLED: 'true', WATCH_SOURCES_JSON: JSON.stringify([source]),
    DB: { prepare() { reads++; throw new Error('unauthenticated read'); } } };
  const digest = crypto.subtle.digest.bind(crypto.subtle), inputs = [];
  t.mock.method(crypto.subtle, 'digest', (algorithm, data) => { inputs.push(new TextDecoder().decode(data)); return digest(algorithm, data); });
  const request = (id, token) => new Request(`https://watch.test/v1/watch/events/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}',
  });
  for (const id of ['known', 'unregistered']) {
    inputs.length = 0;
    const response = await handleWatch(request(id, 'wrong'), env, NOW);
    assert.equal(response.status, 401);
    assert.equal(inputs.length, 2, `${id} must use the same bounded digest path`);
  }
  // The comparison fallback is not an authentication credential: even its exact value cannot admit a missing source.
  const fallback = inputs.find(input => input !== 'Bearer wrong').slice('Bearer '.length);
  assert.equal((await handleWatch(request('unregistered', fallback), env, NOW)).status, 401);
  assert.equal(reads, 0);
});

test('short supplied Watch read token gets a warning without printing its value', () => {
  const token = 'sensitive-short-value';
  const output = watchBanner({ token, supplied: true, enabled: false }).join('\n');
  assert.match(output, /WATCH_READ_TOKEN is shorter than 32 characters/);
  assert.match(output, /401/);
  assert.ok(!output.includes(token));
});

test('valid supplied Watch read token stays secret and is not warned about', () => {
  const token = 'v'.repeat(40);
  const output = watchBanner({ token, supplied: true, enabled: false }).join('\n');
  assert.doesNotMatch(output, /shorter|401/);
  assert.ok(!output.includes(token));
});
