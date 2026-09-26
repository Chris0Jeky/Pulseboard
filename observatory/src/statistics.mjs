/** Aggregate-only statistics reader for one project. It never reads the legacy session events table. */
import { WINDOWS } from './portfolio.mjs';

export async function readStatistics(db, { project = 'alibi', days = 7, now = Date.now(), admitted = false } = {}) {
  if (typeof project !== 'string' || !/^[a-z0-9-]{1,64}$/.test(project)) throw new RangeError('Unsupported project');
  if (!WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Unsupported window');
  const endDay = new Date(now).toISOString().slice(0, 10);
  const startDay = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const grouped = (columns, order = columns) => db.prepare(`SELECT ${columns},SUM(n) AS n FROM statistics
    WHERE project=? AND day>=? AND day<=? GROUP BY ${columns} ORDER BY ${order}`).bind(project, startDay, endDay);
  const [events, daily, routes, releases, eventDaily] = (await db.batch([
    grouped('event'), grouped('day'), grouped('route', 'n DESC,route'), grouped('release', 'release'), grouped('day,event'),
  ])).map(result => result.results);
  return {
    schema: 'pulseboard.statistics/2', project, generatedAt: now,
    window: { startDay, endDay, days, timezone: 'UTC', partialToday: true },
    collectionAdmitted: admitted, observationStatus: events.length ? 'observed' : 'no-admitted-counts',
    population: 'aggregate browser counts',
    limitations: [
      'Counts are client-reported events, not verified people or sessions.',
      'Repeated attempts and repeated accepted requests count repeatedly; delivery failures are missing.',
      'Daily buckets are UTC calendar days and today is partial.',
      'These counts are separate from the legacy opt-in portfolio and must not be added to its journey or flow metrics.',
      'When collection is not admitted, a zero is not evidence of no traffic.',
      'No paired flows, unique visitors, retention, or conversion rates can be measured from these counts.',
    ],
    total: events.reduce((sum, row) => sum + Number(row.n), 0),
    events: events.map(row => ({ event: row.event, n: Number(row.n) })),
    daily: daily.map(row => ({ day: row.day, n: Number(row.n) })),
    routes: routes.map(row => ({ route: row.route, n: Number(row.n) })),
    releases: releases.map(row => ({ release: row.release, n: Number(row.n) })),
    eventDaily: eventDaily.map(row => ({ day: row.day, event: row.event, n: Number(row.n) })),
  };
}
