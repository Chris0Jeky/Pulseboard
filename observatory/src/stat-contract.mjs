import { projects as registry } from './projects.mjs';
import { exactProjectList } from './admission.mjs';
/** Aggregate admission contract (producer half of issue #89; multi-project since #102; v3 context since #104).
 * Accepted body is exactly { v: 1, counts: [...] }, { v: 2, context, counts } or { v: 3, context, counts }
 * with 1..20 counts { event, route, release, n: 1 }. No event IDs, session IDs, puzzle IDs, text, URLs or IPs
 * are accepted or persisted; any unexpected key fails the whole batch closed.
 * Vocabulary is the registered closed vocabulary (project.events, project.routes, project.releases).
 * Each admitted count reserves one unit of the same daily budget and increments one aggregate row. */
export const STAT_VERSION = 1;
export const STAT_CONTEXT_VERSION = 2;
export const STAT_WIDE_VERSION = 3;
export const STAT_MAX_BATCH = 20;
const STAT_COUNT_FIELDS = ['event', 'route', 'release', 'n'];
/** Closed per-visit context a v2 batch carries (USAGE_PLAN.md). Country is never sent by the browser.
 *  public/desk-usage.mjs mirrors this object; the v3 additions live in CONTEXT_V3 below. */
export const DIMENSIONS = Object.freeze({
  device: Object.freeze(['mobile', 'tablet', 'desktop']),
  source: Object.freeze(['direct', 'search', 'social', 'github', 'internal', 'other']),
  visit: Object.freeze(['new', 'returning']),
});
/** A referrer host must contain a dot, so it can never collide with the `none` and `other` sentinels. */
const REFERRER_HOST = /^(?=[a-z0-9.-]*\.)[a-z0-9.-]{3,64}$/;
/** The six-key v3 context: the v2 keys plus colour scheme, referrer host and campaign tag (USAGE_PLAN.md section 1).
 *  A list is a closed vocabulary; a function is a bounded shape. */
export const CONTEXT_V3 = Object.freeze({
  ...DIMENSIONS,
  scheme: Object.freeze(['light', 'dark']),
  referrer: value => value === 'none' || value === 'other' || REFERRER_HOST.test(value),
  campaign: value => /^[a-z0-9_-]{1,40}$/.test(value),
});
/** Open-shaped dimensions whose distinct values per project and UTC day are capped; later new values store `other`. */
export const CAPPED_DIMENSIONS = Object.freeze(['region', 'language', 'referrer', 'campaign']);
export const DIMENSION_CAP = 50;
/** Values that are never capped or counted towards the cap: they are missingness and overflow, not observations. */
export const SENTINELS = Object.freeze(['unknown', 'none', 'other']);
export const BROWSERS = Object.freeze(['chrome', 'edge', 'firefox', 'safari', 'samsung', 'opera', 'other']);
export const OPERATING_SYSTEMS = Object.freeze(['windows', 'macos', 'ios', 'android', 'linux', 'chromeos', 'other']);
/** Every stored dimension, in the order the reader returns them. Server-derived: country, region, browser, os,
 *  language, hour. Browser-derived (v2/v3 context): device, source, visit, scheme, referrer, campaign. */
export const DIMENSION_NAMES = Object.freeze(['country', 'region', 'browser', 'os', 'language', 'hour',
  'device', 'source', 'visit', 'scheme', 'referrer', 'campaign']);
/** Cloudflare's edge country as ISO alpha-2; its Tor (T1), unknown (XX) and missing values read 'unknown'.
 *  Only this code is used: the collector never reads the connecting IP. */
export function statCountry(request) {
  const code = request?.cf?.country;
  return typeof code === 'string' && /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : 'unknown';
}
/** First-level subdivision from the edge (`GB-ENG`), only alongside a known country; anything else reads 'unknown'. */
export function statRegion(request) {
  const country = statCountry(request), code = request?.cf?.regionCode;
  if (country === 'unknown' || typeof code !== 'string') return 'unknown';
  const value = country + '-' + code;
  return /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(value) ? value : 'unknown';
}
const ua = request => {
  const value = request?.headers?.get?.('user-agent');
  return typeof value === 'string' && value.length ? value.slice(0, 512) : null;
};
/** The User-Agent is classified into a closed vocabulary and discarded; the string is never stored or returned.
 *  Order matters: Edge, Samsung and Opera also claim Chrome, and every Chromium and iOS browser claims Safari. */
export function classifyBrowser(value) {
  if (typeof value !== 'string' || !value) return 'unknown';
  if (/\b(?:Edg|EdgA|EdgiOS|Edge)\//.test(value)) return 'edge';
  if (/\bSamsungBrowser\//.test(value)) return 'samsung';
  if (/\b(?:OPR|OPiOS|OPT|Opera)\b/.test(value)) return 'opera';
  if (/\b(?:Firefox|FxiOS)\//.test(value)) return 'firefox';
  if (/\b(?:Chrome|CriOS|Chromium)\//.test(value)) return 'chrome';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(value) || /\b(?:iPhone|iPad|iPod)\b.*\bAppleWebKit\//.test(value)) return 'safari';
  return 'other';
}
export function classifyOs(value) {
  if (typeof value !== 'string' || !value) return 'unknown';
  if (/\b(?:iPhone|iPad|iPod)\b/.test(value)) return 'ios';
  if (/\bAndroid\b/.test(value)) return 'android';
  if (/\bCrOS\b/.test(value)) return 'chromeos';
  if (/\bWindows\b/.test(value)) return 'windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(value)) return 'macos';
  if (/\bLinux\b|\bX11\b/.test(value)) return 'linux';
  return 'other';
}
/** Primary subtag of the first Accept-Language tag, lower-cased; a wildcard or anything unexpected reads 'unknown'. */
export function statLanguage(request) {
  const header = request?.headers?.get?.('accept-language');
  if (typeof header !== 'string') return 'unknown';
  const primary = header.slice(0, 256).split(',')[0].split(';')[0].trim().split('-')[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(primary) ? primary : 'unknown';
}
export const statHour = now => new Date(now).toISOString().slice(11, 13);
/** Dimensions the server derives from the request itself for every contract version. The IP is never read and
 *  the User-Agent and Accept-Language strings are reduced to closed values here and not kept. */
export function serverDimensions(request, now) {
  const agent = ua(request);
  return { country: statCountry(request), region: statRegion(request), browser: classifyBrowser(agent), os: classifyOs(agent),
    language: statLanguage(request), hour: statHour(now) };
}
const UNKNOWN_CONTEXT = Object.freeze({ device: 'unknown', source: 'unknown', visit: 'unknown', scheme: 'unknown', referrer: 'unknown', campaign: 'unknown' });
/** All twelve dimension values for one admitted batch, in DIMENSION_NAMES order. v1 carries no context and v2 no
 *  scheme, referrer or campaign; those read 'unknown'. */
export function batchDimensions(body, request, now) {
  const context = { ...UNKNOWN_CONTEXT, ...(body.v === STAT_VERSION ? {} : body.context) };
  const values = { ...serverDimensions(request, now), ...context };
  return DIMENSION_NAMES.map(name => [name, values[name]]);
}
function validContext(context, vocabulary) {
  if (!context || Object.getPrototypeOf(context) !== Object.prototype) return false;
  const names = Object.keys(vocabulary);
  if (Object.keys(context).length !== names.length) return false;
  return names.every(name => Object.hasOwn(context, name) && typeof context[name] === 'string' &&
    (Array.isArray(vocabulary[name]) ? vocabulary[name].includes(context[name]) : vocabulary[name](context[name])));
}

export function validateStatCount(count, project) {
  if (!count || Object.getPrototypeOf(count) !== Object.prototype) return false;
  const keys = Object.keys(count);
  if (keys.length !== STAT_COUNT_FIELDS.length || keys.some(key => !STAT_COUNT_FIELDS.includes(key))) return false;
  if (typeof count.event !== 'string' || typeof count.route !== 'string' || typeof count.release !== 'string') return false;
  if (!project.events.includes(count.event)) return false;
  if (!project.routes.includes(count.route)) return false;
  if (!project.releases.includes(count.release)) return false;
  if (count.n !== 1) return false;
  return true;
}

export function validateStatBatch(body, project) {
  if (!body || Object.getPrototypeOf(body) !== Object.prototype) return false;
  const keys = Object.keys(body);
  if (body.v === STAT_VERSION) { if (keys.length !== 2 || !keys.includes('counts')) return false; }
  else if (body.v === STAT_CONTEXT_VERSION) { if (keys.length !== 3 || !keys.includes('counts') || !validContext(body.context, DIMENSIONS)) return false; }
  else if (body.v === STAT_WIDE_VERSION) { if (keys.length !== 3 || !keys.includes('counts') || !validContext(body.context, CONTEXT_V3)) return false; }
  else return false;
  if (!Array.isArray(body.counts)) return false;
  if (body.counts.length < 1 || body.counts.length > STAT_MAX_BATCH) return false;
  return body.counts.every(count => validateStatCount(count, project));
}

/** COLLECT_STAT_PROJECTS: see exactProjectList. Independent of COLLECT_PROJECTS (session events);
 *  COLLECT_ENABLED still gates both channels. */
export const statAdmission = (env = {}, projects = registry) => exactProjectList(env.COLLECT_STAT_PROJECTS, projects);
