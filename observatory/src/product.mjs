/** Product-event read models for the Desk (USAGE_PLAN.md section 4). Every query is bounded by project and UTC window,
 *  and one D1 batch gives the whole reading one snapshot. Percentiles come from raw values, never from other percentiles. */
import { READ_WINDOWS } from './statistics.mjs';
import { PRODUCT_NAME, cutText } from './product-contract.mjs';
export { cutText };

export const EVENTS_DEFAULT_LIMIT = 500;
export const EVENTS_MAX_LIMIT = 5000;
const JOURNEYS = 100, ERRORS = 100, ERROR_ROWS = 500, VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
/** 100 journeys x 60 steps x at most 64-character names keeps the journeys array near 400 KB, well under 1 MiB. */
export const JOURNEY_STEPS = 60;
/** Largest totals lists the Desk accepts; the top rows by n (ties by value) are kept and `totals.truncated` says so. */
export const TOTALS_CAPS = Object.freeze({ names: 512, routes: 256, releases: 64 });
/** Exits and vitals keep the top rows by n (#123): a forged Origin can otherwise end sessions on many distinct names or report
 *  vitals on many routes, and the Desk refuses a read over its limits. `exitsTruncated` and `vitalsTruncated` say when. */
export const EXITS_CAP = 512, VITALS_CAP = 1280;
const LIMITATIONS = [
  'Product events are client-reported and spoofable; a session is one browser tab, not a person.',
  'Delivery is at most once: failed or dropped batches are missing, and repeated accepted requests store repeated rows.',
  'Daily buckets are UTC calendar days and today is partial.',
  'Diagnostics-only events carry no session and are counted in totals, vitals and errors but not in sessions, journeys or exits.',
  'Session duration is the span between the first and last batch the collector received, so a session delivered in one batch reads 0.',
  'An exit is the last event a session sent inside the window; a session still in progress or cut by the window edge also has one.',
  'Vitals are the nearest-rank 75th percentile of the raw values per metric and route, never an average of percentiles; INP is an approximation.',
  'Journeys show the latest 100 sessions and their first 60 steps; errors show the 100 most frequent kind and message pairs, cut to 64 and 160 characters.',
  'Names, routes and releases show at most 512, 256 and 64 rows by count; a truncated list sums to less than the total.',
  'Exits and vitals show at most 512 and 1,280 rows by count; truncated exits sum to less than the session count.',
  'Properties lose personal, identifier and link keys, e-mail and IP addresses and URL paths before storage; redaction is best effort, not a guarantee of anonymity.',
];
function window(days, now) {
  if (!READ_WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Unsupported window');
  return { startDay: new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10), endDay: new Date(now).toISOString().slice(0, 10),
    days, timezone: 'UTC', partialToday: true };
}
const checkProject = project => {
  if (typeof project !== 'string' || !/^[a-z0-9-]{1,64}$/.test(project)) throw new RangeError('Unsupported project');
};
const W = 'project=? AND day>=? AND day<=?';
const median = source => `(SELECT AVG(v) FROM (SELECT v, ROW_NUMBER() OVER (ORDER BY v) AS r, COUNT(*) OVER () AS c FROM ${source})
  WHERE r IN ((c+1)/2,(c+2)/2))`;

/** The Desk requires non-empty text without control characters. Control characters become spaces and empty text reads
 *  'unknown'; groups that become equal are merged, so every kind and message pair stays unique. */
export const cleanText = (value, max) => cutText(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ') || 'unknown', max);
function errorGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const kind = cleanText(row.kind, 64), message = cleanText(row.message, 160), key = kind + '\u0000' + message, seen = groups.get(key);
    if (seen) { seen.n += Number(row.n); seen.lastSeen = Math.max(seen.lastSeen, Number(row.lastSeen)); }
    else groups.set(key, { kind, message, n: Number(row.n), lastSeen: Number(row.lastSeen) });
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || b.lastSeen - a.lastSeen).slice(0, ERRORS);
}
export async function readProduct(db, { project, days = 7, now = Date.now(), admitted = false } = {}) {
  checkProject(project);
  const w = window(days, now), bind = [project, w.startDay, w.endDay];
  // One row past each cap is read, so truncation is measured rather than guessed. Days are never capped.
  const grouped = (column, cap) => db.prepare(`SELECT ${column},COUNT(*) AS n FROM product_events WHERE ${W}
    GROUP BY ${column} ORDER BY ${cap ? `n DESC,${column}` : column}${cap ? ` LIMIT ${cap + 1}` : ''}`).bind(...bind);
  const sessionsCte = `WITH s AS (SELECT COUNT(*) AS n, MAX(received)-MIN(received) AS d FROM product_events
    WHERE ${W} AND session IS NOT NULL GROUP BY session)`;
  const [totals, names, routes, releases, daily, sessions, journeyRows, exits, vitals, errors] = (await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM product_events WHERE ${W}`).bind(...bind),
    grouped('name', TOTALS_CAPS.names), grouped('route', TOTALS_CAPS.routes), grouped('release', TOTALS_CAPS.releases), grouped('day', 0),
    db.prepare(`${sessionsCte} SELECT (SELECT COUNT(*) FROM s) AS count,
      ${median('(SELECT n AS v FROM s)')} AS medianEvents, ${median('(SELECT d AS v FROM s)')} AS medianDuration`).bind(...bind),
    db.prepare(`WITH latest AS (SELECT session, MIN(received) AS first, MAX(received) AS last, COUNT(*) AS n FROM product_events
        WHERE ${W} AND session IS NOT NULL GROUP BY session ORDER BY last DESC, session LIMIT ${JOURNEYS}),
      steps AS (SELECT p.session, p.name, ROW_NUMBER() OVER (PARTITION BY p.session ORDER BY p.seq, p.received) AS step
        FROM product_events p JOIN latest l ON l.session=p.session WHERE p.project=? AND p.day>=? AND p.day<=?)
      SELECT l.session, l.first, l.last, l.n, s.step, s.name FROM latest l JOIN steps s ON s.session=l.session
      WHERE s.step<=${JOURNEY_STEPS} ORDER BY l.last DESC, l.session, s.step`).bind(...bind, ...bind),
    db.prepare(`WITH ranked AS (SELECT name, ROW_NUMBER() OVER (PARTITION BY session ORDER BY seq DESC, received DESC) AS r
      FROM product_events WHERE ${W} AND session IS NOT NULL)
      SELECT name, COUNT(*) AS n FROM ranked WHERE r=1 GROUP BY name ORDER BY n DESC, name LIMIT ${EXITS_CAP + 1}`).bind(...bind),
    // Nearest rank: the value at position ceil(0.75 * n) of the sorted raw values, per metric and route.
    db.prepare(`WITH v AS (SELECT json_extract(props,'$.metric') AS metric, route, json_extract(props,'$.value') AS value
        FROM product_events WHERE ${W} AND name='web.vital' AND json_type(props,'$.value') IN ('integer','real')
        AND json_extract(props,'$.value')>=0
        AND json_extract(props,'$.metric') IN (${VITALS.map(() => '?').join(',')})),
      r AS (SELECT metric, route, value, ROW_NUMBER() OVER (PARTITION BY metric, route ORDER BY value) AS rn,
        COUNT(*) OVER (PARTITION BY metric, route) AS c FROM v)
      SELECT metric, route, value AS p75, c AS n FROM r WHERE rn=(3*c+3)/4 ORDER BY n DESC, metric, route LIMIT ${VITALS_CAP + 1}`).bind(...bind, ...VITALS),
    // Raw groups; cleaned, cut to the Desk's bounds in JavaScript and re-merged in errorGroups().
    db.prepare(`SELECT CAST(json_extract(props,'$.kind') AS TEXT) AS kind, CAST(json_extract(props,'$.message') AS TEXT) AS message,
      COUNT(*) AS n, MAX(received) AS lastSeen FROM product_events WHERE ${W} AND name='js.error'
      GROUP BY 1, 2 ORDER BY n DESC, lastSeen DESC LIMIT ${ERROR_ROWS}`).bind(...bind),
  ])).map(result => result.results);
  const journeys = [];
  for (const row of journeyRows) {
    let journey = journeys.at(-1);
    if (!journey || journey.session !== row.session) journeys.push(journey = { session: row.session, startedAt: Number(row.first),
      durationMs: Number(row.last) - Number(row.first), steps: [], stepsTruncated: Number(row.n) > JOURNEY_STEPS });
    journey.steps.push(row.name);
  }
  const total = Number(totals[0]?.n || 0), s = sessions[0] || {}, sessionCount = Number(s.count || 0);
  const orNull = value => sessionCount === 0 || value === null || value === undefined ? null : Number(value);
  return {
    schema: 'pulseboard.product/1', project, generatedAt: now, window: w,
    collectionAdmitted: admitted, population: 'client-reported product events', limitations: LIMITATIONS, total,
    totals: {
      names: names.slice(0, TOTALS_CAPS.names).map(row => ({ name: row.name, n: Number(row.n) })),
      routes: routes.slice(0, TOTALS_CAPS.routes).map(row => ({ route: row.route, n: Number(row.n) })),
      releases: releases.slice(0, TOTALS_CAPS.releases).map(row => ({ release: row.release, n: Number(row.n) })),
      days: daily.map(row => ({ day: row.day, n: Number(row.n) })),
      truncated: { names: names.length > TOTALS_CAPS.names, routes: routes.length > TOTALS_CAPS.routes, releases: releases.length > TOTALS_CAPS.releases },
    },
    sessions: { n: sessionCount, medianEvents: orNull(s.medianEvents), medianDurationMs: orNull(s.medianDuration) },
    journeys,
    exits: exits.slice(0, EXITS_CAP).map(row => ({ name: row.name, n: Number(row.n) })),
    exitsTruncated: exits.length > EXITS_CAP,
    // The cap keeps the best-sampled pairs; the table itself stays grouped by metric, then route, like the demo.
    vitals: vitals.slice(0, VITALS_CAP).map(row => ({ metric: row.metric, route: row.route, p75: Number(row.p75), n: Number(row.n) }))
      .sort((a, b) => (a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : a.route < b.route ? -1 : a.route > b.route ? 1 : 0)),
    vitalsTruncated: vitals.length > VITALS_CAP,
    errors: errorGroups(errors),
  };
}

export async function readProductEvents(db, { project, days = 7, now = Date.now(), name = null, limit = EVENTS_DEFAULT_LIMIT } = {}) {
  checkProject(project);
  if (name !== null && (typeof name !== 'string' || !PRODUCT_NAME.test(name))) throw new RangeError('Unsupported name');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EVENTS_MAX_LIMIT) throw new RangeError('Unsupported limit');
  const w = window(days, now);
  const rows = (await db.prepare(`SELECT received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device
    FROM product_events WHERE ${W}${name === null ? '' : ' AND name=?'} ORDER BY received DESC, seq DESC LIMIT ?`)
    .bind(project, w.startDay, w.endDay, ...(name === null ? [] : [name]), limit + 1).all()).results;
  return {
    schema: 'pulseboard.product-events/1', project, generatedAt: now, window: w, name, limit, truncated: rows.length > limit,
    events: rows.slice(0, limit).map(row => ({ received: Number(row.received), day: row.day, session: row.session, seq: Number(row.seq),
      name: row.name, route: row.route, release: row.release, ms: Number(row.ms), props: JSON.parse(row.props), redacted: Number(row.redacted),
      country: row.country, region: row.region, browser: row.browser, os: row.os, device: row.device })),
  };
}
