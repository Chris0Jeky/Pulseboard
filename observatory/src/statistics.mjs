/** Aggregate-only statistics reader for one project. It never reads the legacy session events table. */
import { DIMENSION_NAMES } from './stat-contract.mjs';
/** Statistics and product reads (USAGE_PLAN.md section 4); /v1/portfolio keeps its own 1, 7 and 14. */
export const READ_WINDOWS = Object.freeze([1, 7, 14, 30, 90]);

export async function readStatistics(db, { project = 'alibi', days = 7, now = Date.now(), admitted = false } = {}) {
  if (typeof project !== 'string' || !/^[a-z0-9-]{1,64}$/.test(project)) throw new RangeError('Unsupported project');
  if (!READ_WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Unsupported window');
  const endDay = new Date(now).toISOString().slice(0, 10);
  const startDay = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const grouped = (columns, order = columns) => db.prepare(`SELECT ${columns},SUM(n) AS n FROM statistics
    WHERE project=? AND day>=? AND day<=? GROUP BY ${columns} ORDER BY ${order}`).bind(project, startDay, endDay);
  const [events, daily, routes, releases, eventDaily, dimensionRows] = (await db.batch([
    grouped('event'), grouped('day'), grouped('route', 'n DESC,route'), grouped('release', 'release'), grouped('day,event'),
    db.prepare(`SELECT dimension,value,SUM(n) AS n FROM statistics_dimensions
      WHERE project=? AND day>=? AND day<=? GROUP BY dimension,value ORDER BY dimension,n DESC,value`).bind(project, startDay, endDay),
  ])).map(result => result.results);
  const total = events.reduce((sum, row) => sum + Number(row.n), 0);
  // Counts admitted before a dimension was recorded (schema 3 or 4) have no row for it; they are shown as 'unknown', never dropped or guessed.
  const dimensions = Object.fromEntries(DIMENSION_NAMES.map(name => {
    const rows = dimensionRows.filter(row => row.dimension === name).map(row => ({ value: row.value, n: Number(row.n) }));
    const missing = total - rows.reduce((sum, row) => sum + row.n, 0);
    const unknown = rows.find(row => row.value === 'unknown');
    if (missing > 0) { if (unknown) unknown.n += missing; else rows.push({ value: 'unknown', n: missing }); }
    return [name, rows];
  }));
  return {
    schema: 'pulseboard.statistics/4', project, generatedAt: now,
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
      'Every dimension is a separate total, never crossed with another dimension or with events; counts from before it was recorded read unknown.',
      'Browser and operating system are classified from the User-Agent on the server, which is not kept; language is the first Accept-Language tag; hour is the UTC hour the collector received the batch.',
      'Region is the first-level subdivision Cloudflare reports and reads unknown where the edge gives none.',
    ],
    total,
    events: events.map(row => ({ event: row.event, n: Number(row.n) })),
    daily: daily.map(row => ({ day: row.day, n: Number(row.n) })),
    routes: routes.map(row => ({ route: row.route, n: Number(row.n) })),
    releases: releases.map(row => ({ release: row.release, n: Number(row.n) })),
    eventDaily: eventDaily.map(row => ({ day: row.day, event: row.event, n: Number(row.n) })),
    dimensions,
  };
}
