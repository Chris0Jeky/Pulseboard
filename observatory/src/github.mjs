/** GitHub workflow, deployment and release evidence for explicitly mapped repositories. Server-side token only;
 *  requests go to api.github.com/repositories/{numeric id} and nowhere else. */
import { projects as registry } from './projects.mjs';
import { readLimitedJson, requireValue, plain, exactKeys, list, unique, boundedString, isoTime } from '../public/desk-bridge.mjs';
import { GITHUB_SCHEMA, GITHUB_RULES, GITHUB_LIMITATIONS, WORKFLOW_ROLES, REPOSITORY, WORKFLOW_PATH, ENVIRONMENT, assertGithubEvidence, deepFreeze } from '../public/desk-release.mjs';
export const LIMITS = { maxRequests: 12, minRefreshMs: 600000, staleAfterMs: 6 * 3600000, maxPages: 2, maxBytes: 262144, rateFloor: 50, timeoutMs: 5000, maxCache: 128 };
const API = 'https://api.github.com', HOUR = 3600000, SKEW = 60000;
const positive = value => Number.isSafeInteger(value) && value > 0;
/** Fails closed: unknown fields, unregistered projects, name-only workflows, double claims and unbounded lists are refused. */
export function readGithubMap(input, known = registry) {
  exactKeys(input, ['schema', 'revision', 'reviewedAt', 'projects']);
  requireValue(input.schema === 'pulseboard.github-map/1' && positive(input.revision) && typeof input.reviewedAt === 'string'
    && /^\d{4}-\d\d-\d\d$/.test(input.reviewedAt) && new Date(Date.parse(input.reviewedAt)).toISOString().startsWith(input.reviewedAt), 'Unsupported GitHub mapping');
  requireValue(plain(input.projects), 'Invalid mapped projects');
  const claims = new Set(), names = new Map(), projects = {};
  for (const [id, repositories] of Object.entries(input.projects)) {
    requireValue(Object.hasOwn(known, id) && list(repositories, 4).length > 0, 'Mapped project is not registered or has no repository');
    unique(repositories.map(r => r?.repositoryId));
    projects[id] = repositories.map(r => {
      exactKeys(r, ['repositoryId', 'repository', 'workflows', 'environments', 'releases']);
      requireValue(positive(r.repositoryId) && typeof r.repository === 'string' && REPOSITORY.test(r.repository), 'Invalid repository identity');
      requireValue((names.get(r.repositoryId) ?? r.repository) === r.repository, 'One repository id carries two names');
      names.set(r.repositoryId, r.repository);
      const workflows = list(r.workflows, 4).map(w => {
        exactKeys(w, ['workflowId', 'path', 'branch', 'role']);
        requireValue(positive(w.workflowId) && typeof w.path === 'string' && WORKFLOW_PATH.test(w.path) && typeof w.branch === 'string'
          && /^[A-Za-z0-9._/-]{1,100}$/.test(w.branch) && !w.branch.includes('..') && WORKFLOW_ROLES.includes(w.role), 'Invalid workflow mapping');
        const claim = `${r.repositoryId}:${w.workflowId}:${w.branch}`;
        requireValue(!claims.has(claim), 'Workflow and branch claimed twice'); claims.add(claim);
        return { workflowId: w.workflowId, path: w.path, branch: w.branch, role: w.role };
      });
      const environments = list(r.environments, 2).map(env => { exactKeys(env, ['name']); requireValue(typeof env.name === 'string' && ENVIRONMENT.test(env.name), 'Invalid environment'); return { name: env.name }; });
      unique(environments.map(env => env.name));
      exactKeys(r.releases, ['max']); requireValue(Number.isSafeInteger(r.releases.max) && r.releases.max >= 0 && r.releases.max <= 10, 'Invalid release bound');
      return { repositoryId: r.repositoryId, repository: r.repository, workflows, environments, releases: { max: r.releases.max } };
    });
  }
  return deepFreeze({ schema: input.schema, revision: input.revision, reviewedAt: input.reviewedAt, projects });
}
/** The only URL shape this module requests: https, api.github.com, one numeric repository. */
function checked(url, repositoryId) {
  requireValue(url.protocol === 'https:' && url.host === 'api.github.com' && !url.username && !url.password && !url.hash
    && (url.pathname === `/repositories/${repositoryId}` || url.pathname.startsWith(`/repositories/${repositoryId}/`)), 'Refused GitHub URL');
  return url;
}
export const githubUrl = (repositoryId, suffix = '') => { requireValue(positive(repositoryId), 'Invalid repository id'); return checked(new URL(`${API}/repositories/${repositoryId}${suffix}`), repositoryId); };
function nextLink(header, current, repositoryId) {
  if (header === null) return null;
  requireValue(header.length <= 2048, 'Link header limit');
  let next = null;
  for (const part of header.split(',')) {
    const match = /^\s*<([^<>\s]+)>\s*;\s*rel="([a-z ]+)"\s*$/.exec(part);
    requireValue(match, 'Malformed Link header');
    if (match[2].split(' ').includes('next')) next = match[1];
  }
  if (next === null) return null;
  const url = checked(new URL(next), repositoryId);
  requireValue(url.pathname === current.pathname, 'Link leaves the endpoint');
  return url.href;
}
const sha = value => { requireValue(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value), 'Invalid commit SHA'); return value; };
const word = value => { requireValue(typeof value === 'string' && /^[a-z_]{1,32}$/.test(value), 'Invalid state text'); return value; };
const array = value => list(value, 100);
// Projections keep bounded identity fields only; bodies, titles, actors, URLs and nested objects are dropped here.
const projections = {
  repository: repositoryId => body => {
    requireValue(plain(body) && body.id === repositoryId && typeof body.full_name === 'string' && REPOSITORY.test(body.full_name), 'Unexpected repository');
    return [{ fullName: body.full_name }];
  },
  runs: () => body => { requireValue(plain(body), 'Unexpected run list'); return array(body.workflow_runs).map(r => {
    requireValue(plain(r) && positive(r.id) && positive(r.workflow_id) && positive(r.run_attempt), 'Invalid run');
    return { runId: r.id, runAttempt: r.run_attempt, workflowId: r.workflow_id, path: boundedString(r.path, 200), branch: r.head_branch === null ? null : boundedString(r.head_branch, 255),
      headSha: sha(r.head_sha), status: word(r.status), conclusion: r.conclusion === null ? null : word(r.conclusion), updatedAt: isoTime(r.updated_at) };
  }); },
  deployments: () => body => array(body).map(d => { requireValue(plain(d) && positive(d.id), 'Invalid deployment');
    return { deploymentId: d.id, sha: sha(d.sha), environment: boundedString(d.environment, 64), createdAt: isoTime(d.created_at) }; }),
  statuses: () => body => array(body).map(s => { requireValue(plain(s), 'Invalid deployment status'); return { state: word(s.state), createdAt: isoTime(s.created_at) }; }),
  releases: () => body => array(body).map(r => { requireValue(plain(r) && positive(r.id) && typeof r.draft === 'boolean' && typeof r.prerelease === 'boolean', 'Invalid release');
    return { id: r.id, tag: boundedString(r.tag_name, 160), draft: r.draft, prerelease: r.prerelease, publishedAt: r.published_at === null ? null : isoTime(r.published_at) }; }),
};
const RUN = { success: 'passing', failure: 'failing', timed_out: 'failing', startup_failure: 'failing' };
const DEPLOYED = { success: 'passing', failure: 'failing', error: 'failing', pending: 'pending', queued: 'pending', in_progress: 'pending' };
const lookup = (table, key) => Object.hasOwn(table, key) ? table[key] : 'inconclusive';
const result = (state, reason, read, sourceTime = null, evidence = null) => ({ state, reason, observedAt: read.observedAt, sourceTime, evidence, truncated: read.truncated });
const classify = {
  workflow: w => read => {
    const run = read.items.find(r => r.workflowId === w.workflowId && r.path === w.path && r.branch === w.branch);
    if (!run) return result('missing', read.items.length ? 'no-matching-run' : 'no-runs', read);
    const state = run.status !== 'completed' ? (['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status) ? 'pending' : 'inconclusive')
      : lookup(RUN, run.conclusion);
    return result(state, run.status === 'completed' ? run.conclusion || 'no-conclusion' : run.status, read, run.updatedAt,
      { runId: run.runId, runAttempt: run.runAttempt, headSha: run.headSha, status: run.status, conclusion: run.conclusion });
  },
  environment: () => read => {
    const d = read.items[0];
    if (!d) return result('missing', 'no-deployment', read);
    return result(d.status ? lookup(DEPLOYED, d.status.state) : 'inconclusive', d.status?.state || 'no-status', read, d.status?.createdAt ?? d.createdAt,
      { deploymentId: d.deploymentId, sha: d.sha, environment: d.environment, createdAt: d.createdAt, status: d.status?.state ?? null });
  },
  releases: max => read => {
    const releases = read.items.filter(r => !r.draft && r.publishedAt !== null).slice(0, max);
    if (!releases.length) return result('missing', 'none-returned', read);
    return result('observed', 'listed', read, Math.max(...releases.map(r => r.publishedAt)), { releases: releases.map(({ id, tag, prerelease, publishedAt }) => ({ id, tag, prerelease, publishedAt })) });
  },
};
const blank = (target, state, reason, resetAt = null) => ({ target, state, reason, observedAt: null, sourceTime: null, evidence: null, resetAt, truncated: false, lastKnown: null });
const stale = (target, last, reason, resetAt = null) => ({ ...blank(target, 'stale', reason, resetAt),
  lastKnown: { state: last.state, reason: last.reason, observedAt: last.observedAt, sourceTime: last.sourceTime, evidence: last.evidence } });
/** createGithubEvidence({ map, token, fetch, now, cache, limits }).read(projectId) -> pulseboard.github-evidence/1. */
export function createGithubEvidence({ map, token = null, fetch: send = globalThis.fetch, now: clock = Date.now, cache = new Map(), limits = {} } = {}) {
  const mapping = readGithubMap(map), bounds = { ...LIMITS, ...limits };
  requireValue(Object.values(bounds).every(v => Number.isSafeInteger(v) && v >= 0) && bounds.maxPages > 0 && bounds.maxBytes > 0, 'Invalid GitHub limits');
  requireValue(!token || typeof token === 'string' && /^[\x21-\x7e]{20,255}$/.test(token), 'GitHub token has an unexpected shape');
  const lastRead = new Map();
  let blockedUntil = 0, blockReason = 'rate-limited';
  const remember = (key, entry) => { cache.delete(key); cache.set(key, entry); while (cache.size > bounds.maxCache) cache.delete(cache.keys().next().value); };
  const block = (until, reason) => { blockedUntil = Math.max(blockedUntil, until); blockReason = reason; };
  async function get(ctx, url, project) {
    const key = url.pathname + url.search, cached = cache.get(key);
    if (ctx.cacheOnly) return cached ? { entry: cached } : { fail: { state: 'unavailable', reason: 'min-refresh' } };
    if (ctx.now < blockedUntil) return { fail: { state: 'rate-limited', reason: blockReason, resetAt: blockedUntil } };
    if (ctx.used >= bounds.maxRequests) return { fail: { state: 'unavailable', reason: 'request-budget' } };
    ctx.used++;
    let response;
    try {
      response = await send(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(bounds.timeoutMs),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pulseboard-Observatory/0.1 (+github-evidence)', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) } });
    } catch { return { fail: { state: 'unavailable', reason: 'network' } }; }
    const { status, headers } = response, header = name => headers.get(name);
    const remaining = /^\d{1,9}$/.test(header('x-ratelimit-remaining') ?? '') ? Number(header('x-ratelimit-remaining')) : null;
    const retry = /^\d{1,6}$/.test(header('retry-after') ?? '') ? ctx.now + Number(header('retry-after')) * 1000 : null;
    const reset = /^\d{1,12}$/.test(header('x-ratelimit-reset') ?? '') ? Number(header('x-ratelimit-reset')) * 1000 : null;
    // A garbled or hostile reset header cannot park the connector for more than an hour.
    const until = Math.min(Math.max(retry ?? reset ?? ctx.now + 60000, ctx.now + 1000), ctx.now + HOUR);
    if (status !== 200) await response.body?.cancel().catch(() => {});
    if (status === 429 || status === 403 && (remaining === 0 || retry !== null)) {
      block(until, 'rate-limited'); return { fail: { state: 'rate-limited', reason: 'rate-limited', resetAt: blockedUntil } };
    }
    const floor = () => { if (remaining !== null && remaining < bounds.rateFloor) block(until, 'rate-floor'); };
    if (status === 304) {
      if (!cached) return { fail: { state: 'unavailable', reason: 'malformed' } };
      floor(); const entry = { ...cached, fetchedAt: ctx.now }; remember(key, entry); return { entry };
    }
    const fail = status === 401 ? ['unavailable', 'credential-rejected'] : status === 403 ? ['unavailable', 'forbidden'] : status === 404 ? ['missing', 'not-found-or-no-access']
      : status >= 300 && status < 400 ? ['unavailable', 'redirect'] : status !== 200 ? ['unavailable', 'upstream-error'] : null;
    if (fail) return { fail: { state: fail[0], reason: fail[1] } };
    floor();
    let projected;
    try { projected = { items: project(await readLimitedJson(response, bounds.maxBytes)), next: nextLink(header('link'), url, ctx.repositoryId) }; }
    catch { return { fail: { state: 'unavailable', reason: 'malformed' } }; }
    const etag = header('etag'), entry = { etag: /^(?:W\/)?"[\x21\x23-\x7e]{1,200}"$/.test(etag ?? '') ? etag : null, projected, fetchedAt: ctx.now };
    remember(key, entry); return { entry };
  }
  const fromCache = url => { const entry = cache.get(url.pathname + url.search); return entry ? { entry } : { fail: {} }; };
  /** Follows rel=next on the same endpoint until `enough`, at most maxPages pages. */
  async function walk(page, url, project, enough = () => true) {
    const items = []; let href = url.href, pages = 0, observedAt = Infinity;
    while (href && pages < bounds.maxPages) {
      const got = await page(new URL(href), project);
      if (got.fail) return got;
      pages++; items.push(...got.entry.projected.items); observedAt = Math.min(observedAt, got.entry.fetchedAt); href = got.entry.projected.next;
      if (enough(items)) return { items, observedAt, truncated: false };
    }
    return { items, observedAt, truncated: !!href };
  }
  async function environmentRead(page, repositoryId, name) {
    const deployments = await walk(page, githubUrl(repositoryId, `/deployments?environment=${encodeURIComponent(name)}&per_page=1`), projections.deployments());
    const d = deployments.fail ? null : deployments.items.find(x => x.environment === name);
    if (!d) return deployments.fail ? deployments : { ...deployments, items: [] };
    const statuses = await walk(page, githubUrl(repositoryId, `/deployments/${d.deploymentId}/statuses?per_page=1`), projections.statuses());
    if (statuses.fail) return statuses;
    return { items: [{ ...d, status: statuses.items[0] ?? null }], observedAt: Math.min(deployments.observedAt, statuses.observedAt), truncated: false };
  }
  /** Live first; a failed read falls back to the last cached projection, which is only ever shown as stale. */
  async function resolve(ctx, target, reader, judge, inherited = null) {
    const live = inherited || await reader((url, project) => get(ctx, url, project));
    if (!live.fail) {
      const current = { target, ...judge(live), resetAt: null, lastKnown: null };
      if (current.sourceTime !== null && current.sourceTime > ctx.now + SKEW) return stale(target, current, 'future-dated');
      return ctx.now - current.observedAt > bounds.staleAfterMs ? stale(target, current, 'old-observation') : current;
    }
    const last = await reader(fromCache);
    return last.fail ? blank(target, live.fail.state, live.fail.reason, live.fail.resetAt ?? null) : stale(target, judge(last), live.fail.reason, live.fail.resetAt ?? null);
  }
  async function read(projectId) {
    const now = clock(), repositories = Object.hasOwn(mapping.projects, projectId) ? mapping.projects[projectId] : null;
    const evidence = { schema: GITHUB_SCHEMA, mode: 'live', generatedAt: now, project: projectId, configuration: !repositories ? 'unmapped' : token ? 'ready' : 'no-token',
      mapping: { schema: mapping.schema, revision: mapping.revision, reviewedAt: mapping.reviewedAt }, rules: GITHUB_RULES, repositories: [], limitations: GITHUB_LIMITATIONS };
    if (!repositories) return assertGithubEvidence(evidence);
    const last = lastRead.get(projectId), ctx = { now, used: 0, cacheOnly: !!token && last !== undefined && now >= last && now - last < bounds.minRefreshMs };
    if (token && !ctx.cacheOnly) lastRead.set(projectId, now);
    for (const r of repositories) {
      const unconfigured = target => blank(target, 'unconfigured', 'no-server-token');
      if (!token) {
        evidence.repositories.push({ repositoryId: r.repositoryId, repository: r.repository, renamed: null, state: 'unconfigured', reason: 'no-server-token', observedAt: null,
          workflows: r.workflows.map(unconfigured), environments: r.environments.map(unconfigured), releases: unconfigured(r.releases) });
        continue;
      }
      ctx.repositoryId = r.repositoryId;
      const repo = await walk((url, project) => get(ctx, url, project), githubUrl(r.repositoryId), projections.repository(r.repositoryId));
      // An unreadable repository is not asked again for each workflow: the items inherit its failure and spend no budget.
      const inherited = repo.fail ? repo : null, observed = repo.fail ? null : repo.items[0].fullName;
      const workflows = [], environments = [];
      for (const w of r.workflows) {
        const url = githubUrl(r.repositoryId, `/actions/workflows/${w.workflowId}/runs?branch=${encodeURIComponent(w.branch)}&per_page=5&exclude_pull_requests=true`);
        const matches = items => items.some(x => x.workflowId === w.workflowId && x.path === w.path && x.branch === w.branch);
        workflows.push(await resolve(ctx, w, page => walk(page, url, projections.runs(), matches), classify.workflow(w), inherited));
      }
      for (const env of r.environments) environments.push(await resolve(ctx, env, page => environmentRead(page, r.repositoryId, env.name), classify.environment(), inherited));
      const releases = r.releases.max === 0 ? blank(r.releases, 'unconfigured', 'not-mapped')
        : await resolve(ctx, r.releases, page => walk(page, githubUrl(r.repositoryId, '/releases?per_page=10'), projections.releases(),
          items => items.filter(x => !x.draft).length >= r.releases.max), classify.releases(r.releases.max), inherited);
      evidence.repositories.push({ repositoryId: r.repositoryId, repository: r.repository, renamed: observed && observed !== r.repository ? { mapped: r.repository, observed } : null,
        state: repo.fail ? repo.fail.state : 'observed', reason: repo.fail ? repo.fail.reason : 'read', observedAt: repo.fail ? null : repo.observedAt, workflows, environments, releases });
    }
    return assertGithubEvidence(evidence);
  }
  return { read };
}
