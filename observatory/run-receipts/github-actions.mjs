/** Offline provider conversion. Raw provider fields are never instructions or URLs to fetch. */
import { projects } from '../src/projects.mjs';
import { RUN_RECEIPT_MAX_BYTES, RUN_RECEIPT_MAX_ITEMS, previewRunReceiptFile } from './contracts.mjs';
import { validateRunReceiptImport } from './store.mjs';

const statuses = { success: 'succeeded', failure: 'failed', cancelled: 'cancelled', timed_out: 'timed-out', skipped: 'skipped' };
const requireValue = (value, message) => { if (!value) throw new TypeError(message); };
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => requireValue(plain(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key)), 'Unsupported Actions export fields');
const id = value => Number.isSafeInteger(value) && value > 0;
const list = (value, max) => requireValue(Array.isArray(value) && value.length > 0 && value.length <= max, 'Invalid Actions export cardinality');
function time(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), 'Invalid Actions UTC time');
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  const ms = Date.parse(canonical);
  requireValue(Number.isSafeInteger(ms) && ms >= 0 && new Date(ms).toISOString() === canonical, 'Invalid Actions UTC time');
  return ms;
}
function settled(value) {
  requireValue(plain(value) && value.status === 'completed' && typeof value.conclusion === 'string' && Object.hasOwn(statuses, value.conclusion),
    'Actions evidence must have a supported completed status');
}

export function convertGithubActionsExport(text, mapping, { now = Date.now(), registry = projects } = {}) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= RUN_RECEIPT_MAX_BYTES, 'Actions export exceeds 256 KiB');
  exact(mapping, ['project', 'repositoryId', 'workflowId']);
  requireValue(typeof mapping.project === 'string' && Object.hasOwn(registry, mapping.project) &&
    id(mapping.repositoryId) && id(mapping.workflowId), 'Invalid explicit Actions mapping');
  const input = JSON.parse(text);
  exact(input, ['schema', 'generatedAt', 'coverage', 'attempts']);
  requireValue(input.schema === 'pulseboard.github-actions-export/1', 'Unsupported Actions export schema');
  exact(input.coverage, ['start', 'end']);
  list(input.attempts, RUN_RECEIPT_MAX_ITEMS);
  const generatedAt = new Date(time(input.generatedAt)).toISOString();
  const coverage = { start: new Date(time(input.coverage.start)).toISOString(), end: new Date(time(input.coverage.end)).toISOString(),
    complete: false, limitations: ['manual-export', 'partial-history', 'outcomes-incomplete'] };
  const seenAttempts = new Set(), seenJobs = new Set();
  const rows = input.attempts.map(entry => {
    exact(entry, ['run', 'jobPages']);
    const run = entry.run;
    settled(run);
    requireValue(id(run.id) && run.repository?.id === mapping.repositoryId && run.workflow_id === mapping.workflowId &&
      Number.isSafeInteger(run.run_attempt) && run.run_attempt >= 1 && run.run_attempt <= 100 &&
      typeof run.head_sha === 'string' && /^[0-9a-f]{40}$/.test(run.head_sha), 'Actions run identity does not match its mapping');
    const key = `${run.id}:${run.run_attempt}`;
    requireValue(!seenAttempts.has(key), 'Duplicate Actions run attempt');
    seenAttempts.add(key);
    list(entry.jobPages, 10);
    const total = entry.jobPages[0]?.total_count;
    requireValue(id(total) && total <= 1000, 'Invalid Actions job total');
    const jobs = entry.jobPages.flatMap(page => {
      requireValue(plain(page) && page.total_count === total, 'Inconsistent Actions page total');
      list(page.jobs, 100);
      return page.jobs;
    });
    requireValue(jobs.length === total, 'Incomplete Actions job pages');
    let start = Infinity, end = -Infinity, milliseconds = 0;
    for (const job of jobs) {
      settled(job);
      requireValue(id(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt &&
        job.head_sha === run.head_sha && !seenJobs.has(job.id), 'Mismatched or duplicate Actions job identity');
      seenJobs.add(job.id);
      requireValue(seenJobs.size <= 4096, 'Too many Actions jobs');
      const began = time(job.started_at), ended = time(job.completed_at);
      requireValue(ended >= began, 'Reversed Actions job interval');
      start = Math.min(start, began); end = Math.max(end, ended);
      milliseconds += ended - began;
      requireValue(Number.isSafeInteger(milliseconds), 'Actions resource total exceeds safe integer range');
    }
    // Do not silently round billing time or pretend missing timings mean zero use.
    requireValue(milliseconds % 1000 === 0, 'Actions intervals cannot be represented as integer runner seconds');
    return { runId: run.id, receipt: { id: `gh-${run.id}-attempt-${run.run_attempt}`, run: `gh-${run.id}`,
      project: mapping.project, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
      status: statuses[run.conclusion], attempt: run.run_attempt,
      retryOf: run.run_attempt === 1 ? null : `gh-${run.id}-attempt-${run.run_attempt - 1}`,
      resources: [{ unit: 'runner_seconds', value: milliseconds / 1000 }], cost: null,
      outcome: { state: 'unverified', verificationRef: null } } };
  }).sort((a, b) => a.runId - b.runId || a.receipt.attempt - b.receipt.attempt);
  const file = { schema: 'pulseboard.run-receipts/1', source: { kind: 'github-actions-file',
    id: `gh-jobs-v1-${mapping.repositoryId}-${mapping.workflowId}` }, generatedAt, coverage,
    receipts: rows.map(row => row.receipt) };
  // Existing validation enforces coverage, bounded intervals and same-file retry links.
  validateRunReceiptImport(JSON.stringify(file), { now, registry });
  return file;
}

export function previewGithubActionsExport(text, mapping, options) {
  const file = convertGithubActionsExport(text, mapping, options);
  const preview = previewRunReceiptFile(JSON.stringify(file), options?.registry);
  return { ...preview, limitations: [...preview.limitations,
    'runner_seconds sums exported job intervals including parallel jobs; it is not billable time or CPU time.',
    'Receipt start/end bound the observed job envelope, not queue wait or exact workflow completion.',
    'Complete job-page counts do not certify complete workflow history; every manual export stays partial.',
    'A successful workflow is not a verified accepted outcome; no price or invoice amount is inferred.',
  ] };
}
