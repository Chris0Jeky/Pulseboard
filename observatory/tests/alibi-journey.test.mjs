import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { buildSignals, makeHandoff } from '../public/desk-model.mjs';

const now = Date.UTC(2026, 8, 17, 12);
const release = '0.11.4';
const route = 'puzzle';

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}

function event({ id, session, seq, name, eventRoute = route, received }) {
  return { project: 'alibi', id, received, session, seq, event: name, route: eventRoute, release, value: null };
}

async function insert(DB, rows) {
  await DB.batch(rows.map(row => DB.prepare(`INSERT INTO events
    (project,id,received,session,seq,event,route,release,value) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(row.project, row.id, row.received, row.session, row.seq, row.event, row.route, row.release, row.value)));
}

test('Alibi registers one closed, versioned puzzle operation without identifiers', () => {
  assert.deepEqual(projects.alibi.operations, [{
    id: 'puzzle.solve',
    version: 1,
    started: 'puzzle.started',
    completed: 'puzzle.completed',
    failed: 'puzzle.failed',
  }]);
  for (const name of ['puzzle.started', 'puzzle.completed', 'puzzle.failed']) {
    assert.equal(projects.alibi.events.includes(name), true, name);
  }
});

test('named puzzle attempts reconcile retries and preserve route boundaries', async t => {
  const DB = database(t);
  const minute = 60_000;
  const sessionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sessionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sessionC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await insert(DB, [
    event({ id: '10000000-0000-4000-8000-000000000001', session: sessionA, seq: 1, name: 'puzzle.started', received: now - 12 * minute }),
    event({ id: '10000000-0000-4000-8000-000000000002', session: sessionA, seq: 2, name: 'hint.requested', received: now - 11 * minute }),
    event({ id: '10000000-0000-4000-8000-000000000003', session: sessionA, seq: 3, name: 'puzzle.failed', received: now - 10 * minute }),
    event({ id: '10000000-0000-4000-8000-000000000004', session: sessionA, seq: 4, name: 'puzzle.started', received: now - 9 * minute }),
    event({ id: '10000000-0000-4000-8000-000000000005', session: sessionA, seq: 5, name: 'puzzle.completed', received: now - 8 * minute }),
    event({ id: '20000000-0000-4000-8000-000000000001', session: sessionB, seq: 1, name: 'puzzle.started', received: now - 7 * minute }),
    event({ id: '20000000-0000-4000-8000-000000000002', session: sessionB, seq: 2, name: 'puzzle.completed', eventRoute: 'home', received: now - 6 * minute }),
    event({ id: '30000000-0000-4000-8000-000000000001', session: sessionC, seq: 1, name: 'puzzle.completed', received: now - 5 * minute }),
  ]);

  const snapshot = await readPortfolio(DB, {
    now,
    projects,
    collectionEnabled: true,
    admittedProjects: ['alibi'],
  });
  assert.equal(assertPortfolio(snapshot), snapshot);
  const alibi = snapshot.projects.find(project => project.id === 'alibi');
  assert.equal(alibi.flow.denominator, 0, 'generic paired flow remains distinct');
  assert.deepEqual(alibi.operations, [{
    id: 'puzzle.solve',
    version: 1,
    attempts: 3,
    completed: 1,
    failed: 1,
    open: 1,
    retries: 1,
    completion: { numerator: 1, denominator: 3, value: 1 / 3, interval: alibi.operations[0].completion.interval },
    releases: [{ release, attempts: 3, completed: 1, failed: 1, open: 1, retries: 1 }],
  }]);
  assert.ok(Array.isArray(alibi.operations[0].completion.interval));
});

test('small named-operation samples produce a synthetic review-only handoff', async t => {
  const DB = database(t);
  const session = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await insert(DB, [
    event({ id: '40000000-0000-4000-8000-000000000001', session, seq: 1, name: 'puzzle.started', received: now - 2_000 }),
    event({ id: '40000000-0000-4000-8000-000000000002', session, seq: 2, name: 'puzzle.failed', received: now - 1_000 }),
  ]);
  const snapshot = await readPortfolio(DB, {
    now,
    projects,
    collectionEnabled: true,
    admittedProjects: ['alibi'],
  });
  snapshot.mode = 'demo';
  const signal = buildSignals(snapshot, now).find(item => item.project === 'alibi' && item.rule === 'operation.puzzle.solve.low_sample');
  assert.ok(signal, 'low-volume operation evidence must not read as healthy');
  assert.deepEqual(signal.evidence, {
    operation: 'puzzle.solve',
    version: 1,
    attempts: 1,
    completed: 0,
    failed: 1,
    open: 0,
    retries: 0,
    minimum: 20,
  });
  const handoff = makeHandoff(snapshot, signal);
  assert.equal(handoff.mode, 'demo');
  assert.equal(handoff.destination, 'review-before-import');
  assert.equal(handoff.project, 'alibi');
  assert.match(handoff.observation, /too little evidence/i);
  assert.ok(handoff.boundaries.includes('No automatic task creation or execution.'));
});
