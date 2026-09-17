import { projects as registry } from './projects.mjs';

/** Parse one exact, registry-backed collection policy. Any invalid entry fails the whole allowlist closed. */
export function collectionAdmission(env = {}, projects = registry) {
  const enabled = env.COLLECT_ENABLED === 'true';
  const configured = [...new Set(String(env.COLLECT_PROJECTS ?? '').split(',').map(value => value.trim()).filter(Boolean))];
  const invalid = configured.filter(id => !Object.hasOwn(projects, id) || !projects[id]?.origin);
  const valid = invalid.length === 0;
  const admitted = enabled && valid ? configured : [];
  return Object.freeze({ enabled, valid,
    configured: Object.freeze(configured), admitted: Object.freeze(admitted), invalid: Object.freeze(invalid) });
}
