import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { profileDatabase } from './helpers/portfolio-profile.mjs';

const DAY = 86_400_000, now = Date.UTC(2026, 9, 7, 12);
const names = ['puzzle.started', 'puzzle.completed', 'puzzle.failed'];
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}
async function insert(db, rows) {
  await db.batch(rows.map((r, i) => db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,NULL)')
    .bind(r.project ?? 'alibi', `fixture-${i}`, r.received ?? now - 1000, r.session ?? 'one',
      r.seq ?? i + 1, r.event, r.route ?? 'puzzle', r.release ?? '0.11.4')));
}
// Independent bounded reference: walk each start and select the first strictly later
// terminal before its next start; receipt time selects the window, not event order.
function reference(input) {
  const groups = new Map();
  for (const [rowid, entry] of input.entries()) {
    const r = { project: 'alibi', received: now - 1000, session: 'one', seq: rowid + 1,
      route: 'puzzle', release: '0.11.4', ...entry, rowid };
    if (r.project !== 'alibi' || r.received < now - DAY || r.received >= now || !names.includes(r.event)) continue;
    const key = JSON.stringify([r.session, r.route, r.release]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const totals = {};
  for (const group of groups.values()) {
    group.sort((a, b) => a.seq - b.seq || a.rowid - b.rowid);
    const starts = group.filter(r => r.event === names[0]);
    for (const [i, start] of starts.entries()) {
      const next = starts[i + 1];
      const terminal = group.find(r => r.event !== names[0] && r.seq > start.seq && (!next || r.seq < next.seq));
      const row = totals[start.release] ??= { release: start.release, attempts: 0, completed: 0, failed: 0, open: 0, retries: 0 };
      row.attempts++;
      row[terminal ? terminal.event === names[1] ? 'completed' : 'failed' : 'open']++;
      if (next && (!terminal || terminal.event === names[2])) row.retries++;
    }
  }
  return Object.values(totals).sort((a, b) => a.release.localeCompare(b.release));
}
async function operation(db) {
  const result = assertPortfolio(await readPortfolio(db, { days: 1, now }));
  return result.projects.find(p => p.id === 'alibi').operations[0];
}

test('operation query does not rescan the receipt window per start or outcome aggregate', async t => {
  const db = database(t);
  await insert(db, Array.from({ length: 90 }, (_, i) => ({ event: names[i % 3] })));
  const tracked = profileDatabase(db);
  await readPortfolio(tracked.db, { now });
  const statement = tracked.statements.at(-1);
  const plan = (await db.prepare('EXPLAIN QUERY PLAN ' + statement.query).bind(...statement.args).all()).results;
  assert.equal(plan.some(row => /CORRELATED/i.test(row.detail)), false, JSON.stringify(plan));
});

for (let seed = 1; seed <= 12; seed++) {
  test(`operation matching agrees with an independent sequence oracle (seed ${seed})`, async t => {
    const db = database(t);
    let state = seed;
    const pick = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * n); };
    const rows = Array.from({ length: 240 }, (_, i) => ({ seq: i + 1,
      event: [...names, 'hint.requested'][pick(4)], session: `s${pick(5)}`,
      route: ['puzzle', 'home'][pick(2)], release: ['0.11.4', '0.11.5'][pick(2)],
      project: pick(7) ? 'alibi' : 'mdviewer',
      received: [now - DAY - 1, now - DAY, now - 1, now, now + 1][pick(5)],
    }));
    await insert(db, rows);
    const result = await operation(db);
    assert.deepEqual(result.releases, reference(rows));
    for (const key of ['attempts', 'completed', 'failed', 'open', 'retries']) {
      assert.equal(result[key], reference(rows).reduce((sum, row) => sum + row[key], 0));
    }
  });
}

for (const events of [
  [[1, 0], [1, 0], [2, 1], [3, 0]],
  [[1, 0], [1, 2], [2, 1]],
  [[1, 0], [2, 0], [2, 1], [3, 2]],
  [[1, 0], [2, 1], [2, 2]],
  [[1, 0], [2, 2], [2, 1]],
  [[1, 1], [2, 2]],
]) {
  test(`same-sequence start and terminal boundaries ${JSON.stringify(events)}`, async t => {
    const db = database(t);
    const rows = events.map(([seq, event]) => ({ seq, event: names[event] }));
    await insert(db, rows);
    assert.deepEqual((await operation(db)).releases, reference(rows));
  });
}

test('generic paired flow also avoids a correlated scan per session', async t => {
  const db = database(t), tracked = profileDatabase(db);
  await insert(db, [{ event: 'action.requested' }, { event: 'action.completed' }]);
  await readPortfolio(tracked.db, { now });
  for (const statement of tracked.statements) {
    const plan = (await db.prepare('EXPLAIN QUERY PLAN ' + statement.query).bind(...statement.args).all()).results;
    assert.equal(plan.some(row => /CORRELATED/i.test(row.detail)), false, JSON.stringify(plan));
  }
});

for (let seed = 1; seed <= 12; seed++) {
  test(`generic flow matches an independent window/partition oracle (seed ${seed})`, async t => {
    const db = database(t);
    let state = seed;
    const pick = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * n); };
    const rows = Array.from({ length: 240 }, (_, i) => ({ seq: i + 1,
      event: ['action.requested', 'action.completed', 'action.failed'][pick(3)], session: `s${pick(6)}`,
      route: ['puzzle', 'home'][pick(2)], release: ['0.11.4', '0.11.5'][pick(2)],
      project: pick(5) ? 'alibi' : 'mdviewer',
      received: [now - DAY - 1, now - DAY, now - 1, now, now + 1][pick(5)],
    }));
    await insert(db, rows);
    const eligible = rows.filter(r => r.project === 'alibi' && r.received >= now - DAY && r.received < now);
    const groups = new Map();
    for (const r of eligible.filter(r => r.event === 'action.requested')) {
      const key = JSON.stringify([r.session, r.route, r.release]);
      if (!groups.has(key) || r.seq < groups.get(key).seq) groups.set(key, r);
    }
    const completed = [...groups.values()].filter(start => eligible.some(r => r.event === 'action.completed' &&
      r.session === start.session && r.route === start.route && r.release === start.release && r.seq > start.seq)).length;
    const result = assertPortfolio(await readPortfolio(db, { now, days: 1 })).projects.find(p => p.id === 'alibi');
    assert.ok(groups.size > 5, 'fixture must exercise several partitions');
    assert.deepEqual([result.flow.numerator, result.flow.denominator], [completed, groups.size]);
  });
}
