import { projects } from './projects.mjs';
import { validateBatch, readBounded, monitorTransition, monitorState, interval } from './contracts.mjs';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
export const SCHEMA_VERSION = 1;
// Naming every column means a database missing a later-added column fails readiness instead of failing a request.
const READINESS = [
  'SELECT project,day,used,receipt FROM budget LIMIT 0',
  'SELECT project,id,received,session,seq,event,route,release,value FROM events LIMIT 0',
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
export async function summary(db, now = Date.now()) {
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
  return { generated: now, windowDays: 7, provenance: 'client-reported, opt-in; not verified people',
    projects: Object.entries(projects).map(([id, p]) => {
      const probe = probes.find(x => x.project === id), funnel = funnels.find(x => x.project === id);
      return { id, label: p.label, configuredOrigin: p.origin, probeExpected: !!p.probe,
        monitor: probe ? { ...probe, state: monitorState(probe, now) } : { state: 'unknown' },
        counts: counts.filter(x => x.project === id), sessions: sessions.find(x => x.project === id)?.n || 0,
        daily: daily.filter(x => x.project === id),
        funnel: funnel ? { ...funnel, interval: interval(funnel.completed, funnel.started) } : null,
        budgetUsed: budgets.find(x => x.project === id)?.used || 0, budgetLimit: p.dailyLimit };
    }) };
}
export async function handle(request, env) {
  const url = new URL(request.url);
  // Held outside the try so an unexpected failure after the origin match is still readable by the calling page.
  let cors = {};
  try {
    if (request.method === 'GET' && ['/', '/index.html', '/dashboard.mjs', '/dashboard.css'].includes(url.pathname) && env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      const h = new Headers(response.headers);
      h.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      h.set('Cache-Control', 'no-store'); h.set('Referrer-Policy', 'no-referrer'); h.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers: h });
    }
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method' }, 405, { Allow: 'GET, HEAD' });
      if (url.pathname === '/healthz') return json({ live: true, productData: 'not checked' });
      return json({ ready: true, schema: await ready(env.DB) });
    }
    if (url.pathname === '/v1/summary' && request.method === 'GET') {
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      return json(await summary(env.DB));
    }
    const match = /^\/v1\/collect\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match) return json({ error: 'not_found' }, 404);
    const id = match[1], project = Object.hasOwn(projects, id) ? projects[id] : null;
    if (!project || !project.origin || request.headers.get('origin') !== project.origin) return json({ error: 'origin' }, 403);
    cors = { 'Access-Control-Allow-Origin': project.origin, 'Vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors,
      'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
    if (env.COLLECT_ENABLED !== 'true') return json({ error: 'disabled' }, 503, cors);
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
      const r = await transport(project.probe.url, { redirect: 'error', signal: AbortSignal.timeout(8000),
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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE received<?').bind(now - 14 * 86400000),
    env.DB.prepare('DELETE FROM budget WHERE day<?').bind(new Date(now - 14 * 86400000).toISOString().slice(0, 10)),
    env.DB.prepare('DELETE FROM probe_history WHERE checked<?').bind(now - 30 * 86400000),
  ]);
}
// Cloudflare calls scheduled(controller, env, ctx); the fourth parameter exists so tests can inject a transport.
export default { fetch: handle, async scheduled(_controller, env, _ctx, transport = fetch) { await probeAll(env, transport); await maintain(env); } };
