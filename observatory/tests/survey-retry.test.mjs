import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/sqlite.mjs';
import { handle } from '../src/worker.mjs';
import { projects } from '../src/projects.mjs';
import { startLocalRunner } from '../src/local.mjs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-12T12:00:00Z'), DAY = 86400000;
const KEY = '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2';
const OTHER_KEY = '9c1d7e2a-4b3f-4a5e-8d6c-1f2e3d4c5b6a';
const rating = (extra = {}) => ({ v: 1, survey: 'puzzle-rating', subject: 'vault-binary-04', respondent: KEY,
  release: '0.15.0', answers: { difficulty: 'just-right', more: 'yes' }, meta: { family: 'binary', tier: 'tricky' },
  comment: '', context: { device: 'desktop' }, ...extra });
const taste = (extra = {}) => ({ ...rating(), survey: 'alibi-taste-1', subject: '', meta: {},
  answers: { often: 'weekly', more: ['sudoku', 'scene'], difficulty: 'mostly-right' }, ...extra });
const environment = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_VOICE_PROJECTS: 'alibi' });
function database(t) {
  const db = openDatabase(); db.exec(schema); t.after(() => db.close());
  t.mock.method(Date, 'now', () => NOW);
  return db;
}
function request(body, country = 'GB') {
  const r = new Request('https://collector.test/v1/survey/alibi', { method: 'PUT',
    headers: { Origin: projects.alibi.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  Object.defineProperty(r, 'cf', { value: { country } });
  return r;
}
const send = (db, body, country) => handle(request(body, country), environment(db));
const all = async (db, table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
const budget = async db => (await all(db, 'budget')).map(r => r.used);

for (const [name, payload] of [['survey', taste], ['rating', rating]]) {
  test(`unchanged ${name} retries neither charge nor refresh stored evidence`, async t => {
    const db = database(t), body = payload();
    assert.equal((await send(db, body)).status, 202);
    const rows = await all(db, 'voice_survey'), budgets = await all(db, 'budget');
    t.mock.method(Date, 'now', () => NOW + 60000);
    const repeated = await send(db, body, 'FR');
    assert.equal(repeated.status, 202);
    assert.deepEqual(await repeated.json(), { accepted: true, updated: false });
    assert.deepEqual(await all(db, 'voice_survey'), rows, 'receipt times, country and submissions are not refreshed');
    assert.deepEqual(await all(db, 'budget'), budgets, 'neither budget nor its receipt changes');
    assert.equal(repeated.headers.get('Access-Control-Allow-Origin'), projects.alibi.origin);
    assert.equal(repeated.headers.get('Cache-Control'), 'no-store');
  });
}

for (const [key, limit] of [['alibi:voice', 300], ['*:voice', 100]]) {
  test(`unchanged retry is acknowledged at a full ${key} budget but changed content is refused`, async t => {
    const db = database(t), body = rating();
    await send(db, body);
    await db.prepare('UPDATE budget SET used=? WHERE project=?').bind(limit, key).run();
    const before = await all(db, 'voice_survey'), budgets = await all(db, 'budget');
    assert.equal((await send(db, body)).status, 202);
    const changed = await send(db, rating({ answers: { difficulty: 'too-hard' } }));
    assert.equal(changed.status, 429); assert.equal(changed.headers.get('Retry-After'), '3600');
    assert.deepEqual(await all(db, 'voice_survey'), before);
    assert.deepEqual(await all(db, 'budget'), budgets);
  });
}

test('a retry preserves the last budget slot for a genuine changed answer', async t => {
  const db = database(t), day = new Date(NOW).toISOString().slice(0, 10);
  await db.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi:voice', day, 298, 'project-old').run();
  await db.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('*:voice', day, 98, 'global-old').run();
  const body = rating();
  assert.equal((await send(db, body)).status, 202);
  assert.equal((await send(db, body)).status, 202);
  assert.deepEqual(await budget(db), [299, 99]);
  const changed = await send(db, rating({ answers: { difficulty: 'too-hard' } }));
  assert.deepEqual(await changed.json(), { accepted: true, updated: true });
  assert.deepEqual(await budget(db), [300, 100]);
  const [row] = await all(db, 'voice_survey');
  assert.equal(row.submissions, 2); assert.equal(row.answers, '{"difficulty":"too-hard"}');
});

test('unchanged next-day retry neither starts another budget day nor extends retention', async t => {
  const db = database(t), body = rating();
  await send(db, body);
  const before = await all(db, 'voice_survey'), budgets = await all(db, 'budget');
  t.mock.method(Date, 'now', () => NOW + DAY);
  assert.equal((await send(db, body)).status, 202);
  assert.deepEqual(await all(db, 'voice_survey'), before);
  assert.deepEqual(await all(db, 'budget'), budgets);
});

test('JSON key order and registry-equivalent option order remain no-op retries', async t => {
  const db = database(t), body = taste();
  await send(db, body);
  const equivalent = { ...body, answers: { difficulty: 'mostly-right', more: ['scene', 'sudoku'], often: 'weekly', tiers: [] } };
  const reversed = Object.fromEntries(Object.entries(equivalent).reverse());
  assert.deepEqual(await (await send(db, reversed)).json(), { accepted: true, updated: false });
  assert.deepEqual(await budget(db), [1, 1]);
  assert.equal((await all(db, 'voice_survey'))[0].submissions, 1);
});

test('deduplication compares only normalized stored text and preserves redaction provenance', async t => {
  const db = database(t);
  await send(db, taste({ comment: 'Contact first@example.org' }));
  assert.deepEqual(await (await send(db, taste({ comment: '  Contact second@example.org  ' }))).json(), { accepted: true, updated: false });
  assert.deepEqual(await budget(db), [1, 1]);
  // Literal marker text has a different redaction count, despite identical stored text.
  assert.deepEqual(await (await send(db, taste({ comment: 'Contact [email]' }))).json(), { accepted: true, updated: true });
  const [row] = await all(db, 'voice_survey');
  assert.equal(row.comment, 'Contact [email]'); assert.equal(row.redacted, 0); assert.equal(row.submissions, 2);
  assert.deepEqual(await budget(db), [2, 2]);
});

for (const [name, change] of [
  ['answers', { answers: { difficulty: 'too-hard' } }], ['meta', { meta: { family: 'binary', tier: 'expert' } }],
  ['release', { release: '0.15.1' }], ['device', { context: { device: 'mobile' } }],
]) {
  test(`a genuine ${name} change still replaces the row and charges both budgets`, async t => {
    const db = database(t);
    await send(db, rating());
    assert.deepEqual(await (await send(db, rating(change))).json(), { accepted: true, updated: true });
    assert.equal((await all(db, 'voice_survey'))[0].submissions, 2);
    assert.deepEqual(await budget(db), [2, 2]);
  });
}

test('deduplication does not cross respondent, survey, subject or project keys', async t => {
  const db = database(t);
  await send(db, rating());
  // Foreign historical evidence must not certify a row absent for this project.
  await db.prepare("UPDATE voice_survey SET project='foreign'").run();
  for (const payload of [rating(), rating({ respondent: OTHER_KEY }), rating({ subject: 'castle-3' }), taste()]) {
    assert.deepEqual(await (await send(db, payload)).json(), { accepted: true, updated: false });
  }
  assert.equal((await all(db, 'voice_survey')).length, 5);
  assert.deepEqual(await budget(db), [5, 5]);
});

test('two independent connections atomically charge identical concurrent submissions once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'survey-retry-'));
  const a = openDatabase(join(dir, 'voices.sqlite')); a.exec(schema);
  const b = openDatabase(join(dir, 'voices.sqlite'));
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  t.mock.method(Date, 'now', () => NOW);
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const wrap = db => ({ prepare: db.prepare, async batch(statements) {
    if (++arrivals === 2) release();
    await barrier;
    return db.batch(statements);
  } });
  const responses = await Promise.all([send(wrap(a), rating()), send(wrap(b), rating())]);
  assert.deepEqual(responses.map(r => r.status), [202, 202]);
  assert.equal(arrivals, 2);
  assert.deepEqual(await budget(a), [1, 1]);
  assert.equal((await all(a, 'voice_survey'))[0].submissions, 1);
});

test('storage failure rolls back the genuine update and its reservation', async t => {
  const db = database(t);
  await send(db, rating());
  const before = await all(db, 'voice_survey'), budgets = await all(db, 'budget');
  db.exec("CREATE TRIGGER reject_survey_update BEFORE UPDATE ON voice_survey BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  assert.equal((await send(db, rating({ answers: { difficulty: 'too-hard' } }))).status, 503);
  assert.deepEqual(await all(db, 'voice_survey'), before);
  assert.deepEqual(await all(db, 'budget'), budgets);
  assert.equal((await send(db, rating())).status, 202, 'an unchanged retry needs no UPDATE');
});

test('duplicate recognition never bypasses origin, admission or the input contract', async t => {
  const db = database(t), body = rating();
  await send(db, body);
  const before = await all(db, 'budget');
  assert.equal((await handle(request(body), { ...environment(db), COLLECT_ENABLED: 'false' })).status, 503);
  const wrongOrigin = request(body); wrongOrigin.headers.set('Origin', 'https://wrong.test');
  assert.equal((await handle(wrongOrigin, environment(db))).status, 403);
  assert.equal((await send(db, { ...body, extra: true })).status, 400);
  assert.deepEqual(await all(db, 'budget'), before);
});

test('real local HTTP retries keep the v1 acknowledgement and one durable submission', async t => {
  const db = database(t), runner = await startLocalRunner({ port: 0, ...environment(db), READ_TOKEN: 'r'.repeat(40) });
  try {
    for (let retry = 0; retry < 3; retry++) {
      const response = await fetch(runner.origin + '/v1/survey/alibi', { method: 'PUT',
        headers: { Origin: projects.alibi.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(rating()) });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { accepted: true, updated: false });
    }
    assert.deepEqual(await budget(db), [1, 1]);
    assert.equal((await all(db, 'voice_survey'))[0].submissions, 1);
  } finally { await runner.close(); }
});
