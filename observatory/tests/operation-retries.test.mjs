import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 7, 12);
const names = { start: 'puzzle.started', completed: 'puzzle.completed', failed: 'puzzle.failed' };

async function operation(t, rows) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  await db.batch(rows.map((row, index) => {
    const entry = typeof row === 'string' ? { event: row } : row;
    return db.prepare(`INSERT INTO events(project,id,received,session,seq,event,route,release,value)
      VALUES(?,?,?,?,?,?,?,?,NULL)`).bind('alibi', randomUUID(), entry.received ?? now - 1000,
      entry.session ?? 'one-session', entry.seq ?? index + 1, names[entry.event],
      entry.route ?? 'puzzle', entry.release ?? '0.11.4');
  }));
  const snapshot = assertPortfolio(await readPortfolio(db, { now, days: 1, collectionEnabled: true, admittedProjects: ['alibi'] }));
  return snapshot.projects.find(project => project.id === 'alibi').operations[0];
}

for (const [label, rows, expected] of [
  ['new puzzle after success is not a retry', ['start', 'completed', 'start', 'completed'], [2, 2, 0, 0, 0]],
  ['start after failure is a retry candidate', ['start', 'failed', 'start', 'completed'], [2, 1, 1, 0, 1]],
  ['start after an unresolved attempt is a retry candidate', ['start', 'start', 'completed'], [2, 1, 0, 1, 1]],
  ['success resets a sequence of retry candidates', ['start', 'failed', 'start', 'completed', 'start', 'failed', 'start'], [4, 1, 2, 1, 2]],
  ['each later unresolved start counts once', ['start', 'start', 'start'], [3, 0, 0, 3, 2]],
  ['only the first terminal resolves the prior attempt', ['start', 'completed', 'failed', 'start'], [2, 1, 0, 1, 0]],
]) {
  test(`named operation: ${label}`, async t => {
    const result = await operation(t, rows);
    assert.deepEqual(['attempts', 'completed', 'failed', 'open', 'retries'].map(key => result[key]), expected);
    assert.equal(result.completion.denominator, result.attempts);
    assert.equal(result.completion.numerator, result.completed);
    for (const key of ['attempts', 'completed', 'failed', 'open', 'retries']) {
      assert.equal(result.releases.reduce((sum, row) => sum + row[key], 0), result[key]);
    }
  });
}

for (const [boundary, changed] of [
  ['session', { session: 'other-session' }],
  ['route', { route: 'home' }],
  ['release', { release: '0.11.5' }],
]) {
  test(`retry candidates do not cross the ${boundary} boundary`, async t => {
    const result = await operation(t, ['start', 'failed', { event: 'start', ...changed }]);
    assert.equal(result.attempts, 2);
    assert.equal(result.retries, 0);
  });
}

test('retry candidates use only starts inside the half-open reporting window', async t => {
  const result = await operation(t, [
    { event: 'start', received: now - DAY - 2 },
    { event: 'failed', received: now - DAY - 1 },
    { event: 'start', received: now - DAY },
    { event: 'completed', received: now - 1 },
    { event: 'start', received: now },
  ]);
  assert.deepEqual([result.attempts, result.completed, result.open, result.retries], [1, 1, 0, 0]);
});
