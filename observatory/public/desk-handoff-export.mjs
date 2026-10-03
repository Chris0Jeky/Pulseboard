// SPDX-License-Identifier: GPL-3.0-only
import { makeHandoff } from './desk-model.mjs';

const ID = /^[a-z][a-z0-9-]{0,63}$/, RULE = /^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,127}$/;
const fail = field => { throw new TypeError(`Invalid handoff ${field}`); };
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');

/** Desk-native subject identity shared by the browser producer and the strict file receiver. */
export async function handoffIdentity(packet) {
  const project = packet?.project, rule = packet?.rule;
  if (project !== null && (typeof project !== 'string' || !ID.test(project))) fail('project');
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).length !== 2
    || !Object.hasOwn(rule, 'id') || !Object.hasOwn(rule, 'version')) fail('rule');
  if (typeof rule.id !== 'string' || !RULE.test(rule.id) || typeof rule.version !== 'string' || rule.version.length > 64 || !RULE.test(rule.version)) fail('rule');
  const signalSha256 = await hash(JSON.stringify([project, rule.id, rule.version]));
  return { fingerprint: signalSha256.slice(0, 12), signalSha256 };
}

/** Build from the Desk's validated snapshot. The receiver separately validates untrusted files. */
export async function makeIdentifiedHandoff(snapshot, signal, stale = false) {
  const packet = structuredClone(makeHandoff(snapshot, signal, stale));
  const { fingerprint } = await handoffIdentity(packet);
  return { ...packet, schema: 'pulseboard.handoff/2', fingerprint };
}
