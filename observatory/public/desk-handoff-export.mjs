// SPDX-License-Identifier: GPL-3.0-only
const ID = /^[a-z][a-z0-9-]{0,63}$/, RULE = /^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,127}$/;
const fail = field => { throw new TypeError(`Invalid handoff ${field}`); };
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');

/** Issue #169 identity shared by both producers and the strict v1/v2 file receiver. */
export async function handoffIdentity(packet) {
  const project = packet?.project, rule = packet?.rule;
  if (project !== null && (typeof project !== 'string' || !ID.test(project))) fail('project');
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).length !== 2
    || !Object.hasOwn(rule, 'id') || !Object.hasOwn(rule, 'version')) fail('rule');
  if (typeof rule.id !== 'string' || !RULE.test(rule.id) || typeof rule.version !== 'string' || rule.version.length > 64 || !RULE.test(rule.version)) fail('rule');
  if (typeof packet.title !== 'string' || !packet.title.trim() || packet.title.length > 240) fail('title');
  const title = packet.title.toLowerCase().trim().replace(/\s+/gu, ' ');
  const signalSha256 = await hash(JSON.stringify([project, rule.id, rule.version, title]));
  return { fingerprint: signalSha256.slice(0, 12), signalSha256 };
}

/** Explicit legacy export for consumers that have not migrated to v2. */
export function makeLegacyHandoff(snapshot, signal, stale = false) {
  return { schema: 'pulseboard.handoff/1', mode: snapshot.mode, generatedAt: snapshot.generatedAt, stale: stale === true,
    destination: 'review-before-import', title: signal.title, project: signal.project,
    observation: signal.detail, evidence: signal.evidence, nextCheck: signal.next,
    rule: { id: signal.rule, version: signal.version }, window: snapshot.window,
    boundaries: ['No automatic task creation or execution.', 'Contains aggregates, not event rows.', 'Review before sharing.'] };
}

/** Build from the Desk's validated snapshot. The receiver separately validates untrusted files. */
export async function makeIdentifiedHandoff(snapshot, signal, stale = false) {
  const packet = structuredClone(makeLegacyHandoff(snapshot, signal, stale));
  const { fingerprint } = await handoffIdentity(packet);
  return { ...packet, schema: 'pulseboard.handoff/2', fingerprint };
}
