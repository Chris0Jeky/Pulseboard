/** Alibi-only aggregate admission contract (producer half of issue #89).
 * Accepted body is exactly { v: 1, counts: [{ event, route, release, n: 1 }, ...] }
 * with 1..20 items. No event IDs, session IDs, puzzle IDs, text, URLs or IPs
 * are accepted or persisted; any unexpected key fails the whole batch closed.
 * Vocabulary is the registered Alibi closed vocabulary (project.events,
 * project.routes, project.releases). Each admitted count reserves one unit of
 * the same daily budget and increments one aggregate row. */
export const STAT_VERSION = 1;
export const STAT_MAX_BATCH = 20;
const STAT_COUNT_FIELDS = ['event', 'route', 'release', 'n'];

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
  if (keys.length !== 2 || !keys.includes('v') || !keys.includes('counts')) return false;
  if (body.v !== STAT_VERSION) return false;
  if (!Array.isArray(body.counts)) return false;
  if (body.counts.length < 1 || body.counts.length > STAT_MAX_BATCH) return false;
  return body.counts.every(count => validateStatCount(count, project));
}

/** The producer switch admits exactly one value. Anything else means disabled. */
export function statAdmission(env = {}) {
  return env.COLLECT_STAT_PROJECTS === 'alibi';
}
