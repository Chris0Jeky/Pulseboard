import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { buildSignals, makeHandoff } from '../public/desk-model.mjs';
import { createAlibiJourneyReporter } from '../adapters/alibi-journey.mjs';

const token = 'j'.repeat(64);
const origin = projects.alibi.origin;
const event = (name, seq) => ({
  v: 1,
  id: crypto.randomUUID(),
  session: JOURNEY_SESSION,
  seq,
  event: name,
  route: 'puzzle',
  release: '0.11.4',
});
const JOURNEY_SESSION = crypto.randomUUID();

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}

function collectRequest(names) {
  return new Request('https://collector.test/v1/collect/alibi', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: names.map((name, index) => event(name, index + 1)) }),
  });
}

test('the host reporter emits only the closed journey vocabulary and advances on accepted events', () => {
  const events = [];
  const reporter = createAlibiJourneyReporter({
    track(name, options) {
      events.push([name, options]);
      return true;
    },
  });

  assert.equal(reporter.complete(), false, 'a terminal event needs an active attempt');
  assert.equal(reporter.start(), true);
  assert.equal(reporter.hint(), true);
  assert.equal(reporter.fail(), true);
  assert.equal(reporter.retry(), true);
  assert.equal(reporter.complete(), true);
  assert.deepEqual(events, [
    ['puzzle.started', undefined],
    ['hint.requested', undefined],
    ['puzzle.failed', undefined],
    ['puzzle.retried', undefined],
    ['puzzle.completed', undefined],
  ]);
  assert.deepEqual(reporter.status(), { state: 'completed', attempts: 2, hints: 1 });
});

test('denied tracking leaves the reporter idle and emits no follow-on journey claims', () => {
  const attempted = [];
  const reporter = createAlibiJourneyReporter({ track(name) { attempted.push(name); return false; } });
  assert.equal(reporter.start(), false);
  assert.equal(reporter.hint(), false);
  assert.equal(reporter.fail(), false);
  assert.equal(reporter.retry(), false);
  assert.equal(reporter.complete(), false);
  assert.deepEqual(attempted, ['puzzle.started']);
  assert.deepEqual(reporter.status(), { state: 'idle', attempts: 0, hints: 0 });
});

test('admitted journey events reconcile into a separate low-volume Desk aggregate and handoff', async t => {
  const DB = database(t);
  const env = { DB, READ_TOKEN: token, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi' };
  const names = ['puzzle.started', 'hint.requested', 'puzzle.failed', 'puzzle.retried', 'puzzle.completed'];
  const response = await handle(collectRequest(names), env);
  assert.equal(response.status, 202, await response.text());

  const now = Date.now() + 1;
  const snapshot = await readPortfolio(DB, {
    days: 1,
    now,
    collectionEnabled: true,
    admittedProjects: ['alibi'],
  });
  assert.equal(assertPortfolio(snapshot), snapshot);
  const alibi = snapshot.projects.find(project => project.id === 'alibi');
  assert.deepEqual(alibi.journey, {
    schema: 'pulseboard.named-journey/1',
    id: 'puzzle',
    label: 'Puzzle attempt',
    attempts: { initial: 1, retries: 1, total: 2 },
    outcomes: { completed: 1, failed: 1, open: 0, orphaned: 0 },
    hints: 1,
    completion: { numerator: 1, denominator: 2, value: 0.5, interval: assert.any(Array) },
    limitations: assert.any(Array),
  });
  assert.match(alibi.journey.limitations.join(' '), /client-reported/i);
  assert.match(alibi.journey.limitations.join(' '), /puzzle identit/i);

  const signals = buildSignals(snapshot, now);
  const lowVolume = signals.find(signal => signal.project === 'alibi' && signal.rule === 'journey.low_volume');
  const failure = signals.find(signal => signal.project === 'alibi' && signal.rule === 'journey.failure');
  assert.ok(lowVolume, 'two attempts must not be presented as healthy journey evidence');
  assert.ok(failure, 'the reported failed attempt must remain visible');
  assert.equal(failure.evidence.attempts, 2);
  assert.equal(failure.evidence.failed, 1);

  const handoff = makeHandoff(snapshot, failure);
  assert.equal(handoff.schema, 'pulseboard.handoff/1');
  assert.equal(handoff.project, 'alibi');
  assert.equal(JSON.stringify(handoff).includes(JOURNEY_SESSION), false);
  assert.match(handoff.observation, /client-reported|reported/i);
});

test('disabled collection admits no journey event or budget usage', async t => {
  const DB = database(t);
  const response = await handle(collectRequest(['puzzle.started']), {
    DB,
    COLLECT_ENABLED: 'false',
    COLLECT_PROJECTS: 'alibi',
  });
  assert.equal(response.status, 503);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM events').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM budget').first()).n, 0);
});
