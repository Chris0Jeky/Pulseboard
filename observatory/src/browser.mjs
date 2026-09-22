import { validateEvent } from './contracts.mjs';
/** No DOM capture, URLs, storage, identity, network or timers before explicit consent. */
export function createObserver(config, runtime = globalThis, onSelfRevoke = () => {}) {
  const { project, endpoint = '', origin, release = 'unattributed', route = 'home' } = config;
  let consent = false, disposed = false, epoch = 0, session = '', seq = 0, deadline = Infinity;
  let queue = [], timer = null, flight = null, lastEvent = 0, failures = 0, requests = 0, keepaliveBytes = 0;
  // unknown: events whose request timed out after it was issued; the collector may have admitted them.
  const stats = { sent: 0, dropped: 0, failures: 0, unknown: 0 };
  // Browsers refuse keepalive bodies beyond 64 KiB in flight per page.
  const KEEPALIVE_BUDGET = 65536;
  const privacy = () => runtime.navigator?.doNotTrack === '1' || runtime.navigator?.globalPrivacyControl === true;
  function eligible() {
    try {
      const url = new URL(endpoint);
      return !disposed && Date.now() < deadline && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && runtime.location?.origin === origin && runtime.location.protocol === 'https:'
        && !runtime.navigator?.webdriver && !privacy() && typeof runtime.crypto?.randomUUID === 'function';
    } catch { return false; }
  }
  function clear() {
    epoch++; queue = []; session = ''; seq = 0;
    if (timer !== null) runtime.clearTimeout(timer);
    timer = null; flight?.abort.abort();
  }
  function status() { return { active: consent && eligible(), queued: queue.length, requests, ...stats }; }
  function revoke() {
    if (!consent) return false;
    consent = false;
    clear();
    try { onSelfRevoke(status()); } catch { /* UI reconciliation must never weaken privacy revocation. */ }
    return true;
  }
  function schedule() {
    if (timer === null && consent && queue.length && !disposed) {
      timer = runtime.setTimeout(() => { timer = null; void flush(); }, 5000);
    }
  }
  /** until: optional consent deadline in epoch ms, re-checked before every send; an invalid one fails closed. */
  function setConsent(value, until = Infinity) {
    // Only a number (or the omitted default) is a deadline; a coercible string or NaN refuses consent.
    clear(); deadline = typeof until === 'number' && !Number.isNaN(until) ? until : -Infinity;
    consent = value === true && eligible(); failures = 0;
    // Request budget does not reset on consent toggles.
    if (consent) session = runtime.crypto.randomUUID();
    return consent;
  }
  function track(event, options = {}) {
    if (!consent || !eligible()) { if (consent) revoke(); return false; }
    const now = Date.now();
    if (lastEvent && now - lastEvent > 1800000) { session = runtime.crypto.randomUUID(); seq = 0; }
    lastEvent = now;
    const e = { v: 1, id: runtime.crypto.randomUUID(), session, seq: ++seq,
      event, route: options.route ?? route, release: options.release ?? release };
    if (options.value !== undefined) e.value = options.value;
    if (!validateEvent(e, project) || Object.keys(options).some(k => !['route', 'release', 'value'].includes(k))) { stats.dropped++; return false; }
    if (queue.length >= 100 || failures >= 3 || requests >= 120) { stats.dropped++; return false; }
    queue.push(e); schedule(); return true;
  }
  const post = (body, extra) => runtime.fetch(endpoint, { method: 'POST', credentials: 'omit',
    referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body, ...extra });
  const encode = batch => JSON.stringify({ events: batch });
  // One outcome per batch however many attempts carry it: sent on the first success; otherwise unknown if an
  // attempt timed out after it was issued, or dropped, once every attempt has settled. A dropped batch is one
  // genuine failure for the circuit; a batch from an earlier generation (disposal, re-consent) counts for nothing.
  function settleBatch(record, outcome) {
    if (record.done) return;
    const counted = record.generation === epoch;
    if (outcome === 'ok') { record.done = true; if (counted) { stats.sent += record.batch.length; failures = 0; } return; }
    if (outcome === 'unknown') record.unknown = true;
    if (--record.attempts > 0) return;
    record.done = true;
    if (!counted) return;
    if (record.unknown) stats.unknown += record.batch.length;
    else { stats.dropped += record.batch.length; failures++; }
  }
  async function flush() {
    if (!eligible()) { revoke(); return; }
    if (flight || !consent || !queue.length || failures >= 3 || requests >= 120) return;
    const generation = epoch, batch = queue.splice(0, 20);
    const current = { abort: new runtime.AbortController(), batch, generation, attempts: 1, done: false, unknown: false, handed: false, timedOut: false };
    // A cold collector path can take over 5 s to admit the first batch of a page.
    const timeout = runtime.setTimeout(() => { current.timedOut = true; current.abort.abort(); }, requests === 0 ? 10000 : 5000);
    flight = current; requests++;
    try {
      const response = await post(encode(batch), { signal: current.abort.signal });
      if (!response.ok) throw new Error('collector');
      settleBatch(current, 'ok');
    } catch {
      // The request was issued; the collector may have admitted it. Unknown is not a failure and never trips the circuit.
      if (current.timedOut) settleBatch(current, 'unknown');
      else {
        // A batch reissued on pagehide is aborted by dispose(); its keepalive attempt decides the outcome.
        if (!current.handed) stats.failures++;
        // Deliberately at-most-once: failed batches are dropped, never revived on re-consent.
        settleBatch(current, 'failed');
      }
    } finally {
      runtime.clearTimeout(timeout); if (flight === current) flight = null; schedule();
    }
  }
  /** Hands one batch to keepalive within the in-flight byte budget; false leaves it with the caller. */
  function handOver(record) {
    const body = encode(record.batch), bytes = new TextEncoder().encode(body).byteLength;
    if (keepaliveBytes + bytes > KEEPALIVE_BUDGET) return false;
    requests++; keepaliveBytes += bytes; record.attempts++;
    const settle = () => { keepaliveBytes -= bytes; };
    try {
      post(body, { keepalive: true })?.then?.(
        response => { settle(); settleBatch(record, response?.ok ? 'ok' : 'failed'); },
        () => { settle(); stats.failures++; settleBatch(record, 'failed'); });
    } catch { settle(); stats.failures++; settleBatch(record, 'failed'); }
    return true;
  }
  /** The page is being hidden and the timer will never fire: hand the rest of the queue over with keepalive.
   *  Deliberately not navigator.sendBeacon, which attaches cookies and cannot omit credentials. */
  function flushOnHide() {
    if (!consent || !eligible()) { if (consent) revoke(); return 0; }
    const generation = epoch; let handed = 0;
    // The batch in flight has left the queue and dispose() aborts it: reissue the same events, same IDs, with keepalive.
    // The collector ignores duplicate IDs, so each event is admitted at most once and sent at most twice.
    if (flight && !flight.handed && flight.generation === epoch && requests < 120 && handOver(flight)) {
      flight.handed = true; handed += flight.batch.length;
    }
    while (queue.length && failures < 3 && requests < 120) {
      const record = { batch: queue.slice(0, 20), generation, attempts: 0, done: false, unknown: false };
      if (!handOver(record)) break;
      queue.splice(0, record.batch.length); handed += record.batch.length;
    }
    return handed;
  }
  function dispose() { consent = false; disposed = true; clear(); }
  return { setConsent, track, flush, flushOnHide, dispose, status };
}
