/** Release-label admission, shared by every ingest path (owner decision q-28, 2026-09-27).
 * A label is admitted when it is listed in `project.releases`, or when the project opts into
 * `releasePattern` and the label is a well-formed version: MAJOR.MINOR.PATCH with an optional short
 * prerelease suffix. Only Alibi opts in, so a new Alibi version is counted before it is registered;
 * every other project keeps its closed list. The SDK inlines the same expression (sdk/pulseboard-sdk.mjs,
 * RELEASE_PATTERN_RE); a test pins the two sources equal. */
export const RELEASE_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,15})?$/;
export const RELEASE_MAX = 32;

/** Listed labels are operator vocabulary and keep their exact-match rule; only the open pattern branch is length-capped. */
export function releaseAccepted(project, label) {
  if (typeof label !== 'string' || label.length === 0) return false;
  if (!project || typeof project !== 'object') return false;
  if (Array.isArray(project.releases) && project.releases.includes(label)) return true;
  return project.releasePattern === true && label.length <= RELEASE_MAX && RELEASE_PATTERN.test(label);
}
