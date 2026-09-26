import { projects } from './projects.mjs';
import { collectionAdmission, productAdmission } from './admission.mjs';
import { validateBatch, readBounded, monitorTransition, monitorState, interval } from './contracts.mjs';
import { validateStatBatch, statAdmission, batchDimensions, serverDimensions, CAPPED_DIMENSIONS, DIMENSION_CAP, SENTINELS } from './stat-contract.mjs';
import { validateProductBatch, redactProps, consentRegion, PRODUCT_DEFAULT_LIMIT, PRODUCT_NAME } from './product-contract.mjs';
import { readStatistics, READ_WINDOWS } from './statistics.mjs';
import { readProduct, readProductEvents, EVENTS_DEFAULT_LIMIT } from './product.mjs';
import { readPortfolio, WINDOWS } from './portfolio.mjs';
import { assets } from './assets.mjs';
import { createGithubEvidence } from './github.mjs';
import { githubMap } from './github-map.mjs';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
export const SCHEMA_VERSION = 4;
// Naming every column means a database missing a later-added column fails readiness instead of failing a request.
const READINESS = [
  'SELECT project,day,used,receipt FROM budget LIMIT 0',
  'SELECT project,id,received,session,seq,event,route,release,value FROM events LIMIT 0',
  'SELECT project,day,event,route,release,n,received FROM statistics LIMIT 0',
  'SELECT project,day,dimension,value,n FROM statistics_dimensions LIMIT 0',
  'SELECT project,received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device FROM product_events LIMIT 0',
  'SELECT project,state,failures,successes,opened,checked,status,duration FROM probes LIMIT 0',
  'SELECT project,checked,ok,duration FROM probe_history LIMIT 0',
];
async function ready(db) {
  for (const query of READINESS) await db.prepare(query).all();
  const row = await db.prepare('SELECT version FROM schema_version WHERE id=1').first();
  if (row?.version !== SCHEMA_VERSION) throw new Error('schema version');
  return SCHEMA_VERSION;
}
async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('authorization') || '';
  if (supplied.length > 512) return false;
  const digest = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(supplied), digest('Bearer ' + secret)]);
  let mismatch = 0; const aa = new Uint8Array(a), bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
}
/** One `days` parameter from READ_WINDOWS, canonical spelling, no other keys but `allowed`; null when refused. */
function readWindow(url, allowed = ['days']) {
  const values = url.searchParams.getAll('days');
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key)) || values.length > 1 ||
    (values.length && !/^(1|7|14|30|90)$/.test(values[0]))) return null;
  return Number(values[0] ?? 7);
}
/** A registered project with a public origin, or null (unknown and local-only ids are not found). */
const publicProject = id => Object.hasOwn(projects, id) && projects[id].origin ? projects[id] : null;
const preflight = cors => new Response(null, { status: 204, headers: { ...headers, ...cors,
  'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
const sentinelList = SENTINELS.map(value => `'${value}'`).join(',');
/** Distinct-value cap for open-shaped dimensions, evaluated inside the gated insert so it reads the same transaction.
 *  Binds: value, capped flag, then project, day, dimension, value, then project, day, dimension, then value. */
const CAP_SQL = `CASE WHEN ? IN (${sentinelList}) OR ?=0
  OR EXISTS(SELECT 1 FROM statistics_dimensions WHERE project=? AND day=? AND dimension=? AND value=?)
  OR (SELECT COUNT(*) FROM statistics_dimensions WHERE project=? AND day=? AND dimension=? AND value NOT IN (${sentinelList}))<${DIMENSION_CAP}
  THEN ? ELSE 'other' END`;
export async function summary(db, now = Date.now(), admission = collectionAdmission({})) {
  const since = now - 7 * 86400000;
  const counts = (await db.prepare(`SELECT project, event, release, COUNT(*) AS n, MAX(received) AS last
    FROM events WHERE received >= ? GROUP BY project, event, release`).bind(since).all()).results;
  const sessions = (await db.prepare(`SELECT project, COUNT(DISTINCT session) AS n FROM events
    WHERE received >= ? GROUP BY project`).bind(since).all()).results;
  const daily = (await db.prepare(`SELECT project, CAST(received / 86400000 AS INTEGER) AS day, COUNT(*) AS n
    FROM events WHERE received >= ? GROUP BY project, day ORDER BY day`).bind(since).all()).results;
  const funnels = (await db.prepare(`SELECT a.project, COUNT(*) AS started,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM events b WHERE b.project=a.project AND b.session=a.session
      AND b.event='action.completed' AND b.seq>a.start_seq AND b.received>=?) THEN 1 ELSE 0 END) AS completed
    FROM (SELECT project, session, MIN(seq) AS start_seq FROM events
      WHERE received>=? AND event='action.requested' GROUP BY project, session) a GROUP BY a.project`).bind(since, since).all()).results;
  const probes = (await db.prepare('SELECT * FROM probes').all()).results;
  const budgets = (await db.prepare('SELECT project, used FROM budget WHERE day=?').bind(new Date(now).toISOString().slice(0, 10)).all()).results;
  return { generated: now, windowDays: 7, collectionEnabled: admission.enabled, collectionConfigurationValid: admission.valid,
    provenance: 'client-reported, opt-in; not verified people' + (Object.values(projects).some(p => p.probe?.binding) ? '; service-bound probes observe the application, not its public edge' : ''),
    projects: Object.entries(projects).map(([id, p]) => {
      const probe = probes.find(x => x.project === id), funnel = funnels.find(x => x.project === id);
      return { id, label: p.label, configuredOrigin: p.origin, probeExpected: !!p.probe,
        collectionEligible: Boolean(p.origin), collectionAdmitted: admission.admitted.includes(id),
        monitor: probe ? { ...probe, state: monitorState(probe, now) } : { state: 'unknown' },
        counts: counts.filter(x => x.project === id), sessions: sessions.find(x => x.project === id)?.n || 0,
        daily: daily.filter(x => x.project === id),
        funnel: funnel ? { ...funnel, interval: interval(funnel.completed, funnel.started) } : null,
        budgetUsed: budgets.find(x => x.project === id)?.used || 0, budgetLimit: p.dailyLimit };
    }) };
}
let githubShared = null;
/** One connector per isolate and token, so its ETag cache, refresh floor and rate-limit pause outlive one request.
 *  Tests inject GITHUB_EVIDENCE. Without GITHUB_EVIDENCE_TOKEN nothing is requested and mapped items read unconfigured. */
function githubEvidence(env) {
  if (env.GITHUB_EVIDENCE) return env.GITHUB_EVIDENCE;
  const token = typeof env.GITHUB_EVIDENCE_TOKEN === 'string' ? env.GITHUB_EVIDENCE_TOKEN : '';
  if (githubShared?.token !== token) githubShared = { token, connector: createGithubEvidence({ map: githubMap, token: token || null }) };
  return githubShared.connector;
}
/** Projects admitted while COLLECT_ENABLED is true. Invalid or local-only ids fail the whole policy closed. */
export const collecting = env => collectionAdmission(env).admitted;
export async function handle(request, env) {
  const url = new URL(request.url);
  // Held outside the try so an unexpected failure after the origin match is still readable by the calling page.
  let cors = {};
  try {
    if (['GET', 'HEAD'].includes(request.method) && assets.has(url.pathname) && env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      const h = new Headers(response.headers);
      h.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      h.set('Cache-Control', 'no-store'); h.set('Referrer-Policy', 'no-referrer'); h.set('X-Content-Type-Options', 'nosniff');
      h.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: h });
    }
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method' }, 405, { Allow: 'GET, HEAD' });
      if (url.pathname === '/healthz') return json({ live: true, productData: 'not checked' });
      const schema = await ready(env.DB), admission = collectionAdmission(env);
      const collection = { enabled: admission.enabled, configured: admission.configured, admitted: admission.admitted, invalid: admission.invalid };
      // Reported, not gating: a malformed statistics list already disables itself, and this makes that visible.
      const statistics = { configured: typeof env.COLLECT_STAT_PROJECTS === 'string' && env.COLLECT_STAT_PROJECTS !== '',
        admitted: admission.enabled && admission.valid ? statAdmission(env) : [] };
      const product = { configured: typeof env.COLLECT_PRODUCT_PROJECTS === 'string' && env.COLLECT_PRODUCT_PROJECTS !== '',
        admitted: admission.enabled && admission.valid ? productAdmission(env) : [] };
      return json({ ready: admission.valid, schema, collection, statistics, product }, admission.valid ? 200 : 503);
    }
    if (url.pathname === '/v1/summary' && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      return json(await summary(env.DB, Date.now(), collectionAdmission(env)));
    }
    if (url.pathname === '/v1/portfolio' && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      const value = url.searchParams.get('days') ?? '7';
      if (!/^(1|7|14)$/.test(value) || url.searchParams.getAll('days').length > 1 || !WINDOWS.includes(Number(value))) {
        return json({ error: 'window', allowedDays: WINDOWS }, 400);
      }
      const admission = collectionAdmission(env);
      if (!admission.valid) return json({ error: 'invalid_collection_configuration', invalid: admission.invalid }, 503);
      return json(await readPortfolio(env.DB, { days: Number(value), collectionEnabled: admission.enabled, admittedProjects: admission.admitted }));
    }
    const readMatch = /^\/v1\/statistics\/([a-z0-9-]{1,64})$/.exec(url.pathname);
    if (readMatch && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      const readId = readMatch[1];
      if (!publicProject(readId)) return json({ error: 'project' }, 404);
      const days = readWindow(url);
      if (days === null) return json({ error: 'window', allowedDays: READ_WINDOWS }, 400);
      const admission = collectionAdmission(env);
      if (!admission.valid) return json({ error: 'invalid_collection_configuration', invalid: admission.invalid }, 503);
      return json(await readStatistics(env.DB, { project: readId, days,
        admitted: admission.enabled && statAdmission(env).includes(readId) }));
    }
    // Product reads (USAGE_PLAN.md section 4). GET is always the authenticated read; the ingest below takes POST.
    const productRead = /^\/v1\/product\/([a-z0-9-]{1,64})(\/events)?$/.exec(url.pathname);
    if (productRead && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      const readId = productRead[1], raw = !!productRead[2];
      if (!publicProject(readId)) return json({ error: 'project' }, 404);
      const days = readWindow(url, raw ? ['days', 'name', 'limit'] : ['days']);
      if (days === null) return json({ error: 'window', allowedDays: READ_WINDOWS }, 400);
      let name = null, limit = EVENTS_DEFAULT_LIMIT;
      if (raw) {
        const names = url.searchParams.getAll('name'), limits = url.searchParams.getAll('limit');
        if (names.length > 1 || (names.length && !PRODUCT_NAME.test(names[0]))) return json({ error: 'name' }, 400);
        if (limits.length > 1 || (limits.length && !/^(?:[1-9][0-9]{0,2}|[1-4][0-9]{3}|5000)$/.test(limits[0]))) return json({ error: 'limit', max: 5000 }, 400);
        name = names[0] ?? null; limit = Number(limits[0] ?? EVENTS_DEFAULT_LIMIT);
      }
      const admission = collectionAdmission(env);
      if (!admission.valid) return json({ error: 'invalid_collection_configuration', invalid: admission.invalid }, 503);
      const admitted = admission.enabled && productAdmission(env).includes(readId);
      return json(raw ? await readProductEvents(env.DB, { project: readId, days, name, limit, admitted })
        : await readProduct(env.DB, { project: readId, days, admitted }));
    }
    // Region hint for the SDK's consent defaults (USAGE_PLAN.md section 3): origin-checked, unauthenticated, stores nothing.
    const consentMatch = /^\/v1\/consent\/([a-z0-9-]+)$/.exec(url.pathname);
    if (consentMatch) {
      const consentProject = publicProject(consentMatch[1]);
      if (url.search || !consentProject) return json({ error: 'not_found' }, 404);
      if (request.headers.get('origin') !== consentProject.origin) return json({ error: 'origin' }, 403);
      cors = { 'Access-Control-Allow-Origin': consentProject.origin, 'Vary': 'Origin' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors,
        'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'GET') return json({ error: 'method' }, 405, { ...cors, Allow: 'GET' });
      return json({ v: 1, region: consentRegion(request) }, 200, { ...cors, 'Cache-Control': 'private, max-age=3600' });
    }
    // Product-event admission (USAGE_PLAN.md section 2): its own switch, budget key and table.
    const productMatch = /^\/v1\/product\/([a-z0-9-]+)$/.exec(url.pathname);
    if (productMatch) {
      const productId = productMatch[1], productProject = publicProject(productId);
      if (url.search || !productProject) return json({ error: 'not_found' }, 404);
      if (request.headers.get('origin') !== productProject.origin) return json({ error: 'origin' }, 403);
      cors = { 'Access-Control-Allow-Origin': productProject.origin, 'Vary': 'Origin' };
      if (request.method === 'OPTIONS') return preflight(cors);
      if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
      const productCheck = collectionAdmission(env);
      if (!productCheck.valid || !productCheck.enabled || !productAdmission(env).includes(productId)) return json({ error: 'disabled' }, 503, cors);
      if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) return json({ error: 'media_type' }, 415, cors);
      let productBody;
      try { productBody = await readBounded(request); } catch { return json({ error: 'invalid_body' }, 400, cors); }
      if (!validateProductBatch(productBody)) return json({ error: 'contract' }, 400, cors);
      const productNow = Date.now(), productDay = new Date(productNow).toISOString().slice(0, 10), productReceipt = crypto.randomUUID();
      const budgetKey = productId + ':product', productLimit = productProject.productLimit ?? PRODUCT_DEFAULT_LIMIT;
      const size = productBody.events.length;
      const productReserve = env.DB.prepare(`INSERT INTO budget(project,day,used,receipt) SELECT ?,?,?,? WHERE ?<=?
        ON CONFLICT(project,day) DO UPDATE SET used=used+excluded.used,receipt=excluded.receipt
        WHERE used+excluded.used<=? RETURNING used`)
        .bind(budgetKey, productDay, size, productReceipt, size, productLimit, productLimit);
      // Same request-derived values as the counts; the User-Agent is classified and dropped, the IP is never read.
      const derived = serverDimensions(request, productNow);
      const rows = productBody.events.map(e => {
        const { props, redacted } = redactProps(e.props ?? {});
        return env.DB.prepare(`INSERT INTO product_events(project,received,day,session,seq,name,route,release,ms,props,redacted,
          country,region,browser,os,device) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM budget WHERE project=? AND day=? AND receipt=?`)
          .bind(productId, productNow, productDay, productBody.session, e.seq, e.name, e.route, productBody.release, Math.round(e.ms),
            JSON.stringify(props), redacted, derived.country, derived.region, derived.browser, derived.os, productBody.context.device,
            budgetKey, productDay, productReceipt);
      });
      // D1 batch is transactional; receipt gating makes a refused reservation store no event.
      const productResult = await env.DB.batch([productReserve, ...rows]);
      if (!productResult[0].results?.length) return json({ error: 'daily_budget' }, 429, { ...cors, 'Retry-After': '3600' });
      return json({ accepted: true, meaning: 'product batch admitted; repeated requests store repeated rows' }, 202, cors);
    }
    // Read only on explicit desk action, never by the portfolio poll; its own contract keeps /v1/portfolio closed.
    if (url.pathname === '/v1/github-evidence' && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      const ids = url.searchParams.getAll('project');
      if (ids.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'project') || !Object.hasOwn(projects, ids[0])) return json({ error: 'project' }, 400);
      return json(await githubEvidence(env).read(ids[0]));
    }
    // Aggregate admission (producer half) for any registered public project; the Desk reads it through /v1/statistics/<id>.
    const statMatch = /^\/v1\/collect-stat\/([a-z0-9-]+)$/.exec(url.pathname);
    if (statMatch) {
      const statId = statMatch[1];
      if (url.search) return json({ error: 'not_found' }, 404);
      const statProject = publicProject(statId);
      if (!statProject) return json({ error: 'not_found' }, 404);
      if (request.headers.get('origin') !== statProject.origin) return json({ error: 'origin' }, 403);
      cors = { 'Access-Control-Allow-Origin': statProject.origin, 'Vary': 'Origin' };
      if (request.method === 'OPTIONS') return preflight(cors);
      if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
      // COLLECT_ENABLED and a valid policy are required, but not COLLECT_PROJECTS membership: admitting a host's counts
      // must not also open its identifier-bearing /v1/collect/<id> session route.
      const statAdmissionCheck = collectionAdmission(env);
      if (!statAdmissionCheck.valid || !statAdmissionCheck.enabled) return json({ error: 'disabled' }, 503, cors);
      if (!statAdmission(env).includes(statId)) return json({ error: 'disabled' }, 503, cors);
      if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) return json({ error: 'media_type' }, 415, cors);
      let statBody;
      try { statBody = await readBounded(request); } catch { return json({ error: 'invalid_body' }, 400, cors); }
      if (!validateStatBatch(statBody, statProject)) return json({ error: 'contract' }, 400, cors);
      const statNow = Date.now(), statDay = new Date(statNow).toISOString().slice(0, 10), statReceipt = crypto.randomUUID();
      const statReserve = env.DB.prepare(`INSERT INTO budget(project,day,used,receipt) SELECT ?,?,?,? WHERE ?<=?
        ON CONFLICT(project,day) DO UPDATE SET used=used+excluded.used,receipt=excluded.receipt
        WHERE used+excluded.used<=? RETURNING used`)
        .bind(statId, statDay, statBody.counts.length, statReceipt, statBody.counts.length, statProject.dailyLimit, statProject.dailyLimit);
      // At-most-once client delivery: the aggregate contract carries no event IDs,
      // session IDs, puzzle IDs, text, URLs or IPs, so there is nothing to deduplicate
      // on; every admitted POST adds its counts again and repeated requests count repeatedly.
      // D1 batch is transactional. Receipt gating makes a rejected reservation write no aggregate.
      const aggregates = statBody.counts.map(c => env.DB.prepare(`INSERT INTO statistics(project,day,event,route,release,n,received)
        SELECT ?,?,?,?,?,?,? FROM budget WHERE project=? AND day=? AND receipt=?
        ON CONFLICT(project,day,event,route,release) DO UPDATE SET n=n+excluded.n,received=excluded.received`)
        .bind(statId, statDay, c.event, c.route, c.release, 1, statNow, statId, statDay, statReceipt));
      // One per-dimension total per admitted count, written in the same transaction and gated on the same receipt.
      // Browser-derived values a batch's version does not carry read 'unknown'. Region, language, referrer and campaign
      // keep at most DIMENSION_CAP distinct values per project and day; a later new value is stored as 'other'.
      const dimensionRows = batchDimensions(statBody, request, statNow).map(([dimension, value]) =>
        env.DB.prepare(`INSERT INTO statistics_dimensions(project,day,dimension,value,n)
          SELECT ?,?,?,${CAP_SQL},? FROM budget WHERE project=? AND day=? AND receipt=?
          ON CONFLICT(project,day,dimension,value) DO UPDATE SET n=n+excluded.n`)
          .bind(statId, statDay, dimension, value, CAPPED_DIMENSIONS.includes(dimension) ? 1 : 0,
            statId, statDay, dimension, value, statId, statDay, dimension, value,
            statBody.counts.length, statId, statDay, statReceipt));
      const statResult = await env.DB.batch([statReserve, ...aggregates, ...dimensionRows]);
      if (!statResult[0].results?.length) return json({ error: 'daily_budget' }, 429, { ...cors, 'Retry-After': '3600' });
      return json({ accepted: true, meaning: 'stat batch admitted; repeated requests count repeatedly' }, 202, cors);
    }
    const match = /^\/v1\/collect\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match) return json({ error: 'not_found' }, 404);
    const id = match[1], project = Object.hasOwn(projects, id) ? projects[id] : null;
    if (!project || !project.origin || request.headers.get('origin') !== project.origin) return json({ error: 'origin' }, 403);
    cors = { 'Access-Control-Allow-Origin': project.origin, 'Vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors,
      'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
    // Two switches: the global one and a per-project allowlist, so a pilot never opens admission for every
    // registered origin (Origin is forgeable; the budget of a project that has not opted in must stay untouched).
    const admission = collectionAdmission(env);
    if (!admission.valid || !admission.admitted.includes(id)) return json({ error: 'disabled' }, 503, cors);
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) return json({ error: 'media_type' }, 415, cors);
    let body;
    try { body = await readBounded(request); } catch { return json({ error: 'invalid_body' }, 400, cors); }
    if (!validateBatch(body, project)) return json({ error: 'contract' }, 400, cors);
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), receipt = crypto.randomUUID();
    // The SELECT..WHERE guards the first batch of a UTC day; the ON CONFLICT branch guards every later one.
    const reserve = env.DB.prepare(`INSERT INTO budget(project,day,used,receipt) SELECT ?,?,?,? WHERE ?<=?
      ON CONFLICT(project,day) DO UPDATE SET used=used+excluded.used,receipt=excluded.receipt
      WHERE used+excluded.used<=? RETURNING used`)
      .bind(id, day, body.events.length, receipt, body.events.length, project.dailyLimit, project.dailyLimit);
    // D1 batch is transactional. Receipt gating makes a rejected reservation admit zero events.
    const inserts = body.events.map(e => env.DB.prepare(`INSERT OR IGNORE INTO events
      (project,id,received,session,seq,event,route,release,value)
      SELECT ?,?,?,?,?,?,?,?,? FROM budget WHERE project=? AND day=? AND receipt=?`)
      .bind(id, e.id, now, e.session, e.seq, e.event, e.route, e.release, e.value ?? null, id, day, receipt));
    const result = await env.DB.batch([reserve, ...inserts]);
    if (!result[0].results?.length) return json({ error: 'daily_budget' }, 429, { ...cors, 'Retry-After': '3600' });
    return json({ accepted: true, meaning: 'batch admitted; duplicate event IDs ignored' }, 202, cors);
  } catch { return json({ error: 'unavailable' }, 503, cors); }
}
export async function probeAll(env, transport = fetch, now = Date.now()) {
  for (const [id, project] of Object.entries(projects)) {
    if (!project.probe) continue;
    const start = performance.now(); let ok = false, status = 0;
    try {
      // Workers fetch accepts only 'follow' and 'manual' for redirect ('error' throws before any request is sent,
      // measured on workerd 2026-09-10); with 'manual' a 3xx is a non-ok response, so a redirect still counts as a failure.
      // A same-account Worker is reached through its service binding (public-hostname subrequests fail with 1042).
      const send = project.probe.binding && env[project.probe.binding] ? (url, init) => env[project.probe.binding].fetch(url, init) : transport;
      const r = await send(project.probe.url, { redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Pulseboard-Observatory/0.1 (+synthetic-monitor)' }, cache: 'no-store' });
      status = r.status;
      if (r.body) {
        const reader = r.body.getReader(); let text = '', bytes = 0; const decoder = new TextDecoder();
        try { while (bytes < 131072) { const part = await reader.read(); if (part.done) break;
          bytes += part.value.length; text += decoder.decode(part.value.slice(0, Math.max(0, 131072 - bytes + part.value.length)), { stream: true });
          if (text.includes(project.probe.marker)) break;
        } } finally { await reader.cancel(); }
        ok = r.ok && text.includes(project.probe.marker);
      }
    } catch { /* Only bounded status/timing persists; never exception messages or response content. */ }
    const duration = Math.min(performance.now() - start, 60000);
    const previous = await env.DB.prepare('SELECT * FROM probes WHERE project=?').bind(id).first();
    if (previous && previous.checked >= now) continue;
    const next = monitorTransition(previous, ok, now);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO probes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project) DO UPDATE SET
        state=excluded.state,failures=excluded.failures,successes=excluded.successes,opened=excluded.opened,
        checked=excluded.checked,status=excluded.status,duration=excluded.duration WHERE probes.checked<excluded.checked`)
        .bind(id, next.state, next.failures, next.successes, next.opened, now, status, duration),
      env.DB.prepare('INSERT OR IGNORE INTO probe_history VALUES(?,?,?,?)').bind(id, now, ok ? 1 : 0, duration),
    ]);
  }
}
export async function maintain(env, now = Date.now()) {
  // Product events are kept 90 days and daily aggregates 400 (USAGE_PLAN.md "Consent categories"). Legacy session events keep
  // 14 days: the deployed opt-in embed tells people "Raw events expire after 14 days" (adapters/embed.mjs).
  const dayBefore = days => new Date(now - days * 86400000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE received<?').bind(now - 14 * 86400000),
    env.DB.prepare('DELETE FROM product_events WHERE day<=?').bind(dayBefore(90)),
    env.DB.prepare('DELETE FROM statistics WHERE day<=?').bind(dayBefore(400)),
    env.DB.prepare('DELETE FROM statistics_dimensions WHERE day<=?').bind(dayBefore(400)),
    env.DB.prepare('DELETE FROM budget WHERE day<?').bind(dayBefore(14)),
    env.DB.prepare('DELETE FROM probe_history WHERE checked<?').bind(now - 30 * 86400000),
  ]);
}
// Cloudflare calls scheduled(controller, env, ctx); the fourth parameter exists so tests can inject a transport.
export default { fetch: handle, async scheduled(_controller, env, _ctx, transport = fetch) { await probeAll(env, transport); await maintain(env); } };
