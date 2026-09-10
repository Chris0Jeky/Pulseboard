/** Bounded, local-only ecosystem adapters. Imported claims are not authenticated evidence. */
import { monitorState, STALE_AFTER } from './desk-model.mjs';
export const BRIDGE_MAX_BYTES = 262144;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
const boundedString = (value, max = 160) => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), 'Invalid bounded text');
  return value;
};
const integer = value => { requireValue(Number.isSafeInteger(value) && value >= 0, 'Invalid count'); return value; };
const isoTime = value => {
  boundedString(value, 32);
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid UTC timestamp');
  const stamp = Date.parse(value);
  requireValue(new Date(stamp).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z'), 'Non-canonical UTC timestamp');
  return stamp;
};
const exactKeys = (value, keys) => requireValue(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Unexpected projection fields');
const list = (value, max) => { requireValue(Array.isArray(value) && value.length <= max, 'Array limit'); return value; };
const unique = values => requireValue(new Set(values).size === values.length, 'Duplicate identity');
const safeFindingText = value => {
  boundedString(value, 500);
  requireValue(!/(?:https?:\/\/|github_pat_|gh[pousr]_[A-Za-z0-9]|sk-[A-Za-z0-9]|[A-Za-z]:[\\/]|\/(?:Users|home)\/)/.test(value), 'Projection contains a URL, path or credential-shaped text');
  return value;
};
const ciStates = ['unavailable', 'unconfigured', 'stale', 'passing', 'failing', 'pending'];
const lifecycles = ['planned', 'active', 'maintained', 'paused', 'archived', 'experimental'];
export function parseBridge(text) {
  requireValue(typeof text === 'string' && new TextEncoder().encode(text).length <= BRIDGE_MAX_BYTES, 'Import exceeds 256 KiB');
  const input = JSON.parse(text);
  requireValue(plain(input), 'Expected a JSON object');
  if (input.generator === 'CommitAtlas') return readAtlasCatalog(input);
  if (input.schema === 'pulseboard.lens-projection/1') return readLensProjection(input);
  throw new TypeError('Use a CommitAtlas v2 projects.json or pulseboard.lens-projection/1 file');
}
export function readAtlasCatalog(input) {
  requireValue(input.version === 2 && input.generator === 'CommitAtlas' && input.source === 'github-public-rest', 'Unsupported CommitAtlas catalogue version or source');
  const user = boundedString(input.user, 39);
  requireValue(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(user), 'Invalid catalogue owner');
  const generatedAt = isoTime(input.generatedAt);
  const projects = list(input.projects, 64).map(project => {
    requireValue(plain(project) && plain(project.ci), 'Invalid catalogue project');
    const raw = boundedString(project.repo, 140), repo = raw.includes('/') ? raw : `${user}/${raw}`;
    const parts = repo.split('/');
    requireValue(parts.length === 2 && parts[0].toLowerCase() === user.toLowerCase() && /^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) && !['.', '..'].includes(parts[1]), 'Invalid or mismatched repository identity');
    requireValue(lifecycles.includes(project.lifecycle) && ciStates.includes(project.ci.state), 'Unknown lifecycle or CI state');
    return { repo, label: boundedString(project.label, 80), lifecycle: project.lifecycle,
      ci: { state: project.ci.state, workflow: project.ci.workflow === null ? null : boundedString(project.ci.workflow, 80) },
      releaseTag: project.release === undefined ? null : boundedString(project.release?.tag, 160),
      stars: integer(project.stars), forks: integer(project.forks), openIssuesAndPullRequests: integer(project.openIssuesAndPullRequests) };
  });
  unique(projects.map(p => p.repo.toLowerCase()));
  // URLs, descriptions, download actions, identity metadata and unknown fields do not survive projection.
  return { kind: 'commitatlas', schema: 'pulseboard.atlas-context/1', trust: 'unverified-file', generatedAt, projects,
    limitations: ['This is an imported claim, not a live GitHub check.', 'Catalogue time is not the exact CI observation time.', 'CI is not product availability. Missing release data means not supplied, not no release.'] };
}
export function readLensProjection(input) {
  exactKeys(input, ['schema', 'mode', 'reviewed', 'generatedAt', 'window', 'coverage', 'findings']);
  requireValue(input.schema === 'pulseboard.lens-projection/1' && ['synthetic', 'redacted'].includes(input.mode) && input.reviewed === true, 'A reviewed projection is required');
  exactKeys(input.window, ['start', 'end']);
  const start = isoTime(input.window.start), end = isoTime(input.window.end), generatedAt = isoTime(input.generatedAt);
  requireValue(end > start && generatedAt >= end, 'Invalid projection window');
  exactKeys(input.coverage, ['eligible', 'observed', 'censored']);
  const eligible = integer(input.coverage.eligible), observed = integer(input.coverage.observed), censored = integer(input.coverage.censored);
  requireValue(observed + censored <= eligible, 'Coverage exceeds eligible observations');
  const findings = list(input.findings, 24).map(finding => {
    exactKeys(finding, ['id', 'kind', 'title', 'detail', 'n', 'limitations']);
    const id = boundedString(finding.id, 64);
    requireValue(/^[a-z0-9.-]+$/.test(id) && ['observation', 'pattern', 'hypothesis', 'abstention'].includes(finding.kind), 'Invalid finding identity or kind');
    requireValue(integer(finding.n) <= observed, 'Finding exceeds observed coverage');
    const limitations = list(finding.limitations, 8).map(safeFindingText);
    requireValue(limitations.length > 0, 'Findings must carry limitations');
    return { id, kind: finding.kind, title: safeFindingText(finding.title), detail: safeFindingText(finding.detail), n: finding.n, limitations };
  });
  unique(findings.map(f => f.id));
  return { kind: 'developer-lens', schema: input.schema, mode: input.mode, trust: 'unverified-file', generatedAt,
    window: { start, end }, coverage: { eligible, observed, censored, missing: eligible - observed - censored }, findings,
    limitations: ['Review is asserted by the file, not cryptographically verified.', 'Bounded text checks are not an anonymity guarantee.', 'Findings stay separate from telemetry and are excluded from public pulse exports.'] };
}
/** Public export is an explicit projection, not serialization of the desk or an imported artifact. */
export function makePublicPulse(snapshot, selected, now = Date.now()) {
  requireValue(snapshot?.schema === 'pulseboard.portfolio/1' && ['demo', 'live'].includes(snapshot.mode), 'No supported snapshot');
  assertPortfolio({ ...snapshot, mode: 'live' });
  requireValue(Number.isSafeInteger(now) && Number.isSafeInteger(snapshot.generatedAt) && snapshot.generatedAt <= now && now - snapshot.generatedAt <= STALE_AFTER, 'Refresh before preparing a public pulse');
  list(selected, 16); unique(selected); requireValue(selected.length > 0, 'Select at least one project');
  const projects = selected.map(id => {
    const p = snapshot.projects.find(p => p.id === id);
    requireValue(p?.probeExpected === true, 'Local-only or unknown project cannot enter a public pulse');
    requireValue(/^[a-z0-9-]{1,64}$/.test(id), 'Invalid public project identity');
    const state = monitorState(p, now);
    return { id, probe: { state, checked: p.monitor.checked }, sampledChecks: { good: integer(p.probeSamples.numerator), total: integer(p.probeSamples.denominator) } };
  });
  return { schema: 'pulseboard.public-pulse/1', sourceMode: snapshot.mode, generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.generatedAt + STALE_AFTER, window: { start: snapshot.window.start, end: snapshot.window.end }, projects,
    limitations: ['Synthetic checks, not time-weighted uptime.', 'Expiry must be enforced by a future consumer.', 'Operator-reviewed file; not signed or published automatically.'] };
}
/** Used for authenticated responses too: stream limits apply even without Content-Length. */
export async function readLimitedJson(response, maxBytes = 524288) {
  requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Invalid body limit');
  const declared = response.headers.get('content-length');
  requireValue(declared === null || /^\d+$/.test(declared) && Number(declared) <= maxBytes, 'Response body limit');
  requireValue(response.body, 'Missing response body');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; requireValue(size <= maxBytes, 'Response body limit'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
/** Validate all fields consumed by the desk before replacing a last-good snapshot. */
export function assertPortfolio(input) {
  requireValue(plain(input) && input.schema === 'pulseboard.portfolio/1' && input.mode === 'live' && typeof input.collectionEnabled === 'boolean', 'Unexpected portfolio contract');
  const stamp = value => { requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000, 'Invalid timestamp'); return value; };
  stamp(input.generatedAt); requireValue(plain(input.window), 'Missing window');
  const { start, end, days } = input.window;
  stamp(start); stamp(end);
  requireValue([1, 7, 14].includes(days) && end - start === days * 86400000 && end === input.generatedAt && input.window.timezone === 'UTC', 'Invalid window');
  list(input.limitations, 16).forEach(value => boundedString(value, 500));
  const projects = list(input.projects, 64);
  for (const p of projects) {
    requireValue(plain(p) && /^[a-z0-9-]{1,64}$/.test(boundedString(p.id, 64)) && typeof p.probeExpected === 'boolean', 'Invalid project');
    boundedString(p.label, 160);
    requireValue(plain(p.monitor) && ['up', 'down', 'stale', 'unknown'].includes(p.monitor.state), 'Invalid monitor');
    if (p.monitor.checked !== null) stamp(p.monitor.checked);
    if (p.monitor.state === 'down') { integer(p.monitor.failures); integer(p.monitor.status); }
    requireValue(plain(p.totals), 'Missing totals');
    for (const key of ['events', 'sessions', 'completed', 'failed', 'errors']) integer(p.totals[key]);
    requireValue(p.totals.completed + p.totals.failed <= p.totals.events && p.totals.sessions <= p.totals.events, 'Inconsistent event totals');
    if (p.totals.last !== null) stamp(p.totals.last);
    for (const f of [p.flow, p.probeSamples]) {
      requireValue(plain(f), 'Missing fraction'); integer(f.numerator); integer(f.denominator);
      requireValue(f.numerator <= f.denominator && (f.denominator ? Number.isFinite(f.value) && Math.abs(f.value - f.numerator / f.denominator) < 1e-12 : f.value === null), 'Invalid fraction');
    }
    requireValue(plain(p.budget), 'Missing budget'); integer(p.budget.used); integer(p.budget.limit); boundedString(p.budget.day, 10);
    const daily = list(p.daily, 15), routes = list(p.routes, 128), releases = list(p.releases, 64);
    unique(daily.map(d => d.day)); unique(routes.map(r => r.route)); unique(releases.map(r => r.release));
    for (const d of daily) { integer(d.day); integer(d.n); requireValue(d.day >= Math.floor(start / 86400000) && d.day < Math.ceil(end / 86400000), 'Invalid daily bucket'); }
    for (const r of routes) { boundedString(r.route, 80); integer(r.n); }
    for (const r of releases) {
      boundedString(r.release, 160); stamp(r.last);
      for (const key of ['events', 'completed', 'failed', 'errors']) integer(r[key]);
      requireValue(r.completed + r.failed <= r.events, 'Invalid release outcomes');
      if (r.duration !== null) {
        requireValue(plain(r.duration) && r.duration.unit === 'ms' && r.duration.method === 'nearest-rank', 'Invalid duration');
        integer(r.duration.n); requireValue(r.duration.n > 0 && r.duration.n <= r.events, 'Invalid duration sample');
        for (const key of ['mean', 'p95']) requireValue(Number.isFinite(r.duration[key]) && r.duration[key] >= 0 && r.duration[key] <= 3600000, 'Invalid duration value');
      }
    }
    for (const [rows, key] of [[daily, 'n'], [routes, 'n'], [releases, 'events']]) requireValue(rows.reduce((n, r) => n + r[key], 0) === p.totals.events, 'Aggregate totals do not reconcile');
  }
  unique(projects.map(p => p.id)); return input;
}
