import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readProduct } from '../src/product.mjs';
import { handle } from '../src/worker.mjs';
import { projects } from '../src/projects.mjs';
import * as desk from '../public/desk-product.mjs';
import { makeProductDemo, makeProductEventsDemo } from '../public/desk-demo.mjs';
const now = Date.parse('2026-10-12T12:00:00Z'), day = '2026-10-12';
function database(t) {
  const db = openDatabase(); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close()); return db;
}
async function seed(db, messages, { project = 'alibi', received = now } = {}) {
  await db.batch(messages.map(message => db.prepare(`INSERT INTO product_events
    (project,received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device)
    VALUES(?,?,?,NULL,1,'js.error','puzzle','0.13.0',0,?,0,'unknown','unknown','unknown','unknown','desktop')`)
    .bind(project, received, new Date(received).toISOString().slice(0, 10), JSON.stringify({ kind: 'Error', message }))));
}
const read = db => readProduct(db, { project: 'alibi', days: 1, now });
for (const size of [0, 500, 501]) {
  test(`${size} historical raw groups report measured coverage even when they normalize to one group`, async t => {
    const db = database(t), prefix = 'A'.repeat(160);
    await seed(db, Array.from({ length: size }, (_, i) => prefix + i));
    const value = await read(db);
    assert.equal(value.errorsTruncated, size > 500);
    assert.equal(value.errors.reduce((n, row) => n + row.n, 0), Math.min(size, 500), 'the sentinel row is not part of the reading');
    assert.equal(desk.assertProduct(value, 1, 'alibi'), value);
  });
}

test('the 500 A / 499 B historical fixture and mixed new writes disclose hidden normalized groups', async t => {
  const db = database(t), a = 'A'.repeat(160), b = 'B'.repeat(160);
  await seed(db, [...Array.from({ length: 500 }, (_, i) => [a + i, a + i]).flat(),
    ...Array.from({ length: 499 }, (_, i) => b + i)]);
  const before = await read(db);
  assert.equal(before.total, 1499); assert.equal(before.errors.length, 1);
  assert.equal(before.errorsTruncated, true);
  assert.match(before.limitations.join(' '), /error.*incomplete.*lower bounds/i);
  assert.deepEqual(before.errors.map(x => [x.message, x.n]), [[a, 1000]]);
  // The old v4 rows remain untouched; a later canonical-looking write does not certify the mixed window.
  t.mock.method(Date, 'now', () => now);
  const response = await handle(new Request('https://desk.test/v1/product/alibi', { method: 'POST',
    headers: { Origin: projects.alibi.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, session: null, release: '0.13.0', context: { device: 'desktop' },
      events: [{ name: 'js.error', route: 'puzzle', seq: 1, ms: 0, props: { kind: 'Error', message: b } }] }) }),
    { DB: db, COLLECT_ENABLED: 'true', COLLECT_PRODUCT_PROJECTS: 'alibi' });
  assert.equal(response.status, 202);
  const after = await read(db);
  assert.equal(after.total, 1500); assert.equal(after.errorsTruncated, true);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM product_events WHERE length(json_extract(props,\'$.message\'))>160').first()).n, 1499);
});

test('coverage is scoped to the selected project and calendar window', async t => {
  const db = database(t);
  await seed(db, ['actual']);
  const many = Array.from({ length: 501 }, (_, i) => `other-${i}`);
  await seed(db, many, { project: 'commitatlas' });
  await seed(db, many, { received: now - 86400000 });
  const value = await read(db);
  assert.equal(value.errorsTruncated, false);
  assert.deepEqual(value.errors.map(row => row.message), ['actual']);
});

test('Desk accepts both coverage flags, rejects malformed flags, and treats older readings as unknown', async t => {
  const value = await read(database(t));
  for (const flag of [true, false]) assert.equal(desk.assertProduct({ ...value, errorsTruncated: flag }, 1, 'alibi').errorsTruncated, flag);
  for (const flag of [null, 0, 'false']) assert.throws(() => desk.assertProduct({ ...value, errorsTruncated: flag }, 1, 'alibi'), /truncation/i);
  const legacy = { ...value }; delete legacy.errorsTruncated;
  assert.equal(desk.assertProduct(legacy, 1, 'alibi'), legacy);
  assert.equal(desk.errorCoverage(legacy).state, 'unknown');
  assert.match(desk.errorCoverage(legacy).notice, /not reported/i);
  assert.equal(desk.errorCoverage({ errorsTruncated: false }).state, 'complete');
  const partial = desk.errorCoverage({ errorsTruncated: true });
  assert.equal(partial.state, 'partial'); assert.equal(partial.countHeading, 'Count (at least)');
  assert.match(partial.notice, /lower bounds.*ranking.*incomplete/i);
});


test('generated demo errors have explicit complete coverage across every window and public project', () => {
  for (const days of desk.PRODUCT_WINDOWS) for (const [project, config] of Object.entries(projects)) {
    if (!config.origin) continue;
    const demo = makeProductDemo(days, now, project);
    assert.equal(demo.errorsTruncated, false, `${project}/${days}: locally exhaustive demo is not a legacy response`);
    assert.equal(desk.assertProduct(demo, days, project), demo);
    const coverage = desk.errorCoverage(demo);
    assert.equal(coverage.state, 'complete'); assert.equal(coverage.notice, null);
    assert.equal(coverage.countHeading, 'Count');
    const raw = makeProductEventsDemo(days, now, project, 'js.error', 5000);
    assert.equal(raw.truncated, false);
    assert.equal(demo.errors.reduce((sum, row) => sum + row.n, 0), raw.events.length);
  }
});
