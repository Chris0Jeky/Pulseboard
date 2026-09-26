/** Product-event read models for the Desk (USAGE_PLAN.md section 4). Every query is bounded by project and UTC window,
 *  and one D1 batch gives the whole reading one snapshot. Percentiles come from raw values, never from other percentiles. */
import { READ_WINDOWS } from './statistics.mjs';
import { PRODUCT_NAME } from './product-contract.mjs';

export const EVENTS_DEFAULT_LIMIT = 500;
export const EVENTS_MAX_LIMIT = 5000;
const JOURNEYS = 100, JOURNEY_STEPS = 100, GROUPS = 500, VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
const LIMITATIONS = [
  'Product events are client-reported and spoofable; a session is one browser tab, not a person.',
  'Delivery is at most once: failed or dropped batches are missing, and repeated accepted requests store repeated rows.',
  'Daily buckets are UTC calendar days and today is partial.',
  'Diagnostics-only events carry no session and are counted in totals, vitals and errors but not in sessions, journeys or exits.',
  'Session duration is the span between the first and last batch the collector received, so a session delivered in one batch reads 0.',
  'An exit is the last event a session sent inside the window; a session still in progress or cut by the window edge also has one.',
  'Vitals are the nearest-rank 75th percentile of the raw values per metric and route, never an average of percentiles; INP is an approximation.',
  'Journeys show the latest 100 sessions and their first 100 steps; groups of names, routes, releases and errors are capped.',
  'Properties are redacted of personal keys and e-mail-looking text before storage; redaction is best effort, not a guarantee of anonymity.',
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

export async function readProduct(db, { project, days = 7, now = Date.now(), admitted = false } = {}) {
  checkProject(project);
  const w = window(days, now), bind = [project, w.startDay, w.endDay];
  const grouped = (column, order) => db.prepare(`SELECT ${column},COUNT(*) AS n FROM product_events WHERE ${W}
    GROUP BY ${column} ORDER BY ${order} LIMIT ${GROUPS}`).bind(...bind);
  const sessionsCte = `WITH s AS (SELECT COUNT(*) AS n, MAX(received)-MIN(received) AS d FROM product_events
    WHERE ${W} AND session IS NOT NULL GROUP BY session)`;
  const [totals, names, routes, releases, daily, sessions, journeyRows, exits, vitals, errors] = (await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, SUM(redacted) AS redacted FROM product_events WHERE ${W}`).bind(...bind),
    grouped('name', 'n DESC,name'), grouped('route', 'n DESC,route'), grouped('release', 'release'), grouped('day', 'day'),
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
      SELECT name, COUNT(*) AS n FROM ranked WHERE r=1 GROUP BY name ORDER BY n DESC, name LIMIT ${GROUPS}`).bind(...bind),
    // Nearest rank: the value at position ceil(0.75 * n) of the sorted raw values, per metric and route.
    db.prepare(`WITH v AS (SELECT json_extract(props,'$.metric') AS metric, route, json_extract(props,'$.value') AS value
        FROM product_events WHERE ${W} AND name='web.vital' AND json_type(props,'$.value') IN ('integer','real')
        AND json_extract(props,'$.metric') IN (${VITALS.map(() => '?').join(',')})),
      r AS (SELECT metric, route, value, ROW_NUMBER() OVER (PARTITION BY metric, route ORDER BY value) AS rn,
        COUNT(*) OVER (PARTITION BY metric, route) AS c FROM v)
      SELECT metric, route, value AS p75, c AS n FROM r WHERE rn=(3*c+3)/4 ORDER BY metric, route`).bind(...bind, ...VITALS),
    db.prepare(`SELECT json_extract(props,'$.kind') AS kind, json_extract(props,'$.message') AS message, COUNT(*) AS n,
      MAX(received) AS lastSeen FROM product_events WHERE ${W} AND name='js.error'
      GROUP BY kind, message ORDER BY n DESC, lastSeen DESC LIMIT ${GROUPS}`).bind(...bind),
  ])).map(result => result.results);
  const journeys = [];
  for (const row of journeyRows) {
    let journey = journeys.at(-1);
    if (!journey || journey.key !== row.session) journeys.push(journey = { key: row.session, startedAt: Number(row.first),
      lastSeen: Number(row.last), durationMs: Number(row.last) - Number(row.first), events: Number(row.n), truncated: Number(row.n) > JOURNEY_STEPS, steps: [] });
    journey.steps.push(row.name);
  }
  const total = Number(totals[0]?.n || 0), s = sessions[0] || {};
  const number = value => value === null || value === undefined ? null : Number(value);
  const text = value => value === null || value === undefined ? null : String(value);
  return {
    schema: 'pulseboard.product/1', project, generatedAt: now, window: w,
    collectionAdmitted: admitted, observationStatus: total ? 'observed' : 'no-admitted-events',
    population: 'client-reported product events', limitations: LIMITATIONS,
    total, redactedKeys: Number(totals[0]?.redacted || 0),
    names: names.map(row => ({ name: row.name, n: Number(row.n) })),
    routes: routes.map(row => ({ route: row.route, n: Number(row.n) })),
    releases: releases.map(row => ({ release: row.release, n: Number(row.n) })),
    daily: daily.map(row => ({ day: row.day, n: Number(row.n) })),
    sessions: { count: Number(s.count || 0), medianEvents: number(s.medianEvents), medianDurationMs: number(s.medianDuration) },
    // The per-tab session id stays in storage; a journey is identified here only by its position.
    journeys: journeys.map(({ key: _key, ...journey }) => journey),
    exits: exits.map(row => ({ name: row.name, n: Number(row.n) })),
    vitals: vitals.map(row => ({ metric: row.metric, route: row.route, p75: Number(row.p75), n: Number(row.n) })),
    errors: errors.map(row => ({ kind: text(row.kind), message: text(row.message), n: Number(row.n), lastSeen: Number(row.lastSeen) })),
  };
}

export async function readProductEvents(db, { project, days = 7, now = Date.now(), name = null, limit = EVENTS_DEFAULT_LIMIT, admitted = false } = {}) {
  checkProject(project);
  if (name !== null && (typeof name !== 'string' || !PRODUCT_NAME.test(name))) throw new RangeError('Unsupported name');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EVENTS_MAX_LIMIT) throw new RangeError('Unsupported limit');
  const w = window(days, now);
  const rows = (await db.prepare(`SELECT received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device
    FROM product_events WHERE ${W}${name === null ? '' : ' AND name=?'} ORDER BY received DESC, seq DESC LIMIT ?`)
    .bind(project, w.startDay, w.endDay, ...(name === null ? [] : [name]), limit + 1).all()).results;
  return {
    schema: 'pulseboard.product-events/1', project, generatedAt: now, window: w, collectionAdmitted: admitted,
    name, limit, truncated: rows.length > limit, limitations: LIMITATIONS,
    events: rows.slice(0, limit).map(row => ({ received: Number(row.received), day: row.day, session: row.session, seq: Number(row.seq),
      name: row.name, route: row.route, release: row.release, ms: Number(row.ms), props: JSON.parse(row.props), redacted: Number(row.redacted),
      country: row.country, region: row.region, browser: row.browser, os: row.os, device: row.device })),
  };
}
