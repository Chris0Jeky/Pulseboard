import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubEvidence, readGithubMap, githubUrl } from '../src/github.mjs';
import { githubMap } from '../src/github-map.mjs';
import { handle } from '../src/worker.mjs';
import { assets } from '../src/assets.mjs';
import { makeDemo, makeGithubDemo } from '../public/desk-demo.mjs';
import { assertGithubEvidence, deploymentLeads, pinInvestigation, makeReleaseNote, releaseNoteMarkdown } from '../public/desk-release.mjs';
// Inline fixtures and a fake fetch router: no test here reaches the network.
const at = Date.UTC(2026, 8, 10, 12), HOUR = 3600000;
const TOKEN = 'ghp_TOKENSENTINEL0123456789abcdef', READ = 'desk-read-token-for-tests-only-0000000000';
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const sha = c => c.repeat(40);
const workflow = (id = 11, file = 'ci') => ({ workflowId: id, path: `.github/workflows/${file}.yml`, branch: 'main', role: 'ci' });
const map = (repo = {}) => ({ schema: 'pulseboard.github-map/1', revision: 3, reviewedAt: '2026-09-10', projects: { alibi: [{ repositoryId: 101, repository: 'example/alibi',
  workflows: [workflow()], environments: [{ name: 'production' }], releases: { max: 2 }, ...repo }] } });
const run = (o = {}) => ({ id: 501, run_attempt: 1, workflow_id: 11, path: '.github/workflows/ci.yml', head_branch: 'main', head_sha: sha('a'), status: 'completed',
  conclusion: 'success', updated_at: iso(at - HOUR), name: 'DO_NOT_RETAIN', html_url: 'https://github.com/example/alibi/actions/runs/501', ...o });
const RUNS = '/repositories/101/actions/workflows/11/runs?branch=main&per_page=5&exclude_pull_requests=true';
const routes = (o = {}) => ({
  '/repositories/101': () => ({ id: 101, full_name: 'example/alibi', description: 'DO_NOT_RETAIN' }),
  [RUNS]: () => ({ total_count: 1, workflow_runs: [run()] }),
  '/repositories/101/deployments?environment=production&per_page=1': () => [{ id: 71, sha: sha('b'), environment: 'production', created_at: iso(at - 2 * HOUR), payload: { secret: 'DO_NOT_RETAIN' } }],
  '/repositories/101/deployments/71/statuses?per_page=1': () => [{ state: 'success', created_at: iso(at - 2 * HOUR + 60000) }],
  '/repositories/101/releases?per_page=10': () => [{ id: 9, tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: iso(at - 24 * HOUR), body: 'DO_NOT_RETAIN' }],
  ...o });
const ok = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', etag: '"v1"',
  'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': String(at / 1000 + HOUR / 1000), ...headers } });
function setup({ table = {}, repo, limits, cache, token = TOKEN, mapping } = {}) {
  const calls = [], clock = { t: at }, all = routes(table);
  const fetch = async (href, init) => {
    calls.push({ href, init }); const url = new URL(href), handler = all[url.pathname + url.search];
    const out = handler ? handler(init, url) : new Response('{"message":"Not Found"}', { status: 404 });
    return out instanceof Response ? out : ok(out);
  };
  const gh = createGithubEvidence({ map: mapping ?? map(repo), token, fetch, now: () => clock.t, cache, limits });
  return { gh, calls, clock, read: () => gh.read('alibi') };
}
const first = e => e.repositories[0];
test('the shipped mapping is valid, reviewed and empty until the owner maps a project', () => {
  assert.deepEqual(readGithubMap(githubMap).projects, {});
  assert.ok(Object.isFrozen(readGithubMap(map()).projects.alibi[0].workflows[0]));
});
test('mapping fails closed on extra fields, unknown projects, name-only workflows, double claims, renamed ids and bounds', () => {
  const mutations = [m => { m.extra = 1; }, m => { m.projects.alibi[0].note = 'x'; }, m => { m.projects.nope = m.projects.alibi; }, m => { m.projects.alibi[0].workflows[0].extra = 1; },
    m => { delete m.projects.alibi[0].workflows[0].workflowId; }, m => { m.projects.alibi[0].workflows[0].workflowId = '11'; },
    m => { m.projects.alibi[0].workflows = [{ name: 'CI', path: '.github/workflows/ci.yml', branch: 'main', role: 'ci' }]; },
    m => { m.projects.alibi[0].workflows.push(workflow(11, 'again')); },
    m => { m.projects.mdviewer = [{ ...structuredClone(m.projects.alibi[0]), repository: 'example/other', workflows: [] }]; },
    m => { m.projects.alibi = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(m.projects.alibi[0]), repositoryId: 200 + i, workflows: [] })); },
    m => { m.projects.alibi[0].workflows = [1, 2, 3, 4, 5].map(i => workflow(i, `w${i}`)); },
    m => { m.projects.alibi[0].environments = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]; }, m => { m.projects.alibi[0].environments = [{ name: 'a' }, { name: 'a' }]; },
    m => { m.projects.alibi[0].releases.max = 11; }, m => { m.reviewedAt = '2026-02-30'; }, m => { m.projects.alibi[0].workflows[0].path = 'ci.yml'; },
    m => { m.projects.alibi[0].workflows[0].branch = 'main/../x'; }, m => { m.projects.alibi[0].repository = 'https://github.com/example/alibi'; },
    m => { m.projects.alibi = []; }, m => { m.schema = 'pulseboard.github-map/2'; }];
  for (const mutate of mutations) { const m = map(); mutate(m); assert.throws(() => readGithubMap(m), undefined, mutate.toString()); }
  const shared = map(); shared.projects.mdviewer = [{ ...structuredClone(shared.projects.alibi[0]), workflows: [workflow(12, 'other')] }];
  assert.equal(readGithubMap(shared).projects.mdviewer[0].repositoryId, 101);
});
test('without a token or a mapping every item is unconfigured and fetch is never called', async () => {
  const { gh, calls, read } = setup({ token: null });
  const e = await read();
  assert.equal(e.configuration, 'no-token'); assert.equal(first(e).state, 'unconfigured');
  for (const i of [...first(e).workflows, ...first(e).environments, first(e).releases]) { assert.equal(i.state, 'unconfigured'); assert.equal(i.reason, 'no-server-token'); }
  const unmapped = await gh.read('mdviewer');
  assert.equal(unmapped.configuration, 'unmapped'); assert.deepEqual(unmapped.repositories, []); assert.equal(calls.length, 0);
});
test('passing, failing, pending and inconclusive runs keep identity, source time and observation time', async () => {
  for (const [o, state, reason] of [[{}, 'passing', 'success'], [{ conclusion: 'failure' }, 'failing', 'failure'], [{ conclusion: 'timed_out' }, 'failing', 'timed_out'],
    [{ conclusion: 'startup_failure' }, 'failing', 'startup_failure'], [{ status: 'in_progress', conclusion: null }, 'pending', 'in_progress'], [{ status: 'queued', conclusion: null }, 'pending', 'queued'],
    [{ conclusion: 'cancelled' }, 'inconclusive', 'cancelled'], [{ conclusion: 'skipped' }, 'inconclusive', 'skipped'], [{ conclusion: 'neutral' }, 'inconclusive', 'neutral'],
    [{ conclusion: 'constructor' }, 'inconclusive', 'constructor']]) {
    const { read, calls } = setup({ table: { [RUNS]: () => ({ workflow_runs: [run({ run_attempt: 2, ...o })] }) } });
    const w = first(await read()).workflows[0];
    assert.equal(w.state, state); assert.equal(w.reason, reason); assert.equal(w.observedAt, at); assert.equal(w.sourceTime, at - HOUR);
    assert.deepEqual(w.target, workflow());
    assert.deepEqual({ runId: w.evidence.runId, runAttempt: w.evidence.runAttempt, headSha: w.evidence.headSha }, { runId: 501, runAttempt: 2, headSha: sha('a') });
    for (const { href, init } of calls) {
      assert.ok(href.startsWith('https://api.github.com/repositories/101')); assert.equal(init.redirect, 'manual'); assert.ok(!('credentials' in init));
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    }
  }
  const { read } = setup(), e = await read(), env = first(e).environments[0];
  assert.equal(env.state, 'passing'); assert.deepEqual(env.evidence, { deploymentId: 71, sha: sha('b'), environment: 'production', createdAt: at - 2 * HOUR, status: 'success' });
  assert.equal(first(e).releases.state, 'observed'); assert.equal(first(e).releases.evidence.releases[0].tag, 'v1.0.0');
  assert.doesNotMatch(JSON.stringify(e), /DO_NOT_RETAIN|html_url|github\.com\/example/);
});
test('a newer run from another workflow is discarded, zero runs is missing and there is no repository-wide CI field', async () => {
  const other = run({ id: 600, workflow_id: 99, path: '.github/workflows/other.yml', conclusion: 'failure', updated_at: iso(at - 60000) });
  let e = await setup({ table: { [RUNS]: () => ({ workflow_runs: [other, run({ id: 601, head_branch: 'feature', conclusion: 'failure' }), run()] }) } }).read();
  assert.equal(first(e).workflows[0].state, 'passing'); assert.equal(first(e).workflows[0].evidence.runId, 501);
  assert.ok(!('ci' in first(e)) && !('ci' in e));
  e = await setup({ table: { [RUNS]: () => ({ workflow_runs: [] }) } }).read();
  assert.deepEqual([first(e).workflows[0].state, first(e).workflows[0].reason, first(e).workflows[0].evidence], ['missing', 'no-runs', null]);
  e = await setup({ table: { [RUNS]: () => ({ workflow_runs: [other] }) } }).read();
  assert.equal(first(e).workflows[0].reason, 'no-matching-run');
});
test('a renamed repository is flagged and a redirect is never followed', async () => {
  let e = await setup({ table: { '/repositories/101': () => ({ id: 101, full_name: 'example/alibi-next' }) } }).read();
  assert.deepEqual(first(e).renamed, { mapped: 'example/alibi', observed: 'example/alibi-next' });
  const { read, calls } = setup({ table: { '/repositories/101': () => new Response(null, { status: 301, headers: { location: 'https://elsewhere.invalid/x' } }) } });
  e = await read();
  assert.deepEqual([first(e).state, first(e).reason], ['unavailable', 'redirect']);
  assert.equal(first(e).workflows[0].reason, 'redirect'); assert.equal(calls.length, 1);
  assert.ok(calls.every(c => c.href.startsWith('https://api.github.com/')));
  assert.throws(() => githubUrl(101, '@elsewhere.invalid')); assert.throws(() => githubUrl('101/../1'));
});
test('304 with If-None-Match reuses the projection: observation advances, source time stays, budget still spent', async () => {
  let conditional = 0;
  const { read, calls, clock } = setup({ limits: { minRefreshMs: 0 }, table: { [RUNS]: init => init.headers['If-None-Match'] === '"v1"' ? (conditional++, new Response(null, { status: 304 })) : { workflow_runs: [run()] } } });
  await read(); clock.t = at + 5 * 60000; const before = calls.length;
  const w = first(await read()).workflows[0];
  assert.equal(conditional, 1); assert.equal(w.state, 'passing'); assert.equal(w.sourceTime, at - HOUR); assert.equal(w.observedAt, at + 5 * 60000);
  assert.equal(calls.length - before, 5);
});
test('rate limits pause every request until reset; a plain 403 is forbidden', async () => {
  const limited = new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(at / 1000 + 600) } });
  let s = setup({ limits: { minRefreshMs: 0 }, table: { '/repositories/101': () => limited } });
  let e = await s.read();
  assert.deepEqual([first(e).state, first(e).workflows[0].state, first(e).workflows[0].resetAt], ['rate-limited', 'rate-limited', at + 600000]);
  const count = s.calls.length; s.clock.t = at + 300000; e = await s.read();
  assert.equal(s.calls.length, count); assert.equal(first(e).releases.state, 'rate-limited');
  s.clock.t = at + 600001; await s.read(); assert.ok(s.calls.length > count);
  s = setup({ table: { [RUNS]: () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }) } });
  e = await s.read();
  assert.deepEqual([first(e).workflows[0].state, first(e).workflows[0].resetAt], ['rate-limited', at + 60000]);
  assert.equal(first(e).environments[0].state, 'rate-limited'); assert.equal(s.calls.length, 2);
  e = await setup({ table: { '/repositories/101': () => new Response('{}', { status: 403 }) } }).read();
  assert.deepEqual([first(e).state, first(e).reason], ['unavailable', 'forbidden']);
  s = setup({ limits: { minRefreshMs: 0 }, table: { '/repositories/101': () => ok({ id: 101, full_name: 'example/alibi' }, { 'x-ratelimit-remaining': '10' }) } });
  e = await s.read();
  assert.equal(first(e).state, 'observed'); assert.deepEqual([first(e).workflows[0].state, first(e).workflows[0].reason], ['rate-limited', 'rate-floor']); assert.equal(s.calls.length, 1);
});
test('404 and 401 stay distinct', async () => {
  let e = await setup({ table: { '/repositories/101': () => new Response('{}', { status: 404 }) } }).read();
  assert.deepEqual([first(e).state, first(e).reason, first(e).workflows[0].state], ['missing', 'not-found-or-no-access', 'missing']);
  e = await setup({ table: { '/repositories/101': () => new Response('{}', { status: 401 }) } }).read();
  assert.deepEqual([first(e).state, first(e).reason, first(e).workflows[0].reason], ['unavailable', 'credential-rejected', 'credential-rejected']);
});
test('pagination stops at maxPages with truncated, and refuses foreign or malformed Link headers', async () => {
  const other = run({ id: 600, workflow_id: 99, path: '.github/workflows/other.yml' });
  const page = n => `<https://api.github.com${RUNS}&page=${n}>; rel="next", <https://api.github.com${RUNS}&page=9>; rel="last"`;
  const s = setup({ table: { [RUNS]: () => ok({ workflow_runs: [other] }, { link: page(2) }), [`${RUNS}&page=2`]: () => ok({ workflow_runs: [other] }, { link: page(3) }) } });
  const w = first(await s.read()).workflows[0];
  assert.deepEqual([w.state, w.reason, w.truncated], ['missing', 'no-matching-run', true]);
  assert.equal(s.calls.filter(c => c.href.includes('/runs')).length, 2);
  for (const link of [`<https://elsewhere.invalid${RUNS}&page=2>; rel="next"`, '<https://api.github.com/repositories/102/actions/workflows/11/runs?page=2>; rel="next"',
    `<https://api.github.com/repositories/101/releases?page=2>; rel="next"`, 'garbage', `<http://api.github.com${RUNS}&page=2>; rel="next"`]) {
    const t = setup({ table: { [RUNS]: () => ok({ workflow_runs: [other] }, { link }) } });
    const x = first(await t.read()).workflows[0];
    assert.deepEqual([x.state, x.reason], ['unavailable', 'malformed'], link);
    assert.ok(t.calls.every(c => c.href.startsWith('https://api.github.com/repositories/101')));
  }
});
test('empty or draft-only releases are missing, not "no release"', async () => {
  for (const body of [[], [{ id: 3, tag_name: 'draft', draft: true, prerelease: false, published_at: null }]]) {
    const r = first(await setup({ table: { '/repositories/101/releases?per_page=10': () => body } }).read()).releases;
    assert.deepEqual([r.state, r.reason, r.evidence], ['missing', 'none-returned', null]);
  }
  assert.equal(first(await setup({ repo: { releases: { max: 0 } } }).read()).releases.state, 'unconfigured');
});
test('failed refresh, an old cached observation and a future timestamp are stale with last-known evidence', async () => {
  let fail = false;
  const s = setup({ limits: { minRefreshMs: 0 }, table: { '/repositories/101': () => fail ? new Response('{}', { status: 502 }) : ({ id: 101, full_name: 'example/alibi' }) } });
  await s.read(); fail = true; s.clock.t = at + 60000;
  let e = await s.read(), w = first(e).workflows[0];
  assert.deepEqual([first(e).state, w.state, w.reason, w.observedAt, w.sourceTime, w.evidence], ['unavailable', 'stale', 'upstream-error', null, null, null]);
  assert.deepEqual([w.lastKnown.state, w.lastKnown.observedAt, w.lastKnown.evidence.runId], ['passing', at, 501]);
  const old = setup({ limits: { minRefreshMs: 24 * HOUR } });
  await old.read(); old.clock.t = at + 7 * HOUR; const count = old.calls.length;
  w = first(await old.read()).workflows[0];
  assert.deepEqual([w.state, w.reason, w.lastKnown.state, old.calls.length], ['stale', 'old-observation', 'passing', count]);
  w = first(await setup({ table: { [RUNS]: () => ({ workflow_runs: [run({ updated_at: iso(at + 2 * HOUR) })] }) } }).read()).workflows[0];
  assert.deepEqual([w.state, w.reason, w.lastKnown.sourceTime], ['stale', 'future-dated', at + 2 * HOUR]);
});
test('the request budget and the refresh floor bound egress per read', async () => {
  const s = setup({ limits: { maxRequests: 3 }, repo: { workflows: [workflow(11), workflow(12, 'b'), workflow(13, 'c'), workflow(14, 'd')] } });
  const e = await s.read();
  assert.equal(s.calls.length, 3);
  assert.deepEqual(first(e).workflows.map(w => w.reason), ['success', 'not-found-or-no-access', 'request-budget', 'request-budget']);
  assert.equal(first(e).environments[0].reason, 'request-budget'); assert.equal(first(e).releases.reason, 'request-budget');
  const again = await s.read();
  assert.equal(s.calls.length, 3); assert.equal(first(again).workflows[0].state, 'passing');
});
test('overlapping reads on a cold connector share one refresh instead of reading the empty floor', async () => {
  const { gh, calls } = setup();
  const [a, b] = await Promise.all([gh.read('alibi'), gh.read('alibi')]);
  assert.equal(a, b);
  assert.equal(first(a).workflows[0].state, 'passing');
  assert.equal(calls.length, 5);
  const later = await gh.read('alibi');
  assert.equal(first(later).workflows[0].state, 'passing'); assert.equal(calls.length, 5);
});
test('oversized bodies, non-hex SHAs and non-canonical times are rejected as malformed', async () => {
  for (const table of [{ [RUNS]: () => ({ workflow_runs: [run({ name: 'x'.repeat(5000) })] }) }, { [RUNS]: () => ({ workflow_runs: [run({ head_sha: 'A'.repeat(40) })] }) },
    { [RUNS]: () => ({ workflow_runs: [run({ head_sha: 'abc' })] }) }, { [RUNS]: () => ({ workflow_runs: [run({ updated_at: '2026-09-10T12:00:00.5Z' })] }) },
    { [RUNS]: () => ({ workflow_runs: [run({ updated_at: '2026-09-10 12:00:00' })] }) }, { [RUNS]: () => new Response('not json', { status: 200 }) }]) {
    const w = first(await setup({ table, limits: { maxBytes: 4096 } }).read()).workflows[0];
    assert.deepEqual([w.state, w.reason], ['unavailable', 'malformed']);
  }
});
test('the token never appears in responses, cache keys, cached values, notes or errors', async () => {
  const cache = new Map(), s = setup({ cache, limits: { minRefreshMs: 0 } });
  const outputs = [await s.read()];
  s.clock.t += 60000; outputs.push(await s.read());
  const failing = setup({ cache, table: { '/repositories/101': () => new Response('{}', { status: 401 }) } }); outputs.push(await failing.read());
  const snapshot = makeDemo('release', { now: at }); snapshot.mode = 'live';
  const pin = pinInvestigation(snapshot, outputs[0], 'alibi', at);
  const note = makeReleaseNote(pin, { suspected: 'The release may have slowed checkout.', alternativeCheck: 'Compare the route mix before and after.' }, at);
  const text = JSON.stringify([outputs, [...cache.keys()], [...cache.values()], note]) + releaseNoteMarkdown(note);
  assert.ok(!text.includes(TOKEN) && !text.includes('TOKENSENTINEL')); assert.ok(cache.size > 0);
  const bad = 'bad token with spaces 0123456789';
  assert.throws(() => createGithubEvidence({ map: map(), token: bad }), error => !error.message.includes(bad));
  for (const limits of [{ maxPages: 0 }, { maxRequests: -1 }, { maxBytes: Infinity }]) assert.throws(() => createGithubEvidence({ map: map(), limits }));
  const error = await s.gh.read('alibi').then(() => null, x => x);
  assert.equal(error, null);
});
test('the ETag cache is bounded and insertion-ordered', async () => {
  const cache = new Map(), s = setup({ cache, limits: { maxCache: 3 } });
  await s.read();
  assert.equal(cache.size, 3); assert.deepEqual([...cache.keys()].at(-1), '/repositories/101/releases?per_page=10');
});
test('the route authenticates before reading, rejects bad project parameters and never caches', async () => {
  let reads = 0;
  const env = { READ_TOKEN: READ, GITHUB_EVIDENCE: { read: async id => { reads++; return (await setup({ token: null }).gh.read(id)); } } };
  const get = (query, auth = `Bearer ${READ}`) => handle(new Request(`https://desk.test/v1/github-evidence${query}`, { headers: auth ? { authorization: auth } : {} }), env);
  assert.equal((await get('?project=alibi', null)).status, 401); assert.equal((await get('?project=alibi', 'Bearer wrong')).status, 401); assert.equal(reads, 0);
  for (const query of ['', '?project=', '?project=nope', '?project=alibi&project=alibi', '?project=alibi&days=7', '?project=__proto__']) assert.equal((await get(query)).status, 400, query);
  assert.equal(reads, 0);
  const response = await get('?project=alibi');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.equal(assertGithubEvidence(body), body); assert.equal(body.configuration, 'no-token');
  const original = globalThis.fetch; let egress = 0; globalThis.fetch = async () => { egress++; throw new Error('no egress'); };
  try {
    const fallback = await handle(new Request('https://desk.test/v1/github-evidence?project=alibi', { headers: { authorization: `Bearer ${READ}` } }), { READ_TOKEN: READ });
    const e = await fallback.json();
    assert.equal(fallback.status, 200); assert.equal(e.configuration, 'unmapped'); assert.deepEqual(e.repositories, []); assert.equal(egress, 0);
  } finally { globalThis.fetch = original; }
  assert.ok(assets.has('/desk-release.mjs'));
});
test('the evidence contract fails closed', async () => {
  const valid = await setup().read();
  assertGithubEvidence(structuredClone(valid)); assertGithubEvidence(makeGithubDemo(makeDemo('release', { now: at }), 'alibi'));
  for (const mutate of [e => { e.extra = 1; }, e => { e.mode = 'production'; }, e => { e.repositories[0].ci = 'passing'; }, e => { e.repositories[0].workflows[0].state = 'healthy'; },
    e => { e.repositories[0].workflows[0].state = 'stale'; }, e => { e.repositories[0].workflows[0].evidence = null; }, e => { e.repositories[0].workflows[0].evidence.headSha = 'abc'; },
    e => { e.configuration = 'no-token'; }, e => { e.configuration = 'unmapped'; }, e => { e.repositories[0].workflows[0].state = 'rate-limited'; },
    e => { e.repositories[0].releases.state = 'passing'; }, e => { e.repositories[0].workflows[0].state = 'observed'; }, e => { e.repositories[0].renamed = { mapped: 'x/y', observed: 'x/z' }; },
    e => { e.repositories[0].workflows[0].evidence.token = TOKEN; }, e => { e.repositories[0].workflows[0].lastKnown = e.repositories[0].workflows[0]; },
    e => { e.repositories = Array(5).fill(e.repositories[0]); }]) {
    const copy = structuredClone(valid); mutate(copy); assert.throws(() => assertGithubEvidence(copy), undefined, mutate.toString());
  }
});
test('deployment leads say proximity, not cause, and come before plain context', () => {
  const snapshot = makeDemo('release', { now: at }), monitor = snapshot.projects[0].monitor, e = structuredClone(makeGithubDemo(snapshot, 'alibi'));
  const env = e.repositories[0].environments[0];
  e.repositories[0].environments.push({ ...structuredClone(env), target: { name: 'staging' }, evidence: { ...env.evidence, environment: 'staging', createdAt: monitor.opened - 3 * 86400000 } });
  const leads = deploymentLeads(assertGithubEvidence(e), snapshot);
  assert.deepEqual(leads.map(l => [l.kind, l.relation, l.environment]), [['lead', 'before-monitor-opened', 'production'], ['context', null, 'staging']]);
  assert.equal(leads[0].text, 'Temporal proximity, not a cause.');
  e.repositories[0].environments[1].evidence.createdAt = monitor.opened + 60000;
  assert.deepEqual(deploymentLeads(e, snapshot).map(l => l.relation), ['inside-failure-window', 'before-monitor-opened']);
  const quiet = makeDemo('release', { now: at, phase: 0 });
  assert.deepEqual(deploymentLeads(makeGithubDemo(quiet, 'alibi'), quiet).map(l => l.kind), ['context']);
});
test('the notebook pins an immutable copy and needs both operator fields before writing a note', () => {
  const snapshot = makeDemo('release', { now: at }), evidence = makeGithubDemo(snapshot, 'alibi'), pin = pinInvestigation(snapshot, evidence, 'alibi', at);
  assert.throws(() => { pin.evidence.repositories[0].workflows[0].state = 'passing'; }); assert.throws(() => { pin.leads.push({}); });
  evidence.repositories[0].workflows[0].reason = 'changed-after-pin'; assert.equal(pin.evidence.repositories[0].workflows[0].reason, 'success');
  assert.deepEqual([pin.rules, pin.mapping.revision, typeof pin.snapshot.fingerprint], [{ desk: 'desk-rules/1', github: 'github-evidence/1' }, 1, 'string']);
  const good = { suspected: 'The deploy may have caused the probe failures.', alternativeCheck: 'Check the hosting incident log and the probe target first.' };
  for (const input of [{ suspected: good.suspected }, { ...good, alternativeCheck: '   ' }, { ...good, alternativeCheck: 'See https://example.invalid/log' },
    { ...good, suspected: 'token ghp_abcdef' }, { ...good, suspected: 'x'.repeat(501) }, { ...good, extra: 'x' }]) assert.throws(() => makeReleaseNote(pin, input, at));
  assert.throws(() => makeReleaseNote({ ...pin }, good, at));
  const live = structuredClone(snapshot); live.mode = 'live';
  assert.throws(() => pinInvestigation(live, evidence, 'alibi', at)); assert.throws(() => pinInvestigation(snapshot, evidence, 'mdviewer', at));
  const note = makeReleaseNote(pin, { ...good, alternativeCheck: 'Check the hosting\nincident log.' }, at + 1), md = releaseNoteMarkdown(note);
  assert.deepEqual([note.schema, note.status, note.mode, note.alternativeCheck], ['pulseboard.release-note/1', 'lead, not proof', 'demo', 'Check the hosting incident log.']);
  assert.match(note.retention, /Tab memory only.*Nothing is stored on the server/);
  assert.equal(note.snapshot.fingerprint, pin.snapshot.fingerprint); assert.equal(note.rules.github, 'github-evidence/1');
  for (const text of ['a lead, not proof', 'SYNTHETIC DEMO', 'Temporal proximity, not a cause.', 'desk-rules/1', 'mapping revision 1', 'last known failing', note.retention]) assert.ok(md.includes(text), text);
});
