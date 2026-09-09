import { validateEvent } from './contracts.mjs';
/** No DOM capture, URLs, storage, identity, network or timers before explicit consent. */
export function createObserver(config, runtime = globalThis) {
  const { project, endpoint = '', origin, release = 'unattributed', route = 'home' } = config;
  let consent = false, disposed = false, epoch = 0, session = '', seq = 0;
  let queue = [], timer = null, flight = null, lastEvent = 0, failures = 0, requests = 0;
  const stats = { sent: 0, dropped: 0, failures: 0 };
  const privacy = () => runtime.navigator?.doNotTrack === '1' || runtime.navigator?.globalPrivacyControl === true;
  function eligible() {
    try {
      const url = new URL(endpoint);
      return !disposed && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && runtime.location?.origin === origin && runtime.location.protocol === 'https:'
        && !runtime.navigator?.webdriver && !privacy() && typeof runtime.crypto?.randomUUID === 'function';
    } catch { return false; }
  }
  function clear() {
    epoch++; queue = []; session = ''; seq = 0;
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null; flight?.abort();
  }
  function schedule() {
    if (timer === null && consent && queue.length && !disposed) {
      timer = runtime.setTimeout(() => { timer = null; void flush(); }, 5000);
    }
  }
  function setConsent(value) {
    clear(); consent = value === true && eligible(); failures = 0;
    // Request budget does not reset on consent toggles.
    if (consent) session = runtime.crypto.randomUUID();
    return consent;
  }
  function track(event, options = {}) {
    if (!consent || !eligible()) { if (consent) { consent = false; clear(); } return false; }
    const now = Date.now();
    if (lastEvent && now - lastEvent > 1800000) { session = runtime.crypto.randomUUID(); seq = 0; }
    lastEvent = now;
    const e = { v: 1, id: runtime.crypto.randomUUID(), session, seq: ++seq,
      event, route: options.route ?? route, release };
    if (options.value !== undefined) e.value = options.value;
    if (!validateEvent(e, project) || Object.keys(options).some(k => !['route', 'value'].includes(k))) { stats.dropped++; return false; }
    if (queue.length >= 100 || failures >= 3 || requests >= 120) { stats.dropped++; return false; }
    queue.push(e); schedule(); return true;
  }
  async function flush() {
    if (!eligible()) { consent = false; clear(); return; }
    if (flight || !consent || !queue.length || failures >= 3 || requests >= 120) return;
    const generation = epoch, batch = queue.splice(0, 20);
    const abort = new runtime.AbortController(); flight = abort; requests++;
    const timeout = runtime.setTimeout(() => abort.abort(), 5000);
    try {
      const response = await runtime.fetch(endpoint, { method: 'POST', credentials: 'omit',
        referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }), signal: abort.signal });
      if (!response.ok) throw new Error('collector');
      if (generation === epoch) { stats.sent += batch.length; failures = 0; }
    } catch {
      stats.failures++;
      // Deliberately at-most-once: failed batches are dropped, never revived on re-consent.
      if (generation === epoch) { failures++; stats.dropped += batch.length; }
    } finally {
      runtime.clearTimeout(timeout); if (flight === abort) flight = null; schedule();
    }
  }
  function dispose() { consent = false; disposed = true; clear(); }
  return { setConsent, track, flush, dispose, status: () => ({ active: consent && eligible(), queued: queue.length, requests, ...stats }) };
}
