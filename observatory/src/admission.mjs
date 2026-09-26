import { projects as registry } from './projects.mjs';
import { VOICE_REGISTRY } from './surveys.mjs';

const MAX_POLICY_BYTES = 4096;
const MAX_PROJECTS = 64;
const MAX_PROJECT_ID_LENGTH = 64;
const BOUNDS_ERROR = 'configuration_exceeds_bounds';
const frozen = values => Object.freeze(values);

function boundedFailure(enabled) {
  return Object.freeze({
    enabled,
    valid: false,
    configured: frozen([]),
    admitted: frozen([]),
    invalid: frozen([BOUNDS_ERROR]),
  });
}

/** Parse one exact, registry-backed collection policy. Any invalid entry fails the whole allowlist closed. */
export function collectionAdmission(env = {}, projects = registry) {
  const enabled = env.COLLECT_ENABLED === 'true';
  const raw = String(env.COLLECT_PROJECTS ?? '');
  if (raw.length > MAX_POLICY_BYTES || new TextEncoder().encode(raw).byteLength > MAX_POLICY_BYTES) {
    return boundedFailure(enabled);
  }

  const tokens = raw.split(',');
  if (tokens.length > MAX_PROJECTS || tokens.some(value => value.trim().length > MAX_PROJECT_ID_LENGTH)) {
    return boundedFailure(enabled);
  }

  const configured = [...new Set(tokens.map(value => value.trim()).filter(Boolean))];
  const invalid = configured.filter(id => !Object.hasOwn(projects, id) || !projects[id]?.origin);
  const valid = invalid.length === 0;
  const admitted = enabled && valid ? configured : [];
  return Object.freeze({ enabled, valid,
    configured: frozen(configured), admitted: frozen(admitted), invalid: frozen(invalid) });
}

/** A per-channel producer switch is an exact comma list of registered public ids: no spaces, case changes, empty
 *  entries or duplicates. Any malformed entry disables the whole switch, so a typo never widens admission.
 *  Shared by COLLECT_STAT_PROJECTS (aggregate counts), COLLECT_PRODUCT_PROJECTS (product events) and COLLECT_VOICE_PROJECTS. */
export function exactProjectList(raw, projects = registry) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_POLICY_BYTES) return [];
  const ids = raw.split(',');
  if (ids.length > MAX_PROJECTS || new Set(ids).size !== ids.length) return [];
  if (!ids.every(id => /^[a-z0-9-]{1,64}$/.test(id) && Object.hasOwn(projects, id) && projects[id]?.origin)) return [];
  return ids;
}
/** Product events (USAGE_PLAN.md section 2). Independent of COLLECT_PROJECTS and COLLECT_STAT_PROJECTS;
 *  COLLECT_ENABLED and a valid session policy still gate it. */
export const productAdmission = (env = {}, projects = registry) => exactProjectList(env.COLLECT_PRODUCT_PROJECTS, projects);
/** Voices: player feedback, surveys and ratings (docs/VOICES.md). Same exact-list rules; an id must also have a voice
 *  registry entry in src/surveys.mjs, or the whole list fails closed. COLLECT_ENABLED and a valid session policy gate it. */
export const voiceAdmission = (env = {}, projects = registry, voices = VOICE_REGISTRY) => exactProjectList(env.COLLECT_VOICE_PROJECTS,
  Object.fromEntries(Object.entries(projects).filter(([id]) => Object.hasOwn(voices, id))));
