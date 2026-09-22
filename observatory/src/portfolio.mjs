/** Transactional aggregate read model. No event IDs, session IDs or event rows leave this module. */
import { projects as registry } from './projects.mjs';
import { DAY, fraction } from '../public/desk-model.mjs';
// One freshness rule for both server read models. public/desk-model.mjs keeps its own copy for the
// browser, which must not import from src/; the two must stay in step.
import { monitorState } from './contracts.mjs';
export const WINDOWS = [1, 7, 14];
const LIMITATIONS = [
  'Browser events are opt-in, client-reported and spoofable. Sessions are not people.',
  'Action outcomes count events. Retries and repeated attempts are not deduplicated operations.',
  'Paired flows match session, route and release, in sequence. They are not named-action funnels.',
  'Named operations pair a registered start with the first registered terminal event before the next start. Open attempts may mean abandonment, withdrawal, outage or lost delivery.',
  'Probe success describes scheduled samples, not time-weighted uptime or a service-level objective.',
  'Release cohorts are descriptive and may differ in users, routes and exposure.',
  'No acquisition attribution, retention cohorts, production tracing or automatic remediation is inferred.',
];
/** A probe that reaches its target through a Cloudflare service binding proves the application answers, not that its
 *  public edge does; the read model says so next to the readings instead of leaving it to a deployment note. */
export function limitations(projects = registry) {
  const bound = Object.values(projects).filter(p => p.probe?.binding).map(p => p.label);
  return bound.length ? [...LIMITATIONS, `${bound.join(' and ')} are probed through a service binding inside Cloudflare: an up reading proves the application answers, not that its public address does.`] : LIMITATIONS;
}
function operationDefinitions(projects) {
  return Object.entries(projects).flatMap(([project, config]) => (config.operations || []).map(operation => ({ project, ...operation })));
}
function operationQuery(db, operation, start, end) {
  return db.prepare(`WITH starts AS (
    SELECT project,session,route,release,seq,
      ROW_NUMBER() OVER (PARTITION BY project,session,route,release ORDER BY seq) AS ordinal,
      LEAD(seq) OVER (PARTITION BY project,session,route,release ORDER BY seq) AS next_seq
    FROM events WHERE project=? AND received>=? AND received<? AND event=?
  ), resolved AS (
    SELECT release,ordinal,(
      SELECT b.event FROM events b
      WHERE b.project=s.project AND b.session=s.session AND b.route=s.route AND b.release=s.release
      AND b.event IN (?,?) AND b.seq>s.seq AND (s.next_seq IS NULL OR b.seq<s.next_seq)
      AND b.received>=? AND b.received<? ORDER BY b.seq LIMIT 1
    ) AS terminal FROM starts s
  ) SELECT release,COUNT(*) AS attempts,
    SUM(CASE WHEN terminal=? THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN terminal=? THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN terminal IS NULL THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN ordinal>1 THEN 1 ELSE 0 END) AS retries
    FROM resolved GROUP BY release ORDER BY release`)
    .bind(operation.project, start, end, operation.started, operation.completed, operation.failed,
      start, end, operation.completed, operation.failed);
}
export async function readPortfolio(db, { days = 7, now = Date.now(), collectionEnabled = false, admittedProjects = [], projects = registry } = {}) {
  if (!WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < DAY * days || !Array.isArray(admittedProjects) || admittedProjects.some(id => typeof id !== 'string')) throw new RangeError('Unsupported window or admission');
  const admitted = new Set(admittedProjects);
  const start = now - days * DAY;
  const ranged = sql => db.prepare(sql).bind(start, now);
  const operationDefs = operationDefinitions(projects);
  // D1 batches are transactional. The local D1 adapter supplies the same boundary.
  const rows = await db.batch([
    ranged(`SELECT project, event, release, COUNT(*) AS n, MAX(received) AS last
      FROM events WHERE received >= ? AND received < ? GROUP BY project,event,release`),
    ranged(`SELECT project, COUNT(DISTINCT session) AS n FROM events
      WHERE received >= ? AND received < ? GROUP BY project`),
    ranged(`SELECT project, CAST(received / 86400000 AS INTEGER) AS day, COUNT(*) AS n
      FROM events WHERE received >= ? AND received < ? GROUP BY project,day ORDER BY day`),
    ranged(`SELECT project, route, COUNT(*) AS n FROM events
      WHERE received >= ? AND received < ? GROUP BY project,route ORDER BY n DESC`),
    db.prepare('SELECT * FROM probes'),
    ranged(`SELECT project, COUNT(*) AS n, SUM(ok) AS good, MAX(checked) AS last
      FROM probe_history WHERE checked >= ? AND checked < ? GROUP BY project`),
    db.prepare('SELECT project,used FROM budget WHERE day=?').bind(new Date(now).toISOString().slice(0, 10)),
    db.prepare(`WITH starts AS (
      SELECT project,session,route,release,MIN(seq) AS seq FROM events
      WHERE received >= ? AND received < ? AND event='action.requested'
      GROUP BY project,session,route,release
    ) SELECT a.project,COUNT(*) AS started,SUM(CASE WHEN EXISTS (
      SELECT 1 FROM events b WHERE b.project=a.project AND b.session=a.session
      AND b.route=a.route AND b.release=a.release AND b.event='action.completed'
      AND b.seq>a.seq AND b.received>=? AND b.received<?
    ) THEN 1 ELSE 0 END) AS completed FROM starts a GROUP BY a.project`).bind(start, now, start, now),
    ranged(`WITH ranked AS (
      SELECT project,release,value,ROW_NUMBER() OVER (PARTITION BY project,release ORDER BY value) AS rank,
      COUNT(*) OVER (PARTITION BY project,release) AS n FROM events
      WHERE received>=? AND received<? AND event='duration.ms' AND value IS NOT NULL
    ) SELECT project,release,MAX(n) AS n,AVG(value) AS mean,
      MAX(CASE WHEN rank=CAST((n*95+99)/100 AS INTEGER) THEN value ELSE NULL END) AS p95
      FROM ranked GROUP BY project,release`),
    ...operationDefs.map(operation => operationQuery(db, operation, start, now)),
  ]);
  const [counts, sessions, daily, routes, probes, probeSamples, budgets, flows, timings, ...operationRows] = rows.map(r => r.results);
  const operationEvidence = operationDefs.map((operation, index) => ({ ...operation, rows: operationRows[index] || [] }));
  return { schema: 'pulseboard.portfolio/2', mode: 'live', generatedAt: now, collectionEnabled,
    window: { start, end: now, days, timezone: 'UTC' }, limitations: limitations(projects),
    projects: Object.entries(projects).map(([id, config]) => {
      const events = counts.filter(row => row.project === id);
      const total = event => events.filter(row => !event || row.event === event).reduce((n, row) => n + row.n, 0);
      const probe = probes.find(row => row.project === id);
      const samples = probeSamples.find(row => row.project === id);
      const flow = flows.find(row => row.project === id);
      const releases = [...new Set(events.map(row => row.release))].map(release => {
        const selected = events.filter(row => row.release === release);
        const n = event => selected.filter(row => !event || row.event === event).reduce((sum, row) => sum + row.n, 0);
        const timing = timings.find(row => row.project === id && row.release === release);
        return { release, events: n(), completed: n('action.completed'), failed: n('action.failed'), errors: n('app.error'),
          last: Math.max(...selected.map(row => row.last)), duration: timing ? { n: timing.n, mean: timing.mean, p95: timing.p95, unit: 'ms', method: 'nearest-rank' } : null };
      }).sort((a, b) => b.last - a.last || a.release.localeCompare(b.release));
      const operations = operationEvidence.filter(operation => operation.project === id).map(operation => {
        const operationReleases = operation.rows.map(row => ({
          release: row.release,
          attempts: Number(row.attempts || 0),
          completed: Number(row.completed || 0),
          failed: Number(row.failed || 0),
          open: Number(row.open || 0),
          retries: Number(row.retries || 0),
        }));
        const sum = key => operationReleases.reduce((value, row) => value + row[key], 0);
        const attempts = sum('attempts'), completed = sum('completed');
        return { id: operation.id, version: operation.version, attempts, completed, failed: sum('failed'),
          open: sum('open'), retries: sum('retries'), completion: fraction(completed, attempts), releases: operationReleases };
      });
      const collectionEligible = Boolean(config.origin);
      return { id, label: config.label, origin: config.origin, probeExpected: Boolean(config.probe),
        collectionEligible, collectionAdmitted: collectionEnabled === true && collectionEligible && admitted.has(id),
        monitor: probe ? { state: monitorState(probe, now),
          checked: probe.checked, opened: probe.opened, status: probe.status, duration: probe.duration,
          failures: probe.failures, successes: probe.successes } : { state: 'unknown', checked: null },
        probeSamples: fraction(samples?.good || 0, samples?.n || 0),
        totals: { events: total(), sessions: sessions.find(row => row.project === id)?.n || 0,
          completed: total('action.completed'), failed: total('action.failed'), errors: total('app.error'),
          last: events.length ? Math.max(...events.map(row => row.last)) : null },
        flow: fraction(flow?.completed || 0, flow?.started || 0), operations,
        daily: daily.filter(row => row.project === id).map(({ day, n }) => ({ day, n })),
        routes: routes.filter(row => row.project === id).map(({ route, n }) => ({ route, n })), releases,
        budget: { used: budgets.find(row => row.project === id)?.used || 0, limit: config.dailyLimit,
          day: new Date(now).toISOString().slice(0, 10) } };
    }) };
}
