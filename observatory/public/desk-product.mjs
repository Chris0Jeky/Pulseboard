/** Product view model: the pulseboard.product/1 summary, the raw-event explorer read and their closed contracts.
 *  Journeys and events are pseudonymous per-session records from opted-in browsers; the Desk renders them as text only.
 *
 *  ASSUMED SHAPES (USAGE_PLAN.md "Data model" 2 and 4; reconcile with src/ when the collector lands — every limit is a constant below):
 *
 *  GET /v1/product/<id>?days=1|7|14|30|90  →
 *  { schema: 'pulseboard.product/1', project, generatedAt: <ms>, mode?: 'demo',
 *    window: { startDay, endDay, days, timezone: 'UTC', partialToday: true },   // same window as pulseboard.statistics/4
 *    collectionAdmitted: <bool>, population: <text ≤120>, limitations: [<text ≤500>] ≤16,
 *    total: <int>,                                                           // events in the window
 *    totals: { names: [{ name, n }], routes: [{ route, n }], releases: [{ release, n }], days: [{ day, n }] },  // each sums to total
 *    sessions: { n: <int>, medianEvents: <number|null>, medianDurationMs: <number|null> },  // null when n is 0
 *    journeys: [{ session: <uuid v4>, startedAt: <ms>, durationMs: <int>, steps: [name] ≤200 }] ≤100,  // newest first
 *    exits: [{ name, n }],                                                   // last step of each session; sums to sessions.n
 *    vitals: [{ metric: LCP|INP|CLS|FCP|TTFB, route, p75: <number ≥0>, n: <int ≥1> }],  // p75 from raw values; CLS unitless, others ms
 *    errors: [{ kind: <text ≤64>, message: <text ≤160>, n: <int ≥1>, lastSeen: <ms> }] ≤100 }
 *
 *  GET /v1/product/<id>/events?days=…&name=…&limit=1..5000  →
 *  { schema: 'pulseboard.product-events/1', project, generatedAt, mode?: 'demo', window: {…as above}, name, limit, truncated: <bool>,
 *    events: [{ received: <ms>, day, session: <uuid v4|null>, seq, name, route, release, ms, props: {…}, redacted: <int>,
 *               country, region, browser, os, device }] ≤limit, newest first, every name equal to the requested name }
 */
import { plain, requireValue, boundedString, list, exactKeys, unique } from './desk-bridge.mjs';
export const PRODUCT_SCHEMA = 'pulseboard.product/1';
export const PRODUCT_EVENTS_SCHEMA = 'pulseboard.product-events/1';
export const PRODUCT_MAX_BYTES = 524288;
/** 5,000 events at up to 2 KiB of props each, plus their envelope. */
export const PRODUCT_EVENTS_MAX_BYTES = 12 * 1048576;
export const PRODUCT_EVENTS_LIMIT = 5000;
export const PRODUCT_WINDOWS = Object.freeze([1, 7, 14, 30, 90]);
export const VITAL_METRICS = Object.freeze(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
/** web.dev "good" and "poor" boundaries for the 75th percentile. INP from the SDK is an approximation. */
export const VITAL_THRESHOLDS = Object.freeze({ LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] });
export const EVENT_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;
const ROUTE = /^[a-z0-9._-]{1,48}$/, RELEASE = /^[0-9A-Za-z.+-]{1,32}$/, PROJECT_ID = /^[a-z0-9-]{1,64}$/;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROP_KEY = /^[A-Za-z0-9_.-]{1,48}$/, UTC_DAY = /^\d{4}-\d\d-\d\d$/;
const LIMITS = { names: 512, routes: 256, releases: 64, journeys: 100, steps: 200, exits: 512, vitals: 5 * 256, errors: 100 };
const DEVICES = ['mobile', 'tablet', 'desktop', 'unknown'];
const whole = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => { requireValue(Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid product integer'); return value; };
const matching = (value, pattern) => { requireValue(typeof value === 'string' && pattern.test(value), 'Invalid product value'); return value; };
const utcDay = value => { requireValue(typeof value === 'string' && UTC_DAY.test(value) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value), 'Invalid UTC day'); return value; };
const medianOrNull = value => requireValue(value === null || (Number.isFinite(value) && value >= 0), 'Invalid median');
const tally = rows => rows.reduce((s, r) => s + r.n, 0);

function productRequest(fetcher, path, token, signal) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher');
  return fetcher(path, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
}
export function requestProduct(fetcher, { project, token, days, signal }) {
  requireValue(typeof project === 'string' && PROJECT_ID.test(project) && PRODUCT_WINDOWS.includes(days), 'Invalid product request');
  return productRequest(fetcher, `/v1/product/${project}?days=${days}`, token, signal);
}
export function requestProductEvents(fetcher, { project, token, days, name, limit = 1000, signal }) {
  requireValue(typeof project === 'string' && PROJECT_ID.test(project) && PRODUCT_WINDOWS.includes(days) && typeof name === 'string' && EVENT_NAME.test(name)
    && Number.isSafeInteger(limit) && limit >= 1 && limit <= PRODUCT_EVENTS_LIMIT, 'Invalid product events request');
  return productRequest(fetcher, `/v1/product/${project}/events?days=${days}&name=${encodeURIComponent(name)}&limit=${limit}`, token, signal);
}

function productWindow(w, days) {
  exactKeys(w, ['startDay', 'endDay', 'days', 'timezone', 'partialToday']);
  requireValue(PRODUCT_WINDOWS.includes(days) && w.days === days && w.timezone === 'UTC' && w.partialToday === true, 'Invalid product window');
  utcDay(w.startDay); utcDay(w.endDay);
  requireValue(Date.parse(w.endDay) - Date.parse(w.startDay) === (days - 1) * 86400000, 'Invalid product window');
}
function productHeader(input, schema, days, project, keys) {
  requireValue(plain(input) && input.schema === schema && input.project === project, 'Unexpected product contract');
  // Closed: an unexpected field (a people-shaped one included) is refused, not ignored. Only the sandbox adds mode.
  exactKeys(input, [...keys, ...(input.mode === 'demo' ? ['mode'] : [])]);
  whole(input.generatedAt);
  productWindow(input.window, days);
}

export function assertProduct(input, days, project) {
  productHeader(input, PRODUCT_SCHEMA, days, project, ['schema', 'project', 'generatedAt', 'window', 'collectionAdmitted', 'population', 'limitations',
    'total', 'totals', 'sessions', 'journeys', 'exits', 'vitals', 'errors']);
  requireValue(typeof input.collectionAdmitted === 'boolean', 'Invalid admission flag');
  boundedString(input.population, 120);
  list(input.limitations, 16).forEach(text => boundedString(text, 500));
  whole(input.total);
  const { window: w, totals: t } = input;
  exactKeys(t, ['names', 'routes', 'releases', 'days']);
  const rows = (value, max, key, check) => { list(value, max).forEach(r => { exactKeys(r, [key, 'n']); check(r[key]); whole(r.n, 1); }); unique(value.map(r => r[key])); };
  rows(t.names, LIMITS.names, 'name', v => matching(v, EVENT_NAME));
  rows(t.routes, LIMITS.routes, 'route', v => matching(v, ROUTE));
  rows(t.releases, LIMITS.releases, 'release', v => matching(v, RELEASE));
  rows(t.days, days, 'day', v => requireValue(utcDay(v) >= w.startDay && v <= w.endDay, 'Day outside window'));
  requireValue([t.names, t.routes, t.releases, t.days].every(xs => tally(xs) === input.total), 'Product totals disagree');
  const s = input.sessions;
  exactKeys(s, ['n', 'medianEvents', 'medianDurationMs']);
  whole(s.n); medianOrNull(s.medianEvents); medianOrNull(s.medianDurationMs);
  requireValue(s.n > 0 || (s.medianEvents === null && s.medianDurationMs === null), 'Median without sessions');
  list(input.journeys, LIMITS.journeys).forEach(j => {
    exactKeys(j, ['session', 'startedAt', 'durationMs', 'steps']);
    matching(j.session, SESSION); whole(j.startedAt); whole(j.durationMs);
    requireValue(list(j.steps, LIMITS.steps).length > 0, 'Empty journey'); j.steps.forEach(step => matching(step, EVENT_NAME));
  });
  unique(input.journeys.map(j => j.session));
  requireValue(input.journeys.length <= s.n, 'More journeys than sessions');
  rows(input.exits, LIMITS.exits, 'name', v => matching(v, EVENT_NAME));
  requireValue(tally(input.exits) === s.n, 'Exits disagree with sessions');
  list(input.vitals, LIMITS.vitals).forEach(v => {
    exactKeys(v, ['metric', 'route', 'p75', 'n']);
    requireValue(VITAL_METRICS.includes(v.metric) && Number.isFinite(v.p75) && v.p75 >= 0, 'Invalid vital'); matching(v.route, ROUTE); whole(v.n, 1);
  });
  unique(input.vitals.map(v => `${v.metric}|${v.route}`));
  list(input.errors, LIMITS.errors).forEach(x => {
    exactKeys(x, ['kind', 'message', 'n', 'lastSeen']);
    boundedString(x.kind, 64); boundedString(x.message, 160); whole(x.n, 1); whole(x.lastSeen);
  });
  unique(input.errors.map(x => `${x.kind}|${x.message}`));
  return input;
}

/** Bounded props as the collector stores them: depth 4, 32 keys per object, 256-character strings, 32-item arrays, finite numbers. */
export function assertProps(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') return requireValue(Number.isFinite(value), 'Invalid prop number');
  if (typeof value === 'string') return requireValue(value.length <= 256, 'Prop string too long');
  requireValue(depth < 4, 'Props nested too deeply');
  if (Array.isArray(value)) { list(value, 32).forEach(item => assertProps(item, depth + 1)); return; }
  requireValue(plain(value) && Object.keys(value).length <= 32, 'Invalid props object');
  for (const [key, item] of Object.entries(value)) { matching(key, PROP_KEY); assertProps(item, depth + 1); }
}

export function assertProductEvents(input, days, project, name) {
  productHeader(input, PRODUCT_EVENTS_SCHEMA, days, project, ['schema', 'project', 'generatedAt', 'window', 'name', 'limit', 'truncated', 'events']);
  requireValue(input.name === name && typeof input.truncated === 'boolean', 'Unexpected events read');
  whole(input.limit, 1, PRODUCT_EVENTS_LIMIT);
  const w = input.window;
  let previous = Infinity;
  list(input.events, input.limit).forEach(x => {
    exactKeys(x, ['received', 'day', 'session', 'seq', 'name', 'route', 'release', 'ms', 'props', 'redacted', 'country', 'region', 'browser', 'os', 'device']);
    requireValue(x.name === name && whole(x.received) <= previous, 'Events out of order or name');
    previous = x.received;
    requireValue(utcDay(x.day) >= w.startDay && x.day <= w.endDay && new Date(x.received).toISOString().startsWith(x.day), 'Event outside window');
    requireValue(x.session === null || SESSION.test(x.session), 'Invalid session');
    whole(x.seq, 1, 1_000_000); whole(x.ms, 0, 86_400_000); whole(x.redacted);
    matching(x.route, ROUTE); matching(x.release, RELEASE);
    requireValue(plain(x.props), 'Props must be an object'); assertProps(x.props);
    for (const key of ['country', 'region', 'browser', 'os']) boundedString(x[key], 16);
    requireValue(DEVICES.includes(x.device), 'Invalid device');
  });
  return input;
}

/** good / needs-improvement / poor at the web.dev boundaries; a value on the "good" boundary is good. */
export function vitalRating(metric, p75) {
  const [good, poor] = VITAL_THRESHOLDS[metric] ?? [];
  if (good === undefined || !Number.isFinite(p75)) return 'unknown';
  return p75 <= good ? 'good' : p75 <= poor ? 'needs-improvement' : 'poor';
}

/** Nearest-rank quantile over raw values; never a mean of quantiles. */
export function rankQuantile(sorted, q) { return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null; }

function flattenProps(value, prefix, out) {
  if (Array.isArray(value)) { for (const item of value) flattenProps(item, `${prefix}[]`, out); return; }
  if (plain(value)) { for (const [key, item] of Object.entries(value)) flattenProps(item, prefix ? `${prefix}.${key}` : key, out); return; }
  (out[prefix] ??= []).push(value);
}
/** Per dotted key: how many events carry it; strings, booleans and nulls as top values; numbers as min / median / p90 / max and a histogram.
 *  Computed in the browser from the rows already read; nothing leaves the tab. */
export function propertyBreakdown(events, { top = 10, bins = 10 } = {}) {
  const keys = new Map();
  for (const event of events) {
    const flat = {}; flattenProps(event.props ?? {}, '', flat);
    for (const [key, values] of Object.entries(flat)) {
      const entry = keys.get(key) ?? { key, present: 0, numbers: [], others: new Map() };
      entry.present++;
      for (const v of values) typeof v === 'number' ? entry.numbers.push(v) : entry.others.set(String(v), (entry.others.get(String(v)) ?? 0) + 1);
      keys.set(key, entry);
    }
  }
  return [...keys.values()].sort((a, b) => b.present - a.present || a.key.localeCompare(b.key)).map(({ key, present, numbers, others }) => {
    const values = [...others].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
    const kind = numbers.length && others.size ? 'mixed' : numbers.length ? 'number' : [...others.keys()].every(v => v === 'true' || v === 'false') ? 'boolean' : 'string';
    const result = { key, kind, present, values: values.slice(0, top), otherValues: Math.max(0, values.length - top), numeric: null };
    if (numbers.length) {
      const sorted = numbers.sort((a, b) => a - b), min = sorted[0], max = sorted.at(-1), count = Math.min(bins, new Set(sorted).size);
      const width = (max - min) / Math.max(1, count), histogram = Array.from({ length: count }, (_, i) => ({ lo: min + i * width, hi: i === count - 1 ? max : min + (i + 1) * width, n: 0 }));
      for (const v of sorted) histogram[width ? Math.min(count - 1, Math.floor((v - min) / width)) : 0].n++;
      result.numeric = { n: sorted.length, min, median: rankQuantile(sorted, 0.5), p90: rankQuantile(sorted, 0.9), max, histogram };
    }
    return result;
  });
}
