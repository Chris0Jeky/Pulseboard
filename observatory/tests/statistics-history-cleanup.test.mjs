import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readStatistics, READ_WINDOWS } from '../src/statistics.mjs';

const cleanup = readFileSync(new URL('../maintenance/statistics-received-cleanup.sql', import.meta.url), 'utf8');
const DAY = 86_400_000;
const now = Date.parse('2026-10-07T12:34:56.789Z');
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}
async function insert(db, { project = 'alibi', day = '2026-10-07', received = now, n = 3 } = {}) {
  await db.prepare('INSERT INTO statistics VALUES(?,?,\'page.view\',\'home\',\'unattributed\',?,?)')
    .bind(project, day, n, received).run();
}
const rows = async db => (await db.prepare('SELECT rowid,* FROM statistics ORDER BY project,day').all()).results.map(row => ({ ...row }));
const changes = async db => (await db.prepare('SELECT changes() AS n').first()).n;

test('historical cleanup coarsens timestamps only, preserving keys, counts, readers and other tables', async t => {
  const db = database(t);
  await insert(db);
  await insert(db, { project: 'mdviewer', received: now - 1000, n: 5 });
  await insert(db, { day: '2026-10-06', received: Math.floor(now / DAY) * DAY - DAY });
  db.exec(`INSERT INTO statistics_dimensions VALUES('alibi','2026-10-07','hour','12',3);
    INSERT INTO budget VALUES('alibi','2026-10-07',3,'synthetic-receipt');
    INSERT INTO events VALUES('alibi','synthetic-id',${now},'synthetic-session',1,'page.view','home','unattributed',NULL);
    INSERT INTO probes VALUES('alibi','up',0,1,NULL,${now},200,10);
    INSERT INTO probe_history VALUES('alibi',${now},1,10);
    INSERT INTO product_events VALUES('alibi',${now},'2026-10-07',NULL,1,'page.view','home','unattributed',1,'{}',0,'unknown','unknown','unknown','unknown','unknown');
    INSERT INTO voice_feedback VALUES('alibi','synthetic-id',${now},'2026-10-07','2026-10-07','unattributed','other','home','','synthetic',0,'unknown','unknown','unknown','unknown');
    INSERT INTO voice_survey VALUES('alibi','synthetic-survey','','synthetic-hash',${now},${now},'2026-10-07','unattributed','{}','{}','',0,'unknown','unknown',1);`);
  const otherTables = ['statistics_dimensions', 'budget', 'events', 'probes', 'probe_history', 'product_events', 'voice_feedback', 'voice_survey', 'schema_version'];
  const beforeOther = await Promise.all(otherTables.map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  const beforeRows = await rows(db);
  const options = ['alibi', 'mdviewer'].flatMap(project => READ_WINDOWS.map(days => ({ project, days, now, admitted: true })));
  const beforeReads = await Promise.all(options.map(option => readStatistics(db, option)));
  db.exec(cleanup);
  assert.equal(await changes(db), 2);
  assert.deepEqual(await rows(db), beforeRows.map(row => ({ ...row, received: Math.floor(row.received / DAY) * DAY })));
  assert.deepEqual(await Promise.all(options.map(option => readStatistics(db, option))), beforeReads);
  assert.deepEqual(await Promise.all(otherTables.map(table => db.prepare(`SELECT * FROM ${table}`).all())), beforeOther);
  db.exec(cleanup);
  assert.equal(await changes(db), 0, 'second execution must perform no writes');
});

for (const [label, invalid] of [
  ['negative timestamp', { received: -1 }],
  ['fractional timestamp', { received: now + 0.5 }],
  ['text timestamp', { received: 'invalid' }],
  ['out-of-range timestamp', { received: 253402300800000 }],
  ['timestamp/day mismatch', { day: '2026-10-06' }],
  ['noncanonical day', { day: '2026-1-7' }],
  ['impossible day', { day: '2026-02-30' }],
]) {
  test(`historical cleanup refuses the entire update for ${label}`, async t => {
    const db = database(t);
    await insert(db);
    await insert(db, { project: 'mdviewer', ...invalid });
    const before = await rows(db);
    db.exec(cleanup);
    assert.equal(await changes(db), 0);
    assert.deepEqual(await rows(db), before);
  });
}

for (const version of [4, 6, null]) {
  test(`historical cleanup refuses unexpected schema marker ${version}`, async t => {
    const db = database(t);
    await insert(db);
    if (version === null) db.exec('DELETE FROM schema_version');
    else await db.prepare('UPDATE schema_version SET version=?').bind(version).run();
    const before = await rows(db);
    db.exec(cleanup);
    assert.equal(await changes(db), 0);
    assert.deepEqual(await rows(db), before);
  });
}

test('historical cleanup is a no-op on an empty database', async t => {
  const db = database(t);
  db.exec(cleanup);
  assert.equal(await changes(db), 0);
  assert.deepEqual(await rows(db), []);
});

test('historical cleanup supports integer epoch and final four-digit year boundaries', async t => {
  const db = database(t);
  await insert(db, { day: '1970-01-01', received: 1 });
  await insert(db, { day: '9999-12-31', received: 253402300799999 });
  const before = await rows(db);
  db.exec(cleanup);
  assert.equal(await changes(db), 2);
  assert.deepEqual(await rows(db), before.map(row => ({ ...row, received: Math.floor(row.received / DAY) * DAY })));
});

test('historical cleanup rolls back all updates on a statement failure', async t => {
  const db = database(t);
  await insert(db);
  await insert(db, { project: 'mdviewer' });
  const before = await rows(db);
  db.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON statistics
    WHEN OLD.project='mdviewer' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END`);
  assert.throws(() => db.exec(cleanup), /synthetic write failure/);
  assert.deepEqual(await rows(db), before);
});

test('historical cleanup audit distinguishes empty, precise, cleaned and invalid rows without exposing timestamps', async t => {
  const auditSql = readFileSync(new URL('../maintenance/statistics-received-audit.sql', import.meta.url), 'utf8');
  const db = database(t);
  const audit = async () => ({ ...await db.prepare(auditSql).first() });
  assert.deepEqual(await audit(), { schemaVersion: 5, totalRows: 0, totalCount: 0, invalidRows: 0, preciseRows: 0 });
  await insert(db);
  await insert(db, { project: 'mdviewer', n: 5 });
  assert.deepEqual(await audit(), { schemaVersion: 5, totalRows: 2, totalCount: 8, invalidRows: 0, preciseRows: 2 });
  db.exec(cleanup);
  assert.deepEqual(await audit(), { schemaVersion: 5, totalRows: 2, totalCount: 8, invalidRows: 0, preciseRows: 0 });
  await insert(db, { project: 'commitatlas', received: -1 });
  assert.deepEqual(await audit(), { schemaVersion: 5, totalRows: 3, totalCount: 11, invalidRows: 1, preciseRows: 0 });
  db.exec('UPDATE schema_version SET version=6');
  assert.equal((await audit()).schemaVersion, 6);
});
