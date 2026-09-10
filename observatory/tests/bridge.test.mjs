import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assets } from '../src/assets.mjs';
import { makeDemo } from '../public/desk-demo.mjs';
import { parseBridge, readAtlasCatalog, readLensProjection, makePublicPulse, readLimitedJson, assertPortfolio } from '../public/desk-bridge.mjs';
const at = '2026-09-10T12:00:00.000Z', now = Date.parse(at);
const catalog = () => ({ version: 2, generator: 'CommitAtlas', source: 'github-public-rest', user: 'example-builder', generatedAt: at,
  projects: [{ repo: 'example-project', label: 'Example', lifecycle: 'active', stars: 3, forks: 0, openIssuesAndPullRequests: 7,
    ci: { state: 'passing', workflow: 'ci.yml' }, description: 'DO_NOT_RETAIN', actions: [{ url: 'https://not-fetched.invalid' }] }] });
const lens = () => ({ schema: 'pulseboard.lens-projection/1', mode: 'synthetic', reviewed: true, generatedAt: at,
  window: { start: '2026-09-01T00:00:00Z', end: at }, coverage: { eligible: 100, observed: 70, censored: 20 },
  findings: [{ id: 'delivery.shape', kind: 'hypothesis', title: 'Review delay may be worth checking', detail: 'The invented cohort has longer review intervals.', n: 50, limitations: ['Synthetic scenario. No real repository inference.'] }] });
test('CommitAtlas native v2 fields project without URLs or descriptions', () => {
  const projected = parseBridge(JSON.stringify(catalog()));
  assert.equal(projected.projects[0].repo, 'example-builder/example-project');
  assert.equal(projected.projects[0].openIssuesAndPullRequests, 7);
  assert.equal(projected.trust, 'unverified-file');
  assert.doesNotMatch(JSON.stringify(projected), /DO_NOT_RETAIN|not-fetched/);
});
test('catalogue v1, invalid CI, wrong owner, duplicate identity and negative counts fail', () => {
  for (const mutate of [x => x.version = 1, x => x.generatedAt = '2026-02-30T00:00:00Z', x => x.projects[0].ci.state = 'healthy', x => x.projects[0].repo = 'someone-else/example-project',
    x => x.projects.push(structuredClone(x.projects[0])), x => x.projects[0].stars = -1, x => delete x.projects[0].openIssuesAndPullRequests]) {
    const input = catalog(); mutate(input); assert.throws(() => readAtlasCatalog(input));
  }
});
test('catalogue missing release and unconfigured CI stay missing', () => {
  const input = catalog(); input.projects[0].ci = { state: 'unconfigured', workflow: null };
  const p = readAtlasCatalog(input).projects[0]; assert.equal(p.releaseTag, null); assert.equal(p.ci.state, 'unconfigured');
});
test('unknown or oversized import contracts fail closed', () => {
  for (const input of ['{}', '[]', '{', ' '.repeat(262145)]) assert.throws(() => parseBridge(input));
  const input = catalog(); input.projects = Array.from({ length: 65 }, () => input.projects[0]); assert.throws(() => readAtlasCatalog(input));
});
test('Lens preserves finding kinds, censoring, missingness and unverified provenance', () => {
  const result = parseBridge(JSON.stringify(lens()));
  assert.equal(result.findings[0].kind, 'hypothesis'); assert.equal(result.coverage.missing, 10);
  assert.equal(result.coverage.censored, 20); assert.equal(result.trust, 'unverified-file');
});
test('Lens rejects extra raw fields, absent review, mismatched coverage and empty limitations', () => {
  for (const mutate of [x => x.events = [], x => x.reviewed = false, x => x.coverage.observed = 90, x => x.findings[0].n = 80,
    x => x.findings[0].limitations = [], x => x.findings[0].raw = 'private', x => x.findings[0].kind = 'productivity-score']) {
    const input = lens(); mutate(input); assert.throws(() => readLensProjection(input));
  }
});
test('Lens rejects obvious URLs, local paths and credential-shaped text', () => {
  for (const text of ['https://private.invalid/repo', 'C:\\Users\\private', '/home/private/data', 'ghp_abcdef123456', 'github_pat_example']) {
    const input = lens(); input.findings[0].detail = text; assert.throws(() => readLensProjection(input));
  }
});
test('public pulse projects only selected probe fields and marks demo data', () => {
  const snapshot = makeDemo('release', { now }); snapshot.privateFinding = 'PRIVATE_SENTINEL';
  const packet = makePublicPulse(snapshot, ['alibi'], now), text = JSON.stringify(packet);
  assert.equal(packet.projects.length, 1); assert.equal(packet.sourceMode, 'demo');
  assert.equal(packet.expiresAt, now + 30 * 60000);
  assert.doesNotMatch(text, /PRIVATE_SENTINEL|sessions|releases|budget|duration|commitatlas/);
});
test('public pulse refuses empty/duplicate selections, local projects, old and future snapshots', () => {
  const snapshot = makeDemo('release', { now });
  for (const selection of [[], ['alibi', 'alibi'], ['taskdeck'], ['missing']]) assert.throws(() => makePublicPulse(snapshot, selection, now));
  assert.throws(() => makePublicPulse(snapshot, ['alibi'], now + 31 * 60000));
  assert.throws(() => makePublicPulse(snapshot, ['alibi'], now - 1));
});
test('public pulse never upgrades stale or unknown probe state', () => {
  const s = makeDemo('blind', { now }); assert.equal(makePublicPulse(s, ['alibi'], now).projects[0].probe.state, 'stale');
  s.projects[0].monitor.checked = null; assert.equal(makePublicPulse(s, ['alibi'], now).projects[0].probe.state, 'unknown');
});
test('bounded response parser rejects oversized declared and streamed bodies and invalid UTF8', async () => {
  assert.deepEqual(await readLimitedJson(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(readLimitedJson(new Response('{}', { headers: { 'Content-Length': '100' } }), 10));
  await assert.rejects(readLimitedJson(new Response(' '.repeat(100)), 10));
  await assert.rejects(readLimitedJson(new Response(new Uint8Array([255, 254]))));
});
test('real SQLite API output passes the full client contract', async t => {
  const db = openDatabase(); t.after(() => db.close()); db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const s = await readPortfolio(db, { now }); assert.equal(assertPortfolio(s), s);
});
test('malformed nested API fields cannot replace a last-good snapshot', () => {
  const valid = makeDemo('release', { now }); valid.mode = 'live'; assertPortfolio(valid);
  for (const mutate of [s => s.projects[0].daily = null, s => s.projects[0].totals.events = -1, s => s.projects[0].flow.value = 9,
    s => s.projects[0].releases[0].duration = {}, s => s.window.days = 365, s => s.projects.push(s.projects[0]), s => s.limitations = null]) {
    const copy = structuredClone(valid); mutate(copy); assert.throws(() => assertPortfolio(copy));
  }
});
test('all served desk assets exist and stay within a small static transfer budget', () => {
  const names = [...new Set([...assets.values()].map(([name]) => name))];
  const bytes = names.map(name => readFileSync(new URL(`../public/${name}`, import.meta.url)));
  assert.ok(bytes.reduce((n, b) => n + b.length, 0) < 128 * 1024, 'Desk assets exceed 128 KiB raw');
  assert.ok(bytes.reduce((n, b) => n + gzipSync(b).length, 0) < 40 * 1024, 'Desk assets exceed 40 KiB gzip');
});
