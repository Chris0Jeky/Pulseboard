// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAD = 'a'.repeat(40);
const workflow = readFileSync(new URL('../../.github/workflows/sync-sites.yml', import.meta.url), 'utf8');
const helper = fileURLToPath(new URL('../adapters/sync-merge-refusal.mjs', import.meta.url));

// Execute the real merge step with inert command fakes. Any git command is the
// replay boundary; the fake fails immediately instead of touching a repository.
function runMergeStep(t, state, observedHead = HEAD) {
  const root = mkdtempSync(join(tmpdir(), 'pulseboard-merge-refusal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['site', 'bin', 'pulseboard/observatory/adapters']) mkdirSync(join(root, name), { recursive: true });
  if (existsSync(helper)) cpSync(helper, join(root, 'pulseboard/observatory/adapters/sync-merge-refusal.mjs'));
  const fake = (name, source) => writeFileSync(join(root, 'bin', name), '#!/bin/sh\n' + source, { mode: 0o755 });
  fake('sleep', 'exit 0\n');
  fake('git', 'echo reached >> "$REPLAY_TRACE"\nexit 99\n');
  fake('gh', `case "$*" in
    "run list "*) exit 0 ;;
    "pr checks "*) exit 0 ;;
    "pr merge "*) echo 'head branch is not up to date with the base branch' >&2; exit 1 ;;
    *"--json headRefOid -q .headRefOid") printf '%s' "$EXPECTED_HEAD" ;;
    *"--json mergeStateStatus -q .mergeStateStatus") printf '%s' "$TEST_STATE" ;;
    "pr view "*) printf '%s' "$TEST_METADATA" ;;
    "api graphql "*) printf '%s' '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}' ;;
    *) echo 'unexpected gh call' >&2; exit 98 ;;
  esac\n`);
  const step = workflow.split('      - name: Merge when every check succeeds\n')[1];
  assert.ok(step, 'real workflow merge step exists');
  const script = step.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const trace = join(root, 'replay.txt');
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH,
      REPO: 'Chris0Jeky/Alibi', NUMBER: '415', HEAD, BASE: 'main', EXPECTED_HEAD: HEAD,
      TEST_STATE: state, TEST_METADATA: JSON.stringify({ mergeStateStatus: state, headRefOid: observedHead, reviewDecision: 'APPROVED' }),
      GITHUB_STEP_SUMMARY: join(root, 'summary.md'), REPLAY_TRACE: trace },
  });
  return { ...result, replayed: existsSync(trace), summary: existsSync(join(root, 'summary.md')) ? readFileSync(join(root, 'summary.md'), 'utf8') : '' };
}

test('the real sync workflow does not replay BLOCKED despite misleading stale-branch prose', t => {
  const result = runMergeStep(t, 'BLOCKED');
  assert.equal(result.replayed, false, result.stderr);
  assert.equal(result.status, 1);
});

test('the real sync workflow permits the existing replay path only for explicit BEHIND metadata', t => {
  const result = runMergeStep(t, 'BEHIND');
  assert.equal(result.replayed, true, result.stderr);
  assert.equal(result.status, 99, 'the inert git fake, not a real replay, was reached');
});

test('a post-refusal head movement is never replayed', t => {
  const result = runMergeStep(t, 'BEHIND', 'b'.repeat(40));
  assert.equal(result.replayed, false, result.stderr);
  assert.equal(result.status, 1);
});

const { replayDecision, diagnoseRefusal } = await import('../adapters/sync-merge-refusal.mjs');
const metadata = { headRefOid: HEAD, mergeStateStatus: 'BEHIND', reviewDecision: 'APPROVED' };
const threadReply = { data: { repository: { pullRequest: { reviewThreads: {
  pageInfo: { hasNextPage: false }, nodes: [],
} } } } };

test('replay decisions fail closed for absent/invalid metadata, changed heads and the ceiling', () => {
  for (const state of ['BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'UNKNOWN', 'UNSTABLE', 'HAS_HOOKS', 'behind', '']) {
    assert.equal(replayDecision({ ...metadata, mergeStateStatus: state }, HEAD, 1).replay, false, state);
  }
  for (const value of [null, {}, { ...metadata, headRefOid: 'bad' }, { ...metadata, reviewDecision: 'arbitrary' }]) {
    assert.equal(replayDecision(value, HEAD, 1).replay, false);
  }
  for (const attempt of [0, 3, 4, NaN, 1.5]) assert.equal(replayDecision(metadata, HEAD, attempt).replay, false);
  for (const attempt of [1, 2]) assert.equal(replayDecision(metadata, HEAD, attempt).replay, true);
});

test('diagnostics preserve thread coverage and safe links/revisions without importing free text', () => {
  const response = structuredClone(threadReply);
  const threads = response.data.repository.pullRequest.reviewThreads;
  threads.pageInfo.hasNextPage = true;
  threads.nodes = [
    { isResolved: true },
    { isResolved: false, comments: { nodes: [{ url: 'https://github.com/Chris0Jeky/Alibi/pull/415#discussion_r123', originalCommit: { oid: 'b'.repeat(40) }, body: 'PRIVATE_SENTINEL' }] } },
    { isResolved: false, comments: { nodes: [{ url: 'javascript:PRIVATE_SENTINEL', originalCommit: { oid: 'PRIVATE_SENTINEL' } }] } },
  ];
  const calls = [];
  const result = diagnoseRefusal({ repo: 'Chris0Jeky/Alibi', number: 415, expectedHead: HEAD, attempt: 1,
    run: args => { calls.push(args); return JSON.stringify(args[0] === 'pr' ? { ...metadata, mergeStateStatus: 'BLOCKED' } : response); } });
  assert.equal(result.replay, false);
  assert.equal(calls.length, 2);
  assert.match(result.summary, /additional threads were not fetched/);
  assert.match(result.summary, /discussion_r123/);
  assert.match(result.summary, new RegExp('b'.repeat(40)));
  assert.doesNotMatch(result.summary, /PRIVATE_SENTINEL|javascript/);
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['pr', 'view'], ['api', 'graphql']]);
});

test('unknown metadata never permits replay, even when thread diagnostics succeed', () => {
  for (const result of ['', 'not JSON', 'x'.repeat(262145)]) {
    const decision = diagnoseRefusal({ repo: 'Chris0Jeky/Alibi', number: 415, expectedHead: HEAD, attempt: 1,
      run: args => args[0] === 'pr' ? result : JSON.stringify(threadReply) });
    assert.equal(decision.replay, false);
  }
  const decision = diagnoseRefusal({ repo: 'Chris0Jeky/Alibi', number: 415, expectedHead: HEAD, attempt: 1,
    run: () => { throw new Error('PRIVATE_SENTINEL'); } });
  assert.equal(decision.replay, false);
  assert.match(decision.summary, /diagnostic unavailable/);
  assert.doesNotMatch(decision.summary, /PRIVATE_SENTINEL/);
});

test('invalid caller arguments do not start gh and diagnostic failure cannot upgrade BLOCKED', () => {
  let calls = 0;
  assert.throws(() => diagnoseRefusal({ repo: '--execute', number: 1, expectedHead: HEAD, attempt: 1, run: () => { calls++; } }));
  assert.equal(calls, 0);
  const result = diagnoseRefusal({ repo: 'Chris0Jeky/Alibi', number: 415, expectedHead: HEAD, attempt: 1,
    run: args => args[0] === 'pr' ? JSON.stringify({ ...metadata, mergeStateStatus: 'BLOCKED' }) : '{"errors":["PRIVATE_SENTINEL"]}' });
  assert.equal(result.replay, false);
  assert.match(result.summary, /diagnostic unavailable/);
  assert.doesNotMatch(result.summary, /PRIVATE_SENTINEL/);
});
