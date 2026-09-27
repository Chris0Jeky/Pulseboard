import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { handle, maintain, SCHEMA_VERSION } from '../src/worker.mjs';

const schema = () => readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const migration5 = () => readFileSync(new URL('../migrations/0005-voices.sql', import.meta.url), 'utf8');
function database(t) {
  const DB = openDatabase();
  DB.exec(schema());
  t.after(() => DB.close());
  return DB;
}
const columns = async (DB, table) => (await DB.prepare(`SELECT name, pk FROM pragma_table_info('${table}') ORDER BY cid`).all()).results.map(r => [r.name, r.pk]);
const DAY = 86400000;

test('schema 5 stores feedback and survey rows with exactly the specified columns and keys, and nothing identifying', async t => {
  const DB = database(t);
  assert.equal(SCHEMA_VERSION, 5);
  assert.deepEqual(await columns(DB, 'voice_feedback'), [['project', 1], ['id', 2], ['received', 0], ['day', 0], ['written', 0], ['release', 0],
    ['kind', 0], ['route', 0], ['subject', 0], ['text', 0], ['redacted', 0], ['device', 0], ['country', 0], ['browser', 0], ['os', 0]]);
  assert.deepEqual(await columns(DB, 'voice_survey'), [['project', 1], ['survey', 2], ['subject', 3], ['respondent', 4], ['first_received', 0],
    ['received', 0], ['day', 0], ['release', 0], ['answers', 0], ['meta', 0], ['comment', 0], ['redacted', 0], ['device', 0], ['country', 0], ['submissions', 0]]);
  for (const table of ['voice_feedback', 'voice_survey']) {
    const names = (await columns(DB, table)).map(([name]) => name).join(' ');
    assert.doesNotMatch(names, /\b(?:ip|user_agent|ua|url|email|name|session|key|region)\b/, table);
  }
  const indexes = (await DB.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name LIKE 'voice_%' AND sql IS NOT NULL ORDER BY name").all()).results;
  assert.deepEqual(indexes.map(i => i.name), ['voice_feedback_day', 'voice_survey_day']);
});

test('migration 0005 creates the same voice tables as schema.sql, idempotently, and never downgrades the marker', async t => {
  const fresh = database(t), migrated = database(t);
  migrated.exec('DROP TABLE voice_feedback; DROP TABLE voice_survey; UPDATE schema_version SET version=4 WHERE id=1');
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB: migrated })).status, 503, 'a schema-4 database is not ready for this Worker');
  migrated.exec(migration5()); migrated.exec(migration5());
  const sql = async DB => (await DB.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name LIKE 'voice_%' ORDER BY name").all()).results
    .map(r => ({ ...r, sql: r.sql?.replace(/\s+/g, ' ') }));
  assert.deepEqual(await sql(migrated), await sql(fresh));
  assert.equal((await migrated.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 5);
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB: migrated })).status, 200);
  // A later marker survives a re-run of 0005, and the documented rollback marker moves exactly 5 to 4.
  migrated.exec('UPDATE schema_version SET version=6 WHERE id=1');
  migrated.exec(migration5());
  assert.equal((await migrated.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 6);
  migrated.exec('UPDATE schema_version SET version=5 WHERE id=1');
  migrated.exec('UPDATE schema_version SET version=4 WHERE id=1 AND version=5');
  assert.equal((await migrated.prepare('SELECT version FROM schema_version WHERE id=1').first()).version, 4);
  // Additive only: the migration names no other table.
  assert.deepEqual([...migration5().matchAll(/(?:TABLE|INDEX)\s+IF NOT EXISTS\s+(\w+)/g)].map(m => m[1]),
    ['voice_feedback', 'voice_feedback_day', 'voice_survey', 'voice_survey_day']);
  assert.doesNotMatch(migration5(), /\b(?:DROP|DELETE|ALTER)\b|^\s*UPDATE\b/im, 'only the schema marker upsert updates anything');
});

test('readiness fails when a voice table or column is missing', async t => {
  const DB = database(t);
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB })).status, 200);
  DB.exec('ALTER TABLE voice_survey DROP COLUMN submissions');
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB })).status, 503);
  const other = database(t);
  other.exec('DROP TABLE voice_feedback');
  assert.equal((await handle(new Request('https://desk.test/readyz'), { DB: other })).status, 503);
});

test('the retention sweep keeps 365 days of feedback and 400 of survey answers, by last update day', async t => {
  const DB = database(t), now = Date.UTC(2026, 8, 27, 12);
  const day = offset => new Date(now - offset * DAY).toISOString().slice(0, 10);
  const feedback = DB.prepare(`INSERT INTO voice_feedback VALUES(?,?,?,?,?,'0.15.0','bug','puzzle','','text',0,'mobile','GB','chrome','android')`);
  for (const [id, offset] of [['gone', 365], ['kept', 364], ['today', 0]]) await feedback.bind('alibi', id, now - offset * DAY, day(offset), day(offset)).run();
  const survey = DB.prepare(`INSERT INTO voice_survey VALUES(?,'alibi-taste-1','',?,?,?,?,'0.15.0','{}','{}','',0,'mobile','GB',1)`);
  for (const [respondent, offset] of [['gone', 400], ['kept', 399], ['today', 0]]) await survey.bind('alibi', respondent, now - offset * DAY, now - offset * DAY, day(offset)).run();
  // An old first answer updated recently is kept: retention counts from the last update.
  await survey.bind('alibi', 'updated', now - 900 * DAY, now - 2 * DAY, day(2)).run();
  await maintain({ DB }, now);
  assert.deepEqual((await DB.prepare('SELECT id FROM voice_feedback ORDER BY id').all()).results.map(r => r.id), ['kept', 'today']);
  assert.deepEqual((await DB.prepare('SELECT respondent FROM voice_survey ORDER BY respondent').all()).results.map(r => r.respondent), ['kept', 'today', 'updated']);
  // The sweep reads through the day indexes, not a table scan every fifteen minutes.
  for (const table of ['voice_feedback', 'voice_survey']) {
    const plan = (await DB.prepare(`EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE day<=?`).bind('2026-01-01').all()).results.map(r => r.detail).join(' ');
    assert.match(plan, new RegExp(`USING (?:COVERING )?INDEX ${table}_day`), table);
  }
});
