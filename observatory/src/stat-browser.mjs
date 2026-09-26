/** Bounded Pulseboard client transport slice (issue #89 producer half).
 *
 * Aggregate-only transport for POST /v1/collect-stat/alibi with body exactly
 * { v: 1, counts: [{ event, route, release, n: 1 }, ...] } (1..20 items).
 * No identifiers, content, page URLs, referrers, cookies, DOM, storage or host
 * context are included in event payloads. Vocabulary, endpoint, origin and defaults
 * come only from `config`; all host capabilities come only from `runtime`.
 */
const STAT_V = 1;
const MAX_QUEUE = 100;
const MAX_REQUESTS = 120;
const CLIENT_BATCH_LIMIT = 20;
const KEEPALIVE_BUDGET = 65536;

export function createStatisticObserver(config, runtime = globalThis) {
  const cfg = config && typeof config === 'object' ? config : {};
  const vocab = cfg.project && typeof cfg.project === 'object' && !Array.isArray(cfg.project)
    ? cfg.project
    : cfg;
  const events = Array.isArray(vocab.events) ? vocab.events : [];
  const routes = Array.isArray(vocab.routes) ? vocab.routes : [];
  const releases = Array.isArray(vocab.releases) ? vocab.releases : [];
  const endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint : '';
  const origin = typeof cfg.origin === 'string' ? cfg.origin : '';
  const defaultRoute = typeof (cfg.route ?? cfg.defaultRoute) === 'string'
    ? (cfg.route ?? cfg.defaultRoute)
    : 'home';
  const defaultRelease = typeof (cfg.release ?? cfg.defaultRelease) === 'string'
    ? (cfg.release ?? cfg.defaultRelease)
    : 'unattributed';

  let enabled = false;
  let disposed = false;
  let epoch = 0;
  let queue = [];
  let flight = null;
  const handoffs = new Set();
  let requests = 0;
  let keepaliveBytes = 0;
  const stats = { sent: 0, dropped: 0, failures: 0 };

  function eligible() {
    try {
      if (disposed) return false;
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') return false;
      if (url.pathname !== '/v1/collect-stat/alibi') return false;
      if (url.username || url.password) return false;
      if (url.search) return false;
      if (url.hash) return false;
      let originProtocol = '';
      try {
        originProtocol = new URL(origin).protocol;
      } catch {
        return false;
      }
      if (originProtocol !== 'https:') return false;
      const loc = runtime?.location;
      if (!loc || loc.origin !== origin) return false;
      if (loc.protocol !== 'https:') return false;
      const nav = runtime?.navigator;
      if (nav?.webdriver) return false;
      if (nav?.doNotTrack === '1') return false;
      if (nav?.globalPrivacyControl === true) return false;
      if (typeof runtime?.fetch !== 'function') return false;
      if (typeof (runtime?.AbortController ?? globalThis.AbortController) !== 'function') return false;
      return true;
    } catch {
      return false;
    }
  }

  function clearTimer(id) {
    if (id === null || id === undefined) return;
    try {
      const clear = runtime?.clearTimeout;
      if (typeof clear === 'function') clear.call(runtime, id);
      else globalThis.clearTimeout(id);
    } catch {
      /* Clearing must never break revocation. */
    }
  }

  function revoke() {
    epoch += 1;
    queue = [];
    if (flight) {
      flight.cancelled = true;
      clearTimer(flight.timeoutId);
      try {
        flight.abort.abort();
      } catch {
        /* Abort failure still revokes. */
      }
      flight = null;
    }
    for (const record of handoffs) {
      record.cancelled = true;
      try { record.abort?.abort(); } catch { /* Withdrawal still clears local work. */ }
    }
    handoffs.clear();
  }

  function setEnabled(value) {
    try {
      if (disposed) {
        enabled = false;
        return false;
      }
      if (value !== true) {
        enabled = false;
        revoke();
        return false;
      }
      if (!eligible()) {
        enabled = false;
        revoke();
        return false;
      }
      enabled = true;
      return true;
    } catch {
      enabled = false;
      return false;
    }
  }

  function track(event, options = {}) {
    try {
      if (!enabled || disposed) return false;
      if (!eligible()) {
        enabled = false;
        revoke();
        return false;
      }
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        stats.dropped += 1;
        return false;
      }
      const keys = Object.keys(options);
      if (keys.some((k) => k !== 'route' && k !== 'release')) {
        stats.dropped += 1;
        return false;
      }
      if (typeof event !== 'string') {
        stats.dropped += 1;
        return false;
      }
      const route = Object.hasOwn(options, 'route') ? options.route : defaultRoute;
      const release = Object.hasOwn(options, 'release') ? options.release : defaultRelease;
      if (typeof route !== 'string' || typeof release !== 'string') {
        stats.dropped += 1;
        return false;
      }
      if (!events.includes(event) || !routes.includes(route) || !releases.includes(release)) {
        stats.dropped += 1;
        return false;
      }
      if (queue.length >= MAX_QUEUE || requests >= MAX_REQUESTS) {
        stats.dropped += 1;
        return false;
      }
      queue.push({ event, route, release, n: 1 });
      return true;
    } catch {
      try {
        stats.dropped += 1;
      } catch {
        /* Never throw to the host. */
      }
      return false;
    }
  }

  function byteLength(text) {
    try {
      const TE = runtime?.TextEncoder ?? globalThis.TextEncoder;
      if (typeof TE === 'function') return new TE().encode(text).byteLength;
    } catch {
      /* Fall through to Buffer/length. */
    }
    try {
      if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    } catch {
      /* Fall through. */
    }
    return text.length;
  }

  function makeController() {
    try {
      const AC = runtime?.AbortController ?? globalThis.AbortController;
      if (typeof AC === 'function') return new AC();
    } catch {
      /* Send without a signal below. */
    }
    return null;
  }

  async function flush() {
    try {
      if (!enabled || disposed) return 0;
      if (!eligible()) {
        enabled = false;
        revoke();
        return 0;
      }
      if (flight || queue.length === 0 || requests >= MAX_REQUESTS) return 0;
      const batch = queue.splice(0, CLIENT_BATCH_LIMIT);
      const body = JSON.stringify({ v: STAT_V, counts: batch });
      const controller = makeController();
      const record = {
        abort: controller,
        batch,
        generation: epoch,
        cancelled: false,
        timedOut: false,
        timeoutId: null,
      };
      flight = record;
      requests += 1;
      const timeoutMs = requests <= 1 ? 10000 : 5000;
      try {
        const setter = runtime?.setTimeout;
        if (typeof setter === 'function' && controller) {
          record.timeoutId = setter.call(runtime, () => {
            record.timedOut = true;
            try {
              controller.abort();
            } catch {
              /* Timeout abort failure settles below. */
            }
          }, timeoutMs);
        } else if (controller) {
          record.timeoutId = globalThis.setTimeout(() => {
            record.timedOut = true;
            try {
              controller.abort();
            } catch {
              /* Timeout abort failure settles below. */
            }
          }, timeoutMs);
        }
      } catch {
        record.timeoutId = null;
      }
      try {
        const init = {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body,
        };
        if (controller) init.signal = controller.signal;
        const response = await runtime.fetch(endpoint, init);
        if (record.cancelled || record.generation !== epoch) return 0;
        if (response && response.ok) {
          stats.sent += batch.length;
          return batch.length;
        }
        stats.dropped += batch.length;
        stats.failures += 1;
        return 0;
      } catch {
        if (record.cancelled || record.generation !== epoch) return 0;
        stats.dropped += batch.length;
        stats.failures += 1;
        return 0;
      } finally {
        clearTimer(record.timeoutId);
        if (flight === record) flight = null;
      }
    } catch {
      return 0;
    }
  }

  function flushOnHide() {
    try {
      if (!enabled || disposed) return 0;
      if (!eligible()) {
        enabled = false;
        revoke();
        return 0;
      }
      // Never replay the in-flight batch: it already left the queue and the
      // aggregate contract has no identifiers to deduplicate a duplicate.
      let handed = 0;
      while (queue.length && requests < MAX_REQUESTS) {
        const batch = queue.slice(0, CLIENT_BATCH_LIMIT);
        const body = JSON.stringify({ v: STAT_V, counts: batch });
        const bytes = byteLength(body);
        if (keepaliveBytes + bytes > KEEPALIVE_BUDGET) break;
        queue.splice(0, batch.length);
        requests += 1;
        keepaliveBytes += bytes;
        handed += batch.length;
        const controller = makeController();
        const record = { abort: controller, cancelled: false, generation: epoch };
        handoffs.add(record);
        const settle = (ok) => {
          keepaliveBytes -= bytes;
          handoffs.delete(record);
          if (record.cancelled || record.generation !== epoch) return;
          if (ok) stats.sent += batch.length;
          else { stats.dropped += batch.length; stats.failures += 1; }
        };
        try {
          const init = {
            method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
            redirect: 'error', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
          };
          if (controller) init.signal = controller.signal;
          const outcome = runtime.fetch(endpoint, init);
          if (outcome && typeof outcome.then === 'function')
            outcome.then(response => settle(!!response?.ok), () => settle(false));
          else settle(false);
        } catch { settle(false); }
      }
      return handed;
    } catch {
      return 0;
    }
  }

  function status() {
    try {
      if (enabled && !eligible()) { enabled = false; revoke(); }
      return {
        enabled: enabled && !disposed,
        active: enabled && !disposed,
        queued: queue.length,
        requests,
        sent: stats.sent,
        dropped: stats.dropped,
        failures: stats.failures,
      };
    } catch {
      return { enabled: false, active: false, queued: 0, requests: 0, sent: 0, dropped: 0, failures: 0 };
    }
  }

  /** Pagehide may preserve already handed-off keepalive requests; explicit off never does. */
  function dispose({ preserveHandoffs = false } = {}) {
    try {
      if (disposed) return;
      enabled = false;
      disposed = true;
      if (preserveHandoffs) {
        epoch += 1;
        queue = [];
        if (flight) {
          flight.cancelled = true;
          clearTimer(flight.timeoutId);
          try { flight.abort?.abort(); } catch { /* Page exit still clears local work. */ }
          flight = null;
        }
        return;
      }
      revoke();
    } catch {
      /* Dispose never throws. */
    }
  }

  return { setEnabled, track, flush, flushOnHide, status, dispose };
}
