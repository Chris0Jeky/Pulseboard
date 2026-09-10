// SPDX-License-Identifier: GPL-3.0-only
// Security receipts are server-side evidence. Never share producer credentials with a browser.
export const KINDS = Object.freeze(['http.request', 'http.error', 'auth.failure', 'access.denied',
  'rate_limited', 'waf.block', 'egress.unexpected', 'host.unexpected', 'exposure.unexpected',
  'check.ok', 'check.error', 'scan.finding', 'sensor.heartbeat']);
export const LIMITS = Object.freeze({ bytes: 16384, batch: 25, sources: 12, assets: 24,
  daily: 20000, retentionDays: 7, ledger: 200, bodyMs: 5000 });
export const DAY = 86400000;
export const plain = x => !!x && typeof x === 'object' && !Array.isArray(x)
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, required, optional = []) => plain(x) && required.every(k => Object.hasOwn(x, k))
  && Object.keys(x).every(k => required.includes(k) || optional.includes(k));
const id = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(x);
const integer = (x, lo, hi) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const secret = x => typeof x === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(x) && !x.startsWith('REPLACE_');
const unique = a => new Set(a).size === a.length;
export function sourcesFrom(env) {
  const text = env.WATCH_SOURCES_JSON || '[]';
  if (typeof text !== 'string' || text.length > 32768) throw new Error('configuration');
  const sources = JSON.parse(text);
  if (!Array.isArray(sources) || sources.length > LIMITS.sources) throw new Error('configuration');
  for (const s of sources) {
    if (!exact(s, ['id', 'project', 'environment', 'kind', 'token', 'assets', 'allowedKinds',
      'heartbeatSeconds', 'dailyLimit', 'enabled']) || !id(s.id) || !id(s.project) || !id(s.environment)
      || !['edge', 'app', 'scanner', 'host'].includes(s.kind) || !secret(s.token)
      || typeof s.enabled !== 'boolean' || !integer(s.heartbeatSeconds, 30, 86400)
      || !integer(s.dailyLimit, 1, LIMITS.daily) || !Array.isArray(s.assets)
      || s.assets.length < 1 || s.assets.length > LIMITS.assets || !s.assets.every(id) || !unique(s.assets)
      || !Array.isArray(s.allowedKinds) || !s.allowedKinds.length || !unique(s.allowedKinds)
      || !s.allowedKinds.every(k => KINDS.includes(k) && k !== 'sensor.heartbeat')) throw new Error('configuration');
  }
  if (!unique(sources.map(s => s.id)) || !unique(sources.map(s => s.token))
    || sources.some(s => s.token === env.WATCH_READ_TOKEN || s.token === env.READ_TOKEN)
    || (env.WATCH_READ_TOKEN && env.WATCH_READ_TOKEN === env.READ_TOKEN)) throw new Error('configuration');
  return sources;
}
export async function authorized(request, token) {
  if (!secret(token)) return false;
  const supplied = request.headers.get('authorization') || '';
  if (supplied.length > 300) return false;
  const digest = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const [a, b] = await Promise.all([digest(supplied), digest('Bearer ' + token)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < aa.length; i++) different |= aa[i] ^ bb[i];
  return different === 0;
}
export function validBatch(body, source, now = Date.now()) {
  if (!exact(body, ['schema', 'events']) || body.schema !== 'pulseboard.security-events/1'
    || !Array.isArray(body.events) || !body.events.length || body.events.length > LIMITS.batch) return false;
  const ids = new Set();
  if (body.events.filter(e => e?.kind === 'sensor.heartbeat').length > 1) return false;
  return body.events.every(e => {
    if (!plain(e) || typeof e.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(e.id)
      || ids.has(e.id) || !integer(e.at, now - DAY, now + 30000)) return false;
    ids.add(e.id);
    const base = ['id', 'at', 'kind'];
    if (e.kind === 'sensor.heartbeat') return exact(e, [...base, 'sampling', 'dropped'])
      && ['full', 'sampled', 'unknown'].includes(e.sampling) && integer(e.dropped, 0, 1000000000);
    if (!source.allowedKinds.includes(e.kind) || !source.assets.includes(e.asset)) return false;
    base.push('asset');
    if (e.kind === 'http.request') return exact(e, [...base, 'status', 'method'], ['durationMs'])
      && integer(e.status, 100, 599) && ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'].includes(e.method)
      && (e.durationMs === undefined || integer(e.durationMs, 0, 120000));
    if (e.kind === 'scan.finding') return exact(e, [...base, 'fingerprint', 'level'])
      && typeof e.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(e.fingerprint)
      && ['note', 'warning', 'error'].includes(e.level);
    if (['exposure.unexpected', 'check.ok', 'check.error'].includes(e.kind))
      return exact(e, base, ['status']) && (e.status === undefined || integer(e.status, 100, 599));
    return exact(e, base);
  });
}
export async function boundedBody(request, timeoutMs = LIMITS.bodyMs) {
  const size = request.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > LIMITS.bytes)) throw new Error('body');
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new Error('body');
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader(); let bytes = 0, timer;
  const chunks = [];
  const reading = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMITS.bytes) throw new Error('body');
      chunks.push(value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const c of chunks) { joined.set(c, offset); offset += c.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
  })();
  try {
    return await Promise.race([reading, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('body')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
