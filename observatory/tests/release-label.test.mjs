// Owner decision q-28 (2026-09-27): the collector accepts any well-formed Alibi version; other projects keep closed lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { validateEvent } from '../src/contracts.mjs';
import { validateStatCount } from '../src/stat-contract.mjs';
import { validateProductBatch } from '../src/product-contract.mjs';
import { RELEASE_PATTERN, RELEASE_ROW_LIMIT, releaseAccepted } from '../src/release-label.mjs';
import { readStatistics } from '../src/statistics.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertStatistics, VOCABULARY } from '../public/desk-usage.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { createPulseboard } from '../sdk/pulseboard-sdk.mjs';
import { buildSdk } from '../adapters/build-sdk.mjs';
import { makeRuntime, storage, settle, ORIGIN, COLLECTOR } from './sdk-fakes.mjs';

const WELL_FORMED = ['9.9.9', '1.2.3-beta.1', '0.15.0', '1234.0.1-rc-2'];
const MALFORMED = ['v1.2', '1.2', '1.2.3.4', '../x', '1'.repeat(33), '', '1.2.3-', '1.2.3-.x', '1.2.3+build', '01234.0.0', '1.2.3-' + 'a'.repeat(17), '1.0.0-A', '1.2.3-Beta.1'];

function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = DB => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi,portfolio', COLLECT_STAT_PROJECTS: 'alibi,portfolio',
  COLLECT_PRODUCT_PROJECTS: 'alibi,portfolio', READ_TOKEN: 't'.repeat(32) });
const post = (path, id, body) => new Request('https://collector.example' + path + id, { method: 'POST',
  headers: { Origin: projects[id].origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ingest = {
  session: (id, release) => post('/v1/collect/', id, { events: [{ v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq: 1,
    event: 'page.view', route: 'home', release }] }),
  counts: (id, release) => post('/v1/collect-stat/', id, { v: 1, counts: [{ event: 'page.view', route: 'home', release, n: 1 }] }),
  product: (id, release) => post('/v1/product/', id, { v: 1, session: null, release, context: { device: 'desktop' },
    events: [{ name: 'page.view', route: 'home', seq: 1, ms: 10 }] }),
};

test('the predicate: listed labels, and well-formed versions only for a releasePattern project', () => {
  assert.equal(projects.alibi.releasePattern, true);
  for (const [id, project] of Object.entries(projects)) if (id !== 'alibi') assert.notEqual(project.releasePattern, true, id);
  for (const label of ['unattributed', '0.11.6', ...WELL_FORMED]) assert.equal(releaseAccepted(projects.alibi, label), true, label);
  for (const label of [...MALFORMED, null, 9, undefined]) assert.equal(releaseAccepted(projects.alibi, label), false, String(label));
  assert.equal(releaseAccepted(projects.portfolio, 'unattributed'), true);
  for (const label of WELL_FORMED) assert.equal(releaseAccepted(projects.portfolio, label), false, label);
  assert.equal(releaseAccepted(undefined, '9.9.9'), false);
  // The flag is exact: a truthy non-boolean does not open the pattern.
  assert.equal(releaseAccepted({ releases: [], releasePattern: 'true' }, '9.9.9'), false);
});

test('the contract validators apply the same rule', () => {
  const event = release => ({ v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq: 1, event: 'page.view', route: 'home', release });
  const count = release => ({ event: 'page.view', route: 'home', release, n: 1 });
  const batch = release => ({ v: 1, session: null, release, context: { device: 'desktop' }, events: [{ name: 'a', route: 'home', seq: 1, ms: 0 }] });
  for (const label of WELL_FORMED) {
    assert.equal(validateEvent(event(label), projects.alibi), true, label);
    assert.equal(validateStatCount(count(label), projects.alibi), true, label);
    assert.equal(validateProductBatch(batch(label), projects.alibi), true, label);
    assert.equal(validateEvent(event(label), projects.portfolio), false, label);
    assert.equal(validateStatCount(count(label), projects.portfolio), false, label);
    assert.equal(validateProductBatch(batch(label), projects.portfolio), false, label);
  }
  for (const label of MALFORMED) {
    assert.equal(validateEvent(event(label), projects.alibi), false, label);
    assert.equal(validateStatCount(count(label), projects.alibi), false, label);
    assert.equal(validateProductBatch(batch(label), projects.alibi), false, label);
  }
  assert.equal(validateProductBatch(batch('unattributed')), false, 'a product batch without its project fails closed');
});

for (const [lane, request] of Object.entries(ingest)) {
  test(`${lane} ingest admits a new well-formed Alibi label and still refuses malformed ones and other projects`, async t => {
    const DB = database(t);
    for (const label of ['9.9.9', '1.2.3-beta.1']) assert.equal((await handle(request('alibi', label), env(DB))).status, 202, label);
    for (const label of MALFORMED) assert.equal((await handle(request('alibi', label), env(DB))).status, 400, JSON.stringify(label));
    assert.equal((await handle(request('portfolio', '9.9.9'), env(DB))).status, 400);
    assert.equal((await handle(request('portfolio', 'unattributed'), env(DB))).status, 202);
  });
}

test('the SDK inlines the same release pattern as the collector', () => {
  const source = readFileSync(new URL('../sdk/pulseboard-sdk.mjs', import.meta.url), 'utf8');
  const match = /^const RELEASE_PATTERN_RE = \/(.*)\/;$/m.exec(source);
  assert.ok(match, 'RELEASE_PATTERN_RE declaration');
  assert.equal(match[1], RELEASE_PATTERN.source);
});

test('an Alibi SDK built for an unregistered well-formed release sends that release on counts and product events', async () => {
  assert.equal(projects.alibi.releases.includes('9.9.9'), false);
  const baked = JSON.parse(/^const config = (\{.*\});$/m.exec(buildSdk('alibi', { release: '9.9.9' }))[1]);
  assert.equal(baked.release, '9.9.9');
  assert.equal(baked.project.releasePattern, true);
  assert.equal(JSON.parse(/^const config = (\{.*\});$/m.exec(buildSdk('portfolio'))[1]).project.releasePattern, undefined);
  assert.throws(() => buildSdk('alibi', { release: 'v9.9' }), /registered releases for alibi.*well-formed version/);
  assert.throws(() => buildSdk('portfolio', { release: '9.9.9' }), /registered releases for portfolio: unattributed$/);
  const decided = { 'pulseboard:consent:v3:alibi': JSON.stringify({ counts: true, diagnostics: true, journeys: true, decided: true, month: '2026-09' }) };
  const h = makeRuntime({ local: storage(decided) });
  const sdk = createPulseboard({ ...baked, origin: ORIGIN, collector: COLLECTOR }, h.runtime);
  sdk.mount();
  sdk.count('puzzle.started');
  assert.equal(sdk.track('puzzle.completed', { seconds: 3 }), true);
  h.fire();
  await settle();
  assert.ok(h.counts().length && h.products().length);
  assert.deepEqual([...new Set(h.counts().flatMap(call => call.body.counts.map(c => c.release)))], ['9.9.9']);
  assert.deepEqual(h.products().map(call => call.body.release), ['9.9.9']);
  // Without the flag the same unregistered label falls back to unattributed on both lanes.
  const closed = makeRuntime({ local: storage(decided) });
  const plain = createPulseboard({ ...baked, origin: ORIGIN, collector: COLLECTOR, project: { ...baked.project, releasePattern: false } }, closed.runtime);
  plain.mount(); plain.count('puzzle.started'); plain.track('puzzle.completed', {}); closed.fire(); await settle();
  assert.deepEqual([...new Set(closed.counts().flatMap(call => call.body.counts.map(c => c.release)))], ['unattributed']);
  assert.deepEqual(closed.products().map(call => call.body.release), ['unattributed']);
});

test('every label the release pattern admits is a legal Desk vocabulary word (lowercase only)', () => {
  const admitted = [...WELL_FORMED, '0.0.0', '9999.9999.9999-' + 'z'.repeat(16), '1.2.3-0.a-b.c'];
  for (const label of admitted) {
    assert.equal(releaseAccepted(projects.alibi, label), true, label);
    assert.ok(VOCABULARY.test(label), label);
  }
  // The pattern's own alphabet is digits, lowercase letters, dot and hyphen, and it starts with a digit.
  assert.doesNotMatch(RELEASE_PATTERN.source, /A-Z/);
  for (const label of ['1.0.0-A', '1.2.3-rc.X']) assert.equal(releaseAccepted(projects.alibi, label), false, label);
});

test('more than 64 distinct Alibi releases fold into one other row that the Desk readers accept', async t => {
  const DB = database(t);
  const distinct = 70, releases = Array.from({ length: distinct }, (_, i) => '1.0.' + i);
  const e = env(DB);
  const session = (release, seq, event, value) => ({ v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq, event, route: 'puzzle', release,
    ...(value === undefined ? {} : { value }) });
  for (const [index, release] of releases.entries()) {
    // 1.0.0 is heaviest; every release carries one started/completed pair and one timing.
    for (let copy = 0; copy < (index === 0 ? 3 : 1); copy++) {
      const s = crypto.randomUUID();
      const events = [{ ...session(release, 1, 'puzzle.started'), session: s }, { ...session(release, 2, 'puzzle.completed'), session: s },
        { ...session(release, 3, 'duration.ms', 100 + index), session: s }];
      assert.equal((await handle(post('/v1/collect/', 'alibi', { events }), e)).status, 202, release);
      assert.equal((await handle(ingest.counts('alibi', release), e)).status, 202, release);
    }
  }
  const now = Date.now() + 1000;
  const statistics = await readStatistics(DB, { project: 'alibi', days: 7, now });
  assert.equal(assertStatistics(statistics, 7, 'alibi'), statistics);
  assert.equal(statistics.releases.length, RELEASE_ROW_LIMIT);
  assert.deepEqual(statistics.releases.at(-1), { release: 'other', n: distinct - (RELEASE_ROW_LIMIT - 1) });
  assert.deepEqual(statistics.releases.find(row => row.release === '1.0.0'), { release: '1.0.0', n: 3 });
  assert.equal(statistics.releases.reduce((sum, row) => sum + row.n, 0), statistics.total);
  assert.equal(statistics.total, distinct + 2);

  const portfolio = await readPortfolio(DB, { now, collectionEnabled: true, admittedProjects: ['alibi'] });
  assert.equal(assertPortfolio(portfolio), portfolio);
  const alibi = portfolio.projects.find(project => project.id === 'alibi');
  assert.equal(alibi.releases.length, RELEASE_ROW_LIMIT);
  const other = alibi.releases.find(row => row.release === 'other');
  assert.equal(other.release, 'other');
  assert.equal(other.duration, null, 'a folded row never merges timings');
  assert.equal(other.events, (distinct - (RELEASE_ROW_LIMIT - 1)) * 3);
  assert.equal(alibi.releases.reduce((sum, row) => sum + row.events, 0), alibi.totals.events);
  assert.ok(alibi.releases.filter(row => row.release !== 'other').every(row => row.duration && row.duration.n >= 1));
  const [operation] = alibi.operations;
  assert.equal(operation.releases.length, RELEASE_ROW_LIMIT);
  assert.deepEqual(operation.releases.at(-1), { release: 'other', attempts: distinct - (RELEASE_ROW_LIMIT - 1),
    completed: distinct - (RELEASE_ROW_LIMIT - 1), failed: 0, open: 0, retries: 0 });
  assert.equal(operation.attempts, distinct + 2);
  assert.equal(operation.releases.find(row => row.release === '1.0.0').attempts, 3);
});
