// SPDX-License-Identifier: GPL-3.0-only
/** Read-only merge-refusal diagnostics. Exit zero only permits the existing bounded replay path. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const STATES = new Set(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']);
const REVIEWS = new Set(['', 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']);
const THREAD_QUERY = `query($owner:String!,$name:String!,$number:Int!) {
  repository(owner:$owner,name:$name) { pullRequest(number:$number) {
    reviewThreads(first:50) { pageInfo { hasNextPage } nodes {
      isResolved comments(first:1) { nodes { url originalCommit { oid } } }
    } }
  } }
}`;

export function replayDecision(metadata, expectedHead, attempt) {
  if (!SHA.test(expectedHead || '') || !Number.isInteger(attempt) || attempt < 1 || attempt > 3)
    return { replay: false, reason: 'invalid invocation' };
  if (!metadata || !SHA.test(metadata.headRefOid || '') || !STATES.has(metadata.mergeStateStatus)
    || !REVIEWS.has(metadata.reviewDecision ?? '')) return { replay: false, reason: 'metadata unavailable or malformed' };
  if (metadata.headRefOid !== expectedHead) return { replay: false, reason: 'head moved after merge refusal' };
  if (metadata.mergeStateStatus !== 'BEHIND') return { replay: false, reason: `explicit state ${metadata.mergeStateStatus}` };
  if (attempt === 3) return { replay: false, reason: 'three-attempt ceiling reached' };
  return { replay: true, reason: 'explicit BEHIND at the checked head' };
}

function readJson(args, run) {
  const text = run(args);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 262144) throw new Error('bounded response required');
  return JSON.parse(text);
}

export function diagnoseRefusal({ repo, number, expectedHead, attempt, run = args => execFileSync('gh', args,
  { encoding: 'utf8', timeout: 15000, maxBuffer: 262144, stdio: ['ignore', 'pipe', 'pipe'] }) }) {
  if (!REPO.test(repo || '') || !Number.isSafeInteger(number) || number < 1
    || !SHA.test(expectedHead || '') || !Number.isInteger(attempt) || attempt < 1 || attempt > 3) throw new Error('invalid invocation');
  let metadata = null;
  try { metadata = readJson(['pr', 'view', String(number), '--repo', repo, '--json', 'headRefOid,mergeStateStatus,reviewDecision'], run); }
  catch { /* No free-text fallback: failed metadata reads cannot authorize a replay. */ }
  const decision = replayDecision(metadata, expectedHead, attempt);
  const lines = [`### Sync merge refusal: ${repo} #${number}`, '',
    `- Decision: ${decision.replay ? 'bounded replay permitted' : 'stopped'} (${decision.reason}).`,
    `- Expected head: \`${expectedHead}\`.`,
    `- Observed head: ${SHA.test(metadata?.headRefOid || '') ? '`' + metadata.headRefOid + '`' : 'unavailable'}.`,
    `- Merge state: ${STATES.has(metadata?.mergeStateStatus) ? metadata.mergeStateStatus : 'unavailable'}.`,
    `- Review decision: ${REVIEWS.has(metadata?.reviewDecision) ? metadata.reviewDecision || 'not required' : 'unavailable'}.`,
    `- Attempt: ${attempt} of 3. No review thread is resolved by this diagnostic.`];
  // Thread data is diagnostic only and never upgrades the metadata decision. No bodies, titles or credentials are retained.
  try {
    const [owner, name] = repo.split('/');
    const reply = readJson(['api', 'graphql', '-f', `query=${THREAD_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`], run);
    const threads = reply.data?.repository?.pullRequest?.reviewThreads;
    if (reply.errors || !Array.isArray(threads?.nodes) || threads.nodes.length > 50
      || typeof threads.pageInfo?.hasNextPage !== 'boolean'
      || threads.nodes.some(thread => typeof thread?.isResolved !== 'boolean')) throw new Error('invalid threads');
    const open = threads.nodes.filter(thread => !thread.isResolved);
    lines.push(`- Unresolved threads in this bounded page: ${open.length}; ${threads.pageInfo.hasNextPage ? 'additional threads were not fetched' : 'complete page'}.`);
    for (const thread of open) {
      const comment = thread.comments?.nodes?.[0];
      const prefix = `https://github.com/${repo}/pull/${number}#discussion_r`;
      const url = typeof comment?.url === 'string' && comment.url.startsWith(prefix)
        && /^\d{1,24}$/.test(comment.url.slice(prefix.length)) ? comment.url : null;
      const revision = SHA.test(comment?.originalCommit?.oid || '') ? '`' + comment.originalCommit.oid + '`' : 'unavailable';
      lines.push(`  - ${url ? '[Review thread](' + url + ')' : 'Review thread (link unavailable)'}; original reviewed revision: ${revision}.`);
    }
  } catch { lines.push('- Review-thread diagnostic unavailable; this is not evidence that all threads are resolved.'); }
  return { ...decision, summary: lines.join('\n') + '\n' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6 || !/^[1-9]\d*$/.test(process.argv[3]) || !/^[1-3]$/.test(process.argv[5])) throw new Error('invalid invocation');
    const result = diagnoseRefusal({ repo: process.argv[2], number: Number(process.argv[3]), expectedHead: process.argv[4], attempt: Number(process.argv[5]) });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary, 'utf8');
    console.log(result.summary);
    process.exitCode = result.replay ? 0 : 1;
  } catch {
    console.error('Sync merge replay refused: bounded diagnostics could not complete.');
    process.exitCode = 1;
  }
}
