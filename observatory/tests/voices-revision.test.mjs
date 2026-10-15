// Survey edit ordering (#218): `pulseboard.survey/2` carries a client edit `revision`, and the collector replaces a
// stored answer only with a higher one. v1 payloads keep their unrevisioned last-write-wins behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { parseSurvey, VOICE_DEFAULT_LIMIT, VOICE_GLOBAL_KEY } from '../src/voice-contract.mjs';

const ORIGIN = projects.alibi.origin, KEY = '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2';
const today = () => new Date().toISOString().slice(0, 10);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function database(t) {
  const DB = openDatabase();
  DB.exec(read('../schema.sql'));
  t.after(() => DB.close());
  return DB;
}
const env = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_VOICE_PROJECTS: 'alibi' });
const v1 = (extra = {}) => ({ v: 1, survey: 'alibi-taste-1', subject: '', respondent: KEY, release: '0.15.0',
  answers: { often: 'weekly', difficulty: 'mostly-right' }, meta: {}, comment: '', context: { device: 'mobile' }, ...extra });
const v2 = (revision, difficulty = 'mostly-right', extra = {}) => ({ ...v1({ answers: { often: 'weekly', difficulty } }), v: 2, revision, ...extra });
const put = async (DB, body) => {
  const response = await handle(new Request('https://collector.example/v1/survey/alibi', { method: 'PUT',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env(DB));
  return { status: response.status, body: await response.json(), cors: response.headers.get('Access-Control-Allow-Origin') };
};
const rows = async DB => (await DB.prepare('SELECT * FROM voice_survey').all()).results.map(r => ({ ...r }));
const difficulty = async DB => (await rows(DB)).map(r => [JSON.parse(r.answers).difficulty, r.revision, r.submissions]);
const used = async (DB, key = 'alibi:voice') => (await DB.prepare('SELECT used FROM budget WHERE project=? AND day=?').bind(key, today()).first())?.used ?? null;
const pause = () => new Promise(resolve => setTimeout(resolve, 5));

test('B delivered before a delayed A keeps B, and the stale A charges nothing', async t => {
  const DB = database(t);
  assert.deepEqual(await put(DB, v2(2, 'too-hard')), { status: 202, body: { accepted: true, updated: false }, cors: ORIGIN });
  const [before] = await rows(DB);
  await pause();
  assert.deepEqual(await put(DB, v2(1, 'too-easy')), { status: 202, body: { accepted: true, updated: false, stale: true }, cors: ORIGIN });
  assert.deepEqual(await rows(DB), [before], 'the stale request changes no column, received included');
  assert.equal(await used(DB), 1); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 1);
});

test('A, then B, then a delayed A: the older queued request does not replace the newer answer', async t => {
  const DB = database(t);
  assert.deepEqual((await put(DB, v2(1, 'too-easy'))).body, { accepted: true, updated: false });
  assert.deepEqual((await put(DB, v2(2, 'too-hard'))).body, { accepted: true, updated: true });
  assert.deepEqual((await put(DB, v2(1, 'too-easy'))).body, { accepted: true, updated: false, stale: true });
  assert.deepEqual(await difficulty(DB), [['too-hard', 2, 2]]);
  assert.equal(await used(DB), 2);
  // A stale replay answers 202 even with today's budget full, so a well-behaved queue drops it instead of retrying.
  await DB.prepare('UPDATE budget SET used=? WHERE project=?').bind(VOICE_DEFAULT_LIMIT, 'alibi:voice').run();
  assert.deepEqual(await put(DB, v2(1, 'too-easy')), { status: 202, body: { accepted: true, updated: false, stale: true }, cors: ORIGIN });
  assert.equal(await used(DB), VOICE_DEFAULT_LIMIT); assert.deepEqual(await difficulty(DB), [['too-hard', 2, 2]]);
});

test('an exact retry rewrites nothing, bumps no counter and is free at the last budget slot', async t => {
  const DB = database(t);
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi:voice', today(), VOICE_DEFAULT_LIMIT - 2, 'old').run();
  assert.deepEqual((await put(DB, v2(1))).body, { accepted: true, updated: false });
  const [stored] = await rows(DB);
  await pause();
  assert.deepEqual(await put(DB, v2(1)), { status: 202, body: { accepted: true, updated: false, duplicate: true }, cors: ORIGIN });
  assert.deepEqual(await put(DB, v2(1)), { status: 202, body: { accepted: true, updated: false, duplicate: true }, cors: ORIGIN });
  assert.deepEqual(await rows(DB), [stored], 'no rewrite: received, day and submissions unchanged');
  assert.equal(await used(DB), VOICE_DEFAULT_LIMIT - 1, 'one durable revision, one charged slot');
  // The slot the retries did not spend still admits a deliberate edit, and a reconfirmation with a new revision counts.
  assert.deepEqual((await put(DB, v2(2))).body, { accepted: true, updated: true });
  assert.deepEqual(await difficulty(DB), [['mostly-right', 2, 2]]);
  assert.equal(await used(DB), VOICE_DEFAULT_LIMIT);
  assert.equal((await put(DB, v2(3))).status, 429, 'a real edit past the budget is still refused');
  assert.deepEqual(await difficulty(DB), [['mostly-right', 2, 2]]);
});

test('an equal revision with different content is a 409 conflict that stores and charges nothing', async t => {
  const DB = database(t);
  await put(DB, v2(4, 'too-easy'));
  const [stored] = await rows(DB);
  for (const body of [v2(4, 'too-hard'), v2(4, 'too-easy', { release: '0.15.1' }), v2(4, 'too-easy', { context: { device: 'tablet' } }),
    v2(4, 'too-easy', { comment: 'more castles' })]) {
    assert.deepEqual(await put(DB, body), { status: 409, body: { error: 'revision_conflict' }, cors: ORIGIN }, JSON.stringify(body));
  }
  assert.deepEqual(await rows(DB), [stored]);
  assert.equal(await used(DB), 1);
});

test('an unrevisioned v1 payload behaves exactly as before: every write replaces the row, counts and is charged', async t => {
  const DB = database(t);
  assert.deepEqual(await put(DB, v1()), { status: 202, body: { accepted: true, updated: false }, cors: ORIGIN });
  assert.deepEqual(await put(DB, v1()), { status: 202, body: { accepted: true, updated: true }, cors: ORIGIN });
  assert.deepEqual(await put(DB, v1({ answers: { often: 'daily', difficulty: 'too-hard' } })), { status: 202, body: { accepted: true, updated: true }, cors: ORIGIN });
  assert.deepEqual(await difficulty(DB), [['too-hard', null, 3]]);
  assert.equal(await used(DB), 3);
});

test('a revisioned write replaces an unrevisioned one; an unrevisioned write never replaces a revisioned one', async t => {
  const DB = database(t);
  await put(DB, v1({ answers: { often: 'weekly', difficulty: 'too-easy' } }));
  assert.deepEqual((await put(DB, v2(1, 'too-hard'))).body, { accepted: true, updated: true });
  assert.deepEqual(await difficulty(DB), [['too-hard', 1, 2]]);
  // A v1 request still queued in an older client is older than any revisioned edit of the same identity.
  assert.deepEqual(await put(DB, v1({ answers: { often: 'weekly', difficulty: 'too-easy' } })),
    { status: 202, body: { accepted: true, updated: false, stale: true }, cors: ORIGIN });
  assert.deepEqual(await difficulty(DB), [['too-hard', 1, 2]]);
  assert.equal(await used(DB), 2);
});

test('the revision is a safe integer from 1 to 2^31-1, required in v2 and refused in v1', async t => {
  const DB = database(t);
  assert.equal(parseSurvey(v2(1), 'alibi').revision, 1);
  assert.equal(parseSurvey(v2(2 ** 31 - 1), 'alibi').revision, 2 ** 31 - 1);
  assert.equal(parseSurvey(v1(), 'alibi').revision, null);
  for (const revision of [0, -1, 2 ** 31, Number.MAX_SAFE_INTEGER + 1, 1.5, '1', null, true, [1], {}]) {
    assert.equal(parseSurvey(v2(revision), 'alibi'), null, JSON.stringify(revision));
    assert.deepEqual(await put(DB, v2(revision)), { status: 400, body: { error: 'contract' }, cors: ORIGIN }, JSON.stringify(revision));
  }
  const { revision, ...missing } = v2(1);
  assert.equal(parseSurvey(missing, 'alibi'), null, 'v2 without a revision');
  assert.equal(parseSurvey({ ...v1(), revision: 1 }, 'alibi'), null, 'v1 stays closed');
  assert.equal(parseSurvey({ ...v2(1), v: 3 }, 'alibi'), null);
  assert.deepEqual(await rows(DB), []); assert.equal(await used(DB), null);
});

test('migration 0006 adds the nullable revision column to a schema-5 database, matching schema.sql', async t => {
  const fresh = database(t), migrated = database(t);
  migrated.exec('DROP TABLE voice_survey; UPDATE schema_version SET version=5 WHERE id=1');
  migrated.exec(read('../migrations/0005-voices.sql'));
  migrated.exec(`INSERT INTO voice_survey VALUES('alibi','alibi-taste-1','','h',1,1,'2026-10-15','0.15.0','{}','{}','',0,'mobile','GB',1)`);
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB: migrated })).status, 503, 'schema 5 is not ready for this Worker');
  migrated.exec(read('../migrations/0006-voice-revision.sql'));
  const indexes = async DB => (await DB.prepare("SELECT name FROM sqlite_master WHERE tbl_name='voice_survey' ORDER BY name").all()).results.map(r => r.name);
  const columns = async DB => (await DB.prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('voice_survey') ORDER BY cid").all()).results.map(r => ({ ...r }));
  assert.deepEqual(await columns(migrated), await columns(fresh));
  assert.deepEqual(await indexes(migrated), await indexes(fresh));
  assert.equal((await migrated.prepare('SELECT revision FROM voice_survey').first()).revision, null, 'existing rows are unrevisioned');
  assert.equal((await migrated.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 6);
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB: migrated })).status, 200);
  // Re-running fails on the existing column and changes nothing; a later marker is never downgraded.
  assert.throws(() => migrated.exec(read('../migrations/0006-voice-revision.sql')), /duplicate column/);
  assert.deepEqual(await columns(migrated), await columns(fresh));
  migrated.exec('UPDATE schema_version SET version=6 WHERE id=1 AND version=6');
  migrated.exec('UPDATE schema_version SET version=5 WHERE id=1 AND version=6');
  assert.equal((await migrated.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 5, 'the documented rollback marker');
});
