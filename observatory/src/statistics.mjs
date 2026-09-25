/** Aggregate-only Alibi reader. It never reads the legacy session events table. */
import { WINDOWS } from './portfolio.mjs';

export async function readStatistics(db, { days = 7, now = Date.now(), admitted = false } = {}) {
  if (!WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Unsupported window');
  const endDay = new Date(now).toISOString().slice(0, 10);
  const startDay = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const [events, daily] = (await db.batch([
    db.prepare(`SELECT event,SUM(n) AS n FROM statistics
      WHERE project='alibi' AND day>=? AND day<=? GROUP BY event ORDER BY event`).bind(startDay, endDay),
    db.prepare(`SELECT day,SUM(n) AS n FROM statistics
      WHERE project='alibi' AND day>=? AND day<=? GROUP BY day ORDER BY day`).bind(startDay, endDay),
  ])).map(result => result.results);
  return {
    schema: 'pulseboard.statistics/1', project: 'alibi', generatedAt: now,
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
  };
}
