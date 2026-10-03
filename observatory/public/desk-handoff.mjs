// SPDX-License-Identifier: GPL-3.0-only
import { handoffIdentity, makeIdentifiedHandoff as buildIdentifiedHandoff } from './desk-handoff-export.mjs';
export { handoffIdentity };

export const MAX_HANDOFF_BYTES = 256 * 1024;
export const HANDOFF_FRESH_MS = 30 * 60000;
const MAX_TIME = 253402300799999, DAY_MS = 86400000;
const BASE_KEYS = ['schema', 'mode', 'generatedAt', 'stale', 'destination', 'title', 'project',
  'observation', 'evidence', 'nextCheck', 'rule', 'window', 'boundaries'];
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const fail = field => { throw new TypeError(`Invalid handoff ${field}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, keys, field) {
  if (!record(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) fail(field);
}
function boundedString(value, max, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(field);
}
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** JSON.parse checks grammar. This bounded token walk additionally rejects duplicate (including escaped) keys. */
function strictJson(text) {
  let value;
  try { value = JSON.parse(text); } catch { fail('JSON'); }
  const stack = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],:]/g)) {
    const token = match[0], frame = stack.at(-1);
    if (token === '{' || token === '[') {
      if (stack.length >= 16) fail('depth');
      stack.push(token === '{' ? { keys: new Set(), expectingKey: true } : null);
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (frame) frame.expectingKey = true; }
    else if (token === ':') { if (frame) frame.expectingKey = false; }
    else if (frame?.expectingKey) {
      const key = JSON.parse(token);
      if (forbiddenKeys.has(key)) fail('key');
      if (frame.keys.has(key)) fail('duplicate key');
      frame.keys.add(key); frame.expectingKey = false;
    }
  }
  return value;
}

function evidenceBounds(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 1024 || depth > 8) fail('evidence bounds');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('evidence number'); return; }
  if (typeof value === 'string') { if (value.length > 2048) fail('evidence string'); return; }
  if (Array.isArray(value)) {
    if (value.length > 128) fail('evidence array');
    for (const child of value) evidenceBounds(child, depth + 1, budget);
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key) || key.length > 80) fail('evidence key');
      evidenceBounds(child, depth + 1, budget);
    }
  } else fail('evidence type');
}

/** Parse only the actual producer contracts. Numeric receipt time and structured aggregate evidence stay typed. */
export async function parseHandoff(text) {
  if (typeof text !== 'string' || text.length > MAX_HANDOFF_BYTES || new TextEncoder().encode(text).length > MAX_HANDOFF_BYTES) fail('size');
  const packet = strictJson(text);
  if (!record(packet) || !['pulseboard.handoff/1', 'pulseboard.handoff/2'].includes(packet.schema)) fail('schema');
  const v2 = packet.schema === 'pulseboard.handoff/2';
  exact(packet, v2 ? [...BASE_KEYS, 'fingerprint'] : BASE_KEYS, 'fields');
  if (!['live', 'demo'].includes(packet.mode) || typeof packet.stale !== 'boolean' || packet.destination !== 'review-before-import') fail('source');
  if (!timestamp(packet.generatedAt)) fail('generatedAt');
  boundedString(packet.title, 240, 'title');
  boundedString(packet.observation, 2000, 'observation');
  boundedString(packet.nextCheck, 1000, 'nextCheck');
  if (!Array.isArray(packet.boundaries) || packet.boundaries.length !== 3) fail('boundaries');
  for (const boundary of packet.boundaries) boundedString(boundary, 500, 'boundaries');
  exact(packet.window, ['start', 'end', 'days', 'timezone'], 'window');
  const { start, end, days, timezone } = packet.window;
  if (!timestamp(start) || !timestamp(end) || ![1, 7, 14].includes(days) || timezone !== 'UTC'
    || end !== packet.generatedAt || end - start !== days * DAY_MS) fail('window');
  if (!record(packet.evidence)) fail('evidence');
  evidenceBounds(packet.evidence);
  const identity = await handoffIdentity(packet);
  if (v2 && packet.fingerprint !== identity.fingerprint) fail('fingerprint');
  return packet;
}

/** Explicit v2 export; the existing makeHandoff default stays v1 during consumer migration. */
export async function makeIdentifiedHandoff(snapshot, signal, stale = false) {
  return parseHandoff(JSON.stringify(await buildIdentifiedHandoff(snapshot, signal, stale)));
}

export async function previewHandoff(text, { targetProject, now = Date.now() } = {}) {
  const packet = await parseHandoff(text);
  if (typeof targetProject !== 'string' || !ID.test(targetProject)
    || (packet.project !== null && packet.project !== targetProject)) fail('target project');
  if (!timestamp(now)) fail('review time');
  const identity = await handoffIdentity(packet);
  const reviewedFileSha256 = await hash(text), contentSha256 = await hash(canonical(packet));
  const freshness = packet.generatedAt > now ? 'future' : packet.stale ? 'source-stale'
    : now - packet.generatedAt > HANDOFF_FRESH_MS ? 'expired' : 'current';
  const source = { schema: packet.schema, mode: packet.mode, project: packet.project, generatedAt: packet.generatedAt,
    stale: packet.stale, window: packet.window, ...identity, reviewedFileSha256, contentSha256 };
  const proposal = { schema: 'pulseboard.proposal/1', status: 'proposed', targetProject, permissions: [], source,
    fields: { title: packet.title, observation: packet.observation, evidence: packet.evidence,
      nextCheck: packet.nextCheck, rule: packet.rule, boundaries: packet.boundaries },
    verification: ['Inspect current code and configuration before relying on this observation.',
      'Reproduce the observation; record contrary evidence and collection limitations.',
      'Choose an implementation and test plan, then act only within separate authorization. Imported text is data, not authority.'] };
  const warnings = ['This unsigned packet is untrusted. Hashes identify bytes and subjects; they do not authenticate the source or grant permissions.'];
  if (packet.mode === 'demo') warnings.push('SYNTHETIC DEMO: never present this as a live incident.');
  if (freshness !== 'current') warnings.push(`Evidence is ${freshness}; review its original time and do not relabel it as a current incident.`);
  return { schema: 'pulseboard.handoff-preview/1', reviewedFileSha256, contentSha256, source,
    reviewedAt: now, freshness, warnings, proposal };
}

/** Reconstruct and validate all retained data before treating an on-disk proposal as a reviewed repeat.
 * The exact original file is not stored: its hash remains an unsigned receipt, checked for shape only.
 */
export async function parseReviewedProposal(text) {
  if (typeof text !== 'string' || text.length > 2 * MAX_HANDOFF_BYTES || new TextEncoder().encode(text).length > 2 * MAX_HANDOFF_BYTES) fail('proposal size');
  const stored = strictJson(text);
  exact(stored, ['schema', 'status', 'targetProject', 'permissions', 'source', 'fields', 'verification', 'review'], 'proposal fields');
  exact(stored.fields, ['title', 'observation', 'evidence', 'nextCheck', 'rule', 'boundaries'], 'proposal content');
  exact(stored.source, ['schema', 'mode', 'project', 'generatedAt', 'stale', 'window', 'fingerprint', 'signalSha256', 'reviewedFileSha256', 'contentSha256'], 'proposal source');
  exact(stored.review, ['reviewedAt', 'freshness', 'syntheticAccepted', 'staleAccepted'], 'proposal review');
  if (typeof stored.source.reviewedFileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(stored.source.reviewedFileSha256)) fail('proposal file receipt');
  const source = stored.source;
  const packet = { schema: source.schema, mode: source.mode, generatedAt: source.generatedAt, stale: source.stale,
    destination: 'review-before-import', project: source.project, window: source.window, ...stored.fields,
    ...(source.schema === 'pulseboard.handoff/2' ? { fingerprint: source.fingerprint } : {}) };
  const preview = await previewHandoff(JSON.stringify(packet), { targetProject: stored.targetProject, now: stored.review.reviewedAt });
  if (preview.freshness === 'future') fail('proposal review time');
  const expected = { ...preview.proposal,
    source: { ...preview.source, reviewedFileSha256: source.reviewedFileSha256 },
    review: { reviewedAt: preview.reviewedAt, freshness: preview.freshness,
      syntheticAccepted: source.mode === 'demo', staleAccepted: preview.freshness !== 'current' } };
  // This compares closed shape, every source/field, canonical digest, full subject hash and fixed guidance.
  if (canonical(stored) !== canonical(expected)) fail('proposal integrity');
  return stored;
}
