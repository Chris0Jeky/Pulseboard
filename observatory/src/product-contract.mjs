/** Product-event admission contract `pulseboard.product-batch/1` (USAGE_PLAN.md section 2).
 * Body is exactly { v: 1, session: <uuid v4> | null, release, context: { device }, events: [1..20] } and each event
 * exactly { name, route, seq, ms } plus an optional bounded `props` object. Shape and size are closed; property
 * content is open, so personal keys, e-mail and IP addresses and URL paths are redacted on the server before storage.
 * Redaction is never a rejection: a batch that only needed redacting is admitted and records what it lost. */
export const PRODUCT_VERSION = 1;
export const PRODUCT_MAX_BATCH = 20;
export const PRODUCT_DEFAULT_LIMIT = 20000;
export const PRODUCT_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RELEASE = /^[0-9A-Za-z.+-]{1,32}$/;
const ROUTE = /^[a-z0-9._-]{1,48}$/;
const KEY = /^[A-Za-z0-9_.-]{1,48}$/;
const DEVICES = ['mobile', 'tablet', 'desktop'];
const BODY_KEYS = ['v', 'session', 'release', 'context', 'events'];
const EVENT_KEYS = ['name', 'route', 'seq', 'ms', 'props'];
export const PROPS_BOUNDS = Object.freeze({ depth: 4, keys: 32, string: 256, array: 32, bytes: 2048 });
/** Compared after lower-casing and removing `_`, `-` and `.`. */
export const PERSONAL_KEYS = Object.freeze(new Set(['email', 'emailaddress', 'password', 'passwd', 'pwd', 'phone', 'phonenumber',
  'mobile', 'token', 'accesstoken', 'refreshtoken', 'secret', 'apikey', 'ip', 'ipaddress', 'address', 'streetaddress', 'postcode',
  'zipcode', 'ssn', 'iban', 'cardnumber', 'cvv', 'dob', 'dateofbirth', 'firstname', 'lastname', 'fullname', 'username',
  // Added after the plan review: names a product might hold for a person. A bare `name` stays allowed (puzzle names).
  'nickname', 'displayname', 'player', 'playername', 'user', 'handle', 'realname', 'surname', 'givenname',
  // Added after the Codex review of the plan: identifiers, addresses and links.
  'userid', 'uid', 'clientip', 'ipaddr', 'remoteaddr', 'url', 'href']));
const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[A-Za-z]{2,}/g;
/** `scheme://[user@]host[:port]/path?query#fragment` keeps only the host. */
const URL_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/?#@]*@)?(?:\[([0-9a-f:.]+)\]|([^\s/?#:[\]]+))[^\s]*/gi;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?![\\d.])`, 'g');
// Full eight-group form, or a compressed form with `::` and at least one group. A clock time such as 12:30:45 has neither.
const H = '[0-9a-f]{1,4}';
const IPV6 = new RegExp(`(?<![0-9a-z:])(?:(?:${H}:){7}${H}|(?:${H}:){1,7}:(?:${H}(?::${H}){0,6})?|::${H}(?::${H}){0,6})(?![0-9a-z:])`, 'gi');
/** Free text keeps its words but loses links (cut to the host), e-mail addresses and IP addresses. */
export const scrubText = value => value.replace(URL_TEXT, (_, bracketed, host) => bracketed ?? host).replace(EMAIL, '[email]').replace(IPV6, '[ip]').replace(IPV4, '[ip]');
const plain = value => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, required, optional = []) => {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key));
};

/** Structural bounds on one props value: depth counts the props object itself as level 1. */
function boundedValue(value, depth) {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= PROPS_BOUNDS.string;
  if (depth > PROPS_BOUNDS.depth) return false;
  if (Array.isArray(value)) return value.length <= PROPS_BOUNDS.array && value.every(item => boundedValue(item, depth + 1));
  if (!plain(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= PROPS_BOUNDS.keys && keys.every(key => KEY.test(key) && boundedValue(value[key], depth + 1));
}
export function validateProps(props) {
  if (!plain(props) || !boundedValue(props, 1)) return false;
  return new TextEncoder().encode(JSON.stringify(props)).byteLength <= PROPS_BOUNDS.bytes;
}
export const personalKey = key => PERSONAL_KEYS.has(key.toLowerCase().replace(/[_.-]/g, ''));
/** Returns { props, redacted }: personal keys removed at every depth (counted); in strings, e-mail-looking text becomes
 *  `[email]`, IPv4 and IPv6 addresses `[ip]`, and `scheme://` URLs their host.
 *  Object.fromEntries defines own properties, so a `__proto__` key stays data and never reaches a prototype. */
export function redactProps(props) {
  let redacted = 0;
  const walk = value => {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map(walk);
    if (plain(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => {
      if (!personalKey(key)) return true;
      redacted++; return false;
    }).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return { props: walk(props), redacted };
}
export function validateProductEvent(event) {
  if (!plain(event) || !exactKeys(event, EVENT_KEYS.slice(0, 4), ['props'])) return false;
  return typeof event.name === 'string' && PRODUCT_NAME.test(event.name)
    && typeof event.route === 'string' && ROUTE.test(event.route)
    && Number.isSafeInteger(event.seq) && event.seq >= 1 && event.seq <= 1000000
    // performance.now() is fractional; any finite value in range is admitted and stored rounded.
    && typeof event.ms === 'number' && Number.isFinite(event.ms) && event.ms >= 0 && event.ms <= 86400000
    && (event.props === undefined || validateProps(event.props));
}
/** EU 27 plus Iceland, Liechtenstein and Norway (USAGE_PLAN.md "Consent categories"). */
export const EEA = Object.freeze(new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']));
/** The region hint for GET /v1/consent/<id>. An unknown, Tor or missing edge country is treated as EEA. */
export function consentRegion(request) {
  const code = request?.cf?.country;
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || code === 'XX') return 'eea';
  return EEA.has(code) ? 'eea' : 'other';
}
export function validateProductBatch(body) {
  if (!plain(body) || !exactKeys(body, BODY_KEYS) || body.v !== PRODUCT_VERSION) return false;
  if (body.session !== null && (typeof body.session !== 'string' || !UUID_V4.test(body.session))) return false;
  if (typeof body.release !== 'string' || !RELEASE.test(body.release)) return false;
  if (!plain(body.context) || !exactKeys(body.context, ['device']) || !DEVICES.includes(body.context.device)) return false;
  if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > PRODUCT_MAX_BATCH) return false;
  return body.events.every(validateProductEvent);
}
