/** Release-label admission, shared by every ingest path (owner decision q-28, 2026-09-27).
 * A label is admitted when it is listed in `project.releases`, or when the project opts into
 * `releasePattern` and the label is a well-formed version: MAJOR.MINOR.PATCH with an optional short
 * prerelease suffix. Only Alibi opts in, so a new Alibi version is counted before it is registered;
 * every other project keeps its closed list. The SDK inlines the same expression (sdk/pulseboard-sdk.mjs,
 * RELEASE_PATTERN_RE); a test pins the two sources equal. */
export const RELEASE_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9a-z][0-9a-z.-]{0,15})?$/;
export const RELEASE_MAX = 32;

/** Readers return at most this many release rows, the Desk's list limit. An open pattern lets a sender mint any number of
 *  distinct labels, so beyond it the lightest rows fold into one RELEASE_OTHER row (never a pattern-admissible label). */
export const RELEASE_ROW_LIMIT = 64;
export const RELEASE_OTHER = 'other';

/** Keeps the RELEASE_ROW_LIMIT - 1 heaviest rows (by `weight`, ties by label) in their original order and appends
 *  `merge(rest)` as one row labelled RELEASE_OTHER, so sums still reconcile. A row already labelled RELEASE_OTHER is
 *  always folded. Rows are returned unchanged when they already fit. */
export function foldReleaseRows(rows, weight, merge) {
  if (rows.length <= RELEASE_ROW_LIMIT && !rows.some(row => row.release === RELEASE_OTHER)) return rows;
  const ranked = rows.filter(row => row.release !== RELEASE_OTHER)
    .sort((a, b) => weight(b) - weight(a) || (a.release < b.release ? -1 : a.release > b.release ? 1 : 0));
  const kept = new Set(ranked.slice(0, RELEASE_ROW_LIMIT - 1));
  const rest = rows.filter(row => !kept.has(row));
  return [...rows.filter(row => kept.has(row)), { release: RELEASE_OTHER, ...merge(rest) }];
}

/** Listed labels are operator vocabulary and keep their exact-match rule; only the open pattern branch is length-capped. */
export function releaseAccepted(project, label) {
  if (typeof label !== 'string' || label.length === 0) return false;
  if (!project || typeof project !== 'object') return false;
  if (Array.isArray(project.releases) && project.releases.includes(label)) return true;
  return project.releasePattern === true && label.length <= RELEASE_MAX && RELEASE_PATTERN.test(label);
}
