/** Transactional aggregate read model. No event IDs, session IDs or event rows leave this module. */
import { projects as registry } from './projects.mjs';
import { DAY, fraction, STALE_AFTER } from '../public/desk-model.mjs';
export const WINDOWS = [1, 7, 14];
const LIMITATIONS = [
  'Browser events are opt-in, client-reported and spoofable. Sessions are not people.',
  'Action outcomes count events. Retries and repeated attempts are not deduplicated operations.',
  'Paired flows match session, route and release, in sequence. They are not named-action funnels.',
  'Probe success describes scheduled samples, not time-weighted uptime or a service-level objective.',
  'Release cohorts are descriptive and may differ in users, routes and exposure.',
  'No acquisition attribution, retention cohorts, production tracing or automatic remediation is inferred.',
];
export async function readPortfolio(db, { days = 7, now = Date.now(), collectionEnabled = false, projects = registry } = {}) {
  if (!WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < DAY * days) throw new RangeError('Unsupported window');
  const start = now - days * DAY;
  const ranged = sql => db.prepare(sql).bind(start, now);
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
  ]);
  const [counts, sessions, daily, routes, probes, probeSamples, budgets, flows, timings] = rows.map(r => r.results);
  return { schema: 'pulseboard.portfolio/1', mode: 'live', generatedAt: now, collectionEnabled,
    window: { start, end: now, days, timezone: 'UTC' }, limitations: LIMITATIONS,
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
      return { id, label: config.label, origin: config.origin, probeExpected: Boolean(config.probe),
        monitor: probe ? { state: now - probe.checked > STALE_AFTER ? 'stale' : probe.state,
          checked: probe.checked, opened: probe.opened, status: probe.status, duration: probe.duration,
          failures: probe.failures, successes: probe.successes } : { state: 'unknown', checked: null },
        probeSamples: fraction(samples?.good || 0, samples?.n || 0),
        totals: { events: total(), sessions: sessions.find(row => row.project === id)?.n || 0,
          completed: total('action.completed'), failed: total('action.failed'), errors: total('app.error'),
          last: events.length ? Math.max(...events.map(row => row.last)) : null },
        flow: fraction(flow?.completed || 0, flow?.started || 0),
        daily: daily.filter(row => row.project === id).map(({ day, n }) => ({ day, n })),
        routes: routes.filter(row => row.project === id).map(({ route, n }) => ({ route, n })), releases,
        budget: { used: budgets.find(row => row.project === id)?.used || 0, limit: config.dailyLimit,
          day: new Date(now).toISOString().slice(0, 10) } };
    }) };
}
