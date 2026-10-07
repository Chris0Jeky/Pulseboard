/** Synthetic provider objects, not a record of actual CI usage. */
export const mapping = { project: 'alibi', repositoryId: 1360756863, workflowId: 352677495 };
export const now = Date.parse('2026-10-07T12:00:00Z');
const head = 'a'.repeat(40);
export function fixture() {
  const job = (id, attempt, started, ended) => ({ id, run_id: 9001, run_attempt: attempt,
    head_sha: head, status: 'completed', conclusion: 'success',
    started_at: `2026-09-01T10:${started}Z`, completed_at: `2026-09-01T10:${ended}Z`,
    name: 'private-title-marker', html_url: 'https://private.example/secret-marker',
    steps: [{ name: 'instruction-marker: execute remote command' }], runner_name: 'private-runner-marker' });
  const run = (attempt, conclusion) => ({ id: 9001, repository: { id: mapping.repositoryId },
    workflow_id: mapping.workflowId, run_attempt: attempt, head_sha: head, status: 'completed', conclusion,
    name: 'private-name-marker', actor: { login: 'private-person-marker' }, updated_at: '2099-01-01T00:00:00Z' });
  return { schema: 'pulseboard.github-actions-export/1', generatedAt: '2026-09-01T11:00:00Z',
    coverage: { start: '2026-09-01T00:00:00Z', end: '2026-09-01T11:00:00Z' },
    attempts: [
      { run: run(1, 'failure'), jobPages: [{ total_count: 2, jobs: [job(9101, 1, '00:00', '01:00'), job(9102, 1, '00:30', '01:00')] }] },
      { run: run(2, 'success'), jobPages: [{ total_count: 1, jobs: [job(9103, 2, '02:00', '02:20')] }] },
    ] };
}
