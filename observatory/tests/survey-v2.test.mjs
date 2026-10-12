import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/sqlite.mjs';
import { handle as production, maintain } from '../src/worker.mjs';
import { startLocalRunner } from '../src/local.mjs';
import { readVoices } from '../src/voices.mjs';
import { projects } from '../src/projects.mjs';
import { createSurveyV2Experiment, parseSurveyV2 } from '../experiments/survey-v2/index.mjs';

const CORE = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const EXTRA = readFileSync(new URL('../experiments/survey-v2/schema.sql', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-12T12:00:00Z'), DAY = 86400000;
const KEY = '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2';
const OTHER = '9c1d7e2a-4b3f-4a5e-8d6c-1f2e3d4c5b6a';
const env = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_VOICE_PROJECTS: 'alibi' });
const v1 = (extra = {}) => ({ v: 1, survey: 'puzzle-rating', subject: 'vault-binary-04', respondent: KEY,
  release: '0.15.0', answers: { difficulty: 'just-right', more: 'yes' }, meta: { family: 'binary', tier: 'tricky' },
  comment: '', context: { device: 'desktop' }, ...extra });
const v2 = (revision = 1, extra = {}) => ({ ...v1(), v: 2, revision, ...extra });
const taste = (revision = 1, extra = {}) => v2(revision, { survey: 'alibi-taste-1', subject: '', meta: {},
  answers: { often: 'weekly', more: ['sudoku', 'scene'], difficulty: 'mostly-right' }, ...extra });
const experiment = createSurveyV2Experiment({ acceptV2: true });
function database(t, extra = true) {
  const db = openDatabase(); db.exec(CORE); if (extra) db.exec(EXTRA);
  t.after(() => db.close()); t.mock.method(Date, 'now', () => NOW); return db;
}
function request(body, { version = body?.v ?? 2, origin = projects.alibi.origin, country = 'GB', method = 'PUT', raw, query = '', id = 'alibi', type = 'application/json' } = {}) {
  const r = new Request(`http://local.test/v${version}/survey/${id}${query}`, { method,
    headers: { Origin: origin, 'Content-Type': type },
    ...(['GET', 'HEAD', 'OPTIONS'].includes(method) ? {} : { body: raw ?? JSON.stringify(body) }) });
  Object.defineProperty(r, 'cf', { value: { country } }); return r;
}
const send = (db, body, options) => experiment(request(body, options), env(db));
const all = async (db, table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
const snapshot = async db => ({ rows: await all(db, 'voice_survey'), budgets: await all(db, 'budget'), revisions: await all(db, 'voice_survey_revisions') });
async function accepted(response, outcome) {
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, updated: outcome === 'updated', outcome });
}

test('production v1 still charges and refreshes a deliberate identical reconfirmation', async t => {
  const db = database(t, false), body = v1();
  assert.deepEqual(await (await production(request(body), env(db))).json(), { accepted: true, updated: false });
  const [first] = await all(db, 'voice_survey'); t.mock.method(Date, 'now', () => NOW + DAY);
  assert.deepEqual(await (await production(request(body, { country: 'FR' }), env(db))).json(), { accepted: true, updated: true });
  const [second] = await all(db, 'voice_survey');
  assert.equal(second.submissions, 2); assert.equal(second.received, NOW + DAY); assert.equal(second.country, 'FR');
  assert.equal(second.first_received, first.first_received); assert.equal((await all(db, 'budget')).length, 4);
});

test('unmodified production entry refuses v2 even when experiment settings are supplied', async t => {
  const db = database(t, false);
  assert.equal((await production(request(v2()), { ...env(db), acceptV2: true })).status, 404);
  assert.deepEqual(await all(db, 'voice_survey'), []); assert.deepEqual(await all(db, 'budget'), []);
});

test('experimental v2 accepts its closed normalized revision envelope', () => {
  const record = parseSurveyV2(taste(7), 'alibi'); assert.ok(record);
  assert.equal(record.revision, 7); assert.equal(record.answers, '{"often":"weekly","more":["scene","sudoku"],"difficulty":"mostly-right"}');
});
for (const revision of [undefined, null, 0, -1, 1.5, '2', true, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
  test(`v2 rejects an invalid revision (${String(revision)}) before storage`, async t => {
    const db = database(t), body = { ...v2(), revision };
    assert.equal(parseSurveyV2(body, 'alibi'), null);
    assert.equal((await send(db, body)).status, 400);
    assert.deepEqual(await all(db, 'voice_survey'), []); assert.deepEqual(await all(db, 'budget'), []);
  });
}
for (const extra of [{ unexpected: true }, { v: 1 }, { context: { device: 'desktop', x: true } }, { answers: { difficulty: 'not-an-option' } }]) {
  test(`v2 rejects extended or invalid content ${JSON.stringify(extra)}`, async t => {
    const db = database(t), body = { ...v2(), ...extra };
    assert.equal(parseSurveyV2(body, 'alibi'), null);
    assert.equal((await send(db, body, { version: 2 })).status, 400);
  });
}

for (const order of [[2, 1], [1, 2, 1], [3, 1, 2]]) {
  test(`revision delivery order ${order.join('/')} retains the highest answer`, async t => {
    const db = database(t); let highest = 0, charged = 0;
    for (const revision of order) {
      const body = v2(revision, { answers: { difficulty: revision === Math.max(...order) ? 'too-hard' : 'too-easy' } });
      await accepted(await send(db, body), revision > highest ? (highest ? 'updated' : 'created') : 'stale');
      if (revision > highest) charged++; highest = Math.max(highest, revision);
    }
    const state = await snapshot(db);
    assert.equal(state.rows[0].answers, '{"difficulty":"too-hard"}'); assert.equal(state.rows[0].submissions, charged);
    assert.equal(state.revisions[0].revision, highest); assert.deepEqual(state.budgets.map(r => r.used), [charged, charged]);
    const reading = await readVoices(db, { project: 'alibi', now: NOW, days: 1, admitted: true });
    assert.equal(reading.ratings.tooHard, undefined); assert.equal(reading.ratings.subjects[0].tooHard, 1);
  });
}

test('equal revision retries preserve all evidence and the next-day retention date', async t => {
  const db = database(t), body = v2(3);
  await accepted(await send(db, body), 'created'); const before = await snapshot(db);
  t.mock.method(Date, 'now', () => NOW + DAY);
  await accepted(await send(db, body, { country: 'FR' }), 'duplicate');
  assert.deepEqual(await snapshot(db), before);
});

test('a higher revision deliberately reconfirms identical content and refreshes the reporting window', async t => {
  const db = database(t); await accepted(await send(db, v2(1)), 'created');
  t.mock.method(Date, 'now', () => NOW + DAY);
  await accepted(await send(db, v2(2), { country: 'FR' }), 'updated');
  const state = await snapshot(db);
  assert.equal(state.rows[0].submissions, 2); assert.equal(state.rows[0].received, NOW + DAY);
  assert.equal(state.rows[0].country, 'FR'); assert.equal(state.rows[0].first_received, NOW);
  assert.equal(state.budgets.length, 4);
});

for (const [name, extra] of [['answers', { answers: { difficulty: 'too-hard' } }],
  ['meta', { meta: { family: 'binary', tier: 'expert' } }], ['device', { context: { device: 'mobile' } }], ['release', { release: '0.15.1' }]]) {
  test(`equal revision with changed ${name} conflicts without charging`, async t => {
    const db = database(t); await accepted(await send(db, v2(5)), 'created'); const before = await snapshot(db);
    const response = await send(db, v2(5, extra)); assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'revision_conflict' }); assert.deepEqual(await snapshot(db), before);
  });
}

test('canonical key/option order and redacted-equivalent text are idempotent, but redaction provenance is not', async t => {
  const db = database(t); await accepted(await send(db, taste(1, { comment: 'Contact first@example.org' })), 'created');
  await accepted(await send(db, taste(1, { answers: { difficulty: 'mostly-right', more: ['scene', 'sudoku'], often: 'weekly', tiers: [] }, comment: '  Contact second@example.org  ' })), 'duplicate');
  assert.equal((await send(db, taste(1, { comment: 'Contact [email]' }))).status, 409);
  const state = await snapshot(db); assert.equal(state.rows[0].comment, 'Contact [email]'); assert.equal(state.rows[0].redacted, 1);
  assert.deepEqual(state.budgets.map(r => r.used), [1, 1]);
  assert.ok(!JSON.stringify(state).includes(KEY)); assert.ok(!JSON.stringify(state).includes('example.org'));
});

for (const [key, limit] of [['alibi:voice', 300], ['*:voice', 100]]) {
  test(`full ${key} budget still classifies duplicate/stale/conflict before refusing a new edit`, async t => {
    const db = database(t); await accepted(await send(db, v2(2)), 'created');
    await db.prepare('UPDATE budget SET used=? WHERE project=?').bind(limit, key).run(); const before = await snapshot(db);
    await accepted(await send(db, v2(2)), 'duplicate'); await accepted(await send(db, v2(1)), 'stale');
    assert.equal((await send(db, v2(2, { answers: { difficulty: 'too-hard' } }))).status, 409);
    assert.equal((await send(db, v2(3))).status, 429); assert.deepEqual(await snapshot(db), before);
  });
}

test('a retry preserves the final quota slot for a later higher revision', async t => {
  const db = database(t); await accepted(await send(db, v2(1)), 'created');
  await db.prepare("UPDATE budget SET used=99 WHERE project='*:voice'").run();
  await accepted(await send(db, v2(1)), 'duplicate'); await accepted(await send(db, v2(2)), 'updated');
  assert.equal((await db.prepare("SELECT used FROM budget WHERE project='*:voice'").first()).used, 100);
  assert.equal((await send(db, v2(3))).status, 429); assert.equal((await all(db, 'voice_survey'))[0].submissions, 2);
});

test('v1-only identities keep reconfirmation semantics; v2 takeover blocks old v1 writes', async t => {
  const db = database(t); const first = await send(db, v1()); assert.deepEqual(await first.json(), { accepted: true, updated: false });
  t.mock.method(Date, 'now', () => NOW + DAY);
  assert.deepEqual(await (await send(db, v1())).json(), { accepted: true, updated: true });
  await accepted(await send(db, v2(7)), 'updated'); const before = await snapshot(db);
  const downgraded = await send(db, v1({ answers: { difficulty: 'too-easy' } }));
  assert.equal(downgraded.status, 409); assert.deepEqual(await downgraded.json(), { error: 'version_conflict' });
  assert.deepEqual(await snapshot(db), before);
  assert.deepEqual(await (await send(db, v1({ respondent: OTHER }))).json(), { accepted: true, updated: false });
});

test('disabling experimental v2 writes does not let old v1 requests overwrite protected data', async t => {
  const db = database(t); await accepted(await send(db, v2()), 'created'); const before = await snapshot(db);
  const disabled = createSurveyV2Experiment();
  assert.equal((await disabled(request(v2(2)), env(db))).status, 503);
  assert.equal((await disabled(request(v1()), env(db))).status, 409);
  assert.deepEqual(await snapshot(db), before);
});

test('revision scope includes respondent, subject, survey and project', async t => {
  const db = database(t); await accepted(await send(db, v2(9)), 'created');
  for (const body of [v2(1, { respondent: OTHER }), v2(1, { subject: 'castle-3' }), taste(1)]) await accepted(await send(db, body), 'created');
  assert.equal((await all(db, 'voice_survey_revisions')).length, 4);
  // A foreign project's metadata must not reserve this project's absent identity.
  db.exec(`INSERT INTO voice_survey SELECT 'foreign',survey,subject,respondent,first_received,received,day,release,
    answers,meta,comment,redacted,device,country,submissions FROM voice_survey WHERE subject='castle-3';
    INSERT INTO voice_survey_revisions SELECT 'foreign',survey,subject,respondent,revision
      FROM voice_survey_revisions WHERE subject='castle-3';
    DELETE FROM voice_survey WHERE project='alibi' AND subject='castle-3';`);
  await accepted(await send(db, v2(1, { subject: 'castle-3' })), 'created');
});

for (const [name, bodies] of [['identical', [v2(4), v2(4)]], ['conflicting', [v2(4), v2(4, { answers: { difficulty: 'too-hard' } })]], ['reordered', [v2(2), v2(1)]]]) {
  test(`two independent connections serialize ${name} submissions before quota`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-survey-v2-')); const a = openDatabase(join(dir, 'db.sqlite'));
    a.exec(CORE); a.exec(EXTRA); const b = openDatabase(join(dir, 'db.sqlite'));
    t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
    let arrivals = 0, release; const barrier = new Promise(resolve => { release = resolve; });
    const wrap = db => ({ prepare: db.prepare, async batch(statements) { if (++arrivals === 2) release(); await barrier; return db.batch(statements); } });
    const results = await Promise.all([send(wrap(a), bodies[0]), send(wrap(b), bodies[1])]);
    assert.equal(arrivals, 2); assert.deepEqual(results.map(r => r.status).sort(), name === 'conflicting' ? [202, 409] : [202, 202]);
    const state = await snapshot(a);
    if (name !== 'reordered') { assert.equal(state.rows[0].submissions, 1); assert.deepEqual(state.budgets.map(r => r.used), [1, 1]); }
    assert.equal(state.revisions[0].revision, Math.max(...bodies.map(b => b.revision)));
  });
}

for (const table of ['voice_survey', 'voice_survey_revisions']) {
  test(`failure updating ${table} rolls back both budgets, data and revision`, async t => {
    const db = database(t); await accepted(await send(db, v2(1)), 'created'); const before = await snapshot(db);
    db.exec(`CREATE TRIGGER reject_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'PRIVATE synthetic failure'); END`);
    const response = await send(db, v2(2)); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'unavailable' }); assert.deepEqual(await snapshot(db), before);
    await accepted(await send(db, v2(1)), 'duplicate');
  });
}

test('an uninstalled experiment fails closed and never installs tables during a request', async t => {
  const db = database(t, false);
  for (const body of [v1(), v2()]) assert.equal((await send(db, body)).status, 503);
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='voice_survey_revisions'").first(), null);
  assert.deepEqual(await all(db, 'budget'), []);
});

test('core retention removes both answer and revision at the existing boundary', async t => {
  const db = database(t); await accepted(await send(db, v2(5)), 'created');
  await maintain(env(db), NOW + 399 * DAY); assert.equal((await all(db, 'voice_survey_revisions')).length, 1);
  await maintain(env(db), NOW + 400 * DAY); assert.deepEqual(await all(db, 'voice_survey'), []); assert.deepEqual(await all(db, 'voice_survey_revisions'), []);
});

test('experimental origin, method, admission and byte gates precede revision recognition', async t => {
  const db = database(t); await accepted(await send(db, v2(2)), 'created'); const before = await snapshot(db);
  for (const [options, status] of [[{ origin: 'https://wrong.test' }, 403], [{ id: 'unknown' }, 404], [{ query: '?x=1' }, 404],
    [{ method: 'POST' }, 405], [{ type: 'text/plain' }, 415], [{ raw: 'x'.repeat(16385) }, 400]]) {
    const response = await send(db, v2(2), options); assert.equal(response.status, status);
  }
  for (const extra of [{ COLLECT_ENABLED: 'false' }, { COLLECT_PROJECTS: 'alibi,unknown' }, { COLLECT_VOICE_PROJECTS: '' }]) {
    assert.equal((await experiment(request(v2(2)), { ...env(db), ...extra })).status, 503);
  }
  const response = await send(db, null, { method: 'OPTIONS', version: 2 }); assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'PUT'); assert.deepEqual(await snapshot(db), before);
});

test('real local HTTP preserves newest v2 feedback and rejects a legacy downgrade', async t => {
  const db = database(t); const runner = await startLocalRunner({ port: 0, ...env(db), requestHandler: experiment });
  try {
    for (const [body, status, outcome] of [[v2(2), 202, 'created'], [v2(1), 202, 'stale'], [v2(2), 202, 'duplicate'], [v1(), 409, null]]) {
      const r = request(body); const response = await fetch(runner.origin + new URL(r.url).pathname, { method: r.method, headers: r.headers, body: JSON.stringify(body) });
      assert.equal(response.status, status); if (outcome) await accepted(response, outcome);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.deepEqual((await all(db, 'budget')).map(r => r.used), [1, 1]);
  } finally { await runner.close(); }
});

test('maximum safe revision remains exact, idempotent and cannot wrap', async t => {
  const db = database(t); await accepted(await send(db, v2(Number.MAX_SAFE_INTEGER)), 'created');
  await accepted(await send(db, v2(Number.MAX_SAFE_INTEGER)), 'duplicate');
  await accepted(await send(db, v2(Number.MAX_SAFE_INTEGER - 1)), 'stale');
  assert.equal((await all(db, 'voice_survey_revisions'))[0].revision, Number.MAX_SAFE_INTEGER);
});

test('scratch schema reapplication preserves existing v1 and v2 rows and core version', async t => {
  const db = database(t); await send(db, v1()); await accepted(await send(db, v2(2)), 'updated');
  const before = await snapshot(db); db.exec(EXTRA); assert.deepEqual(await snapshot(db), before);
  assert.equal((await db.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 5);
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
});

test('partial scratch schema is never treated as unversioned storage', async t => {
  const db = database(t); db.exec('DROP TABLE voice_survey_revisions');
  for (const body of [v1(), v2()]) assert.equal((await send(db, body)).status, 503);
  assert.deepEqual(await all(db, 'voice_survey'), []); assert.deepEqual(await all(db, 'budget'), []);
});

test('orphaned revision metadata fails closed without charging or recreating an answer', async t => {
  const db = database(t); await accepted(await send(db, v2(2)), 'created');
  // Fault injection models externally corrupted metadata, not normal deletion (which cascades).
  db.exec('PRAGMA foreign_keys=OFF; DELETE FROM voice_survey; PRAGMA foreign_keys=ON;');
  const before = await snapshot(db);
  assert.equal((await send(db, v2(3))).status, 503); assert.deepEqual(await snapshot(db), before);
});

test('factory rejects nonboolean activation rather than accepting truthy values', () => {
  for (const acceptV2 of ['true', 'false', 1, null]) assert.throws(() => createSurveyV2Experiment({ acceptV2 }), TypeError);
});
