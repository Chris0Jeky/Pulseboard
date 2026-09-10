/** Pulseboard Observatory 0.1.0. Content-free, closed event contract. */
export const VERSION = 1;
export const MAX_BYTES = 16384;
export const MAX_BATCH = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['v', 'id', 'session', 'seq', 'event', 'route', 'release', 'value'];
export function validateEvent(e, project) {
  if (!e || Object.getPrototypeOf(e) !== Object.prototype || Object.keys(e).some(k => !FIELDS.includes(k))) return false;
  return e.v === VERSION && typeof e.id === 'string' && typeof e.session === 'string' && UUID.test(e.id) && UUID.test(e.session)
    && Number.isSafeInteger(e.seq) && e.seq >= 1 && e.seq <= 1000000
    && project.events.includes(e.event) && project.routes.includes(e.route)
    && project.releases.includes(e.release)
    && (e.value === undefined || (project.measurements.includes(e.event)
      && typeof e.value === 'number' && Number.isFinite(e.value) && e.value >= 0 && e.value <= 3600000));
}
export function validateBatch(body, project) {
  return !!body && Object.getPrototypeOf(body) === Object.prototype
    && Object.keys(body).length === 1 && Array.isArray(body.events)
    && body.events.length > 0 && body.events.length <= MAX_BATCH
    && body.events.every(e => validateEvent(e, project));
}
export async function readBounded(request, timeoutMs = 5000) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new Error('size');
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader();
  const chunks = []; let size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (expired) throw new Error('timeout');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
/** Wilson interval is a descriptive interval, not an experiment/significance test. */
export function interval(successes, total) {
  if (!total) return null;
  const z = 1.96, p = successes / total, d = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
}
/** A reading older than this, or dated in the future, is not evidence of current state. Defined after the
 *  browser build's cut point on purpose: it is a presentation constant the embedded artifact never needs. */
export const STALE_AFTER = 30 * 60000;
export const monitorState = (probe, now) => (!probe ? 'unknown'
  : probe.checked > now || now - probe.checked > STALE_AFTER ? 'stale' : probe.state);
export function monitorTransition(previous, ok, now) {
  const p = previous || { state: 'unknown', failures: 0, successes: 0, opened: null };
  const failures = ok ? 0 : p.failures + 1, successes = ok ? p.successes + 1 : 0;
  let state = p.state, opened = p.opened;
  if (failures >= 3) { state = 'down'; opened ||= now; }
  else if (successes >= 2) { state = 'up'; opened = null; }
  return { state, failures, successes, opened, checked: now };
}
