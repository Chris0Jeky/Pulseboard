import { createHash } from 'node:crypto';
import { projects } from '../src/projects.mjs';
import {
  parseRunReceiptFile,
  RUN_RECEIPT_COST_KINDS,
  RUN_RECEIPT_OUTCOMES,
  RUN_RECEIPT_STATUSES,
  RUN_RECEIPT_MAX_WINDOW_MS,
} from './contracts.mjs';

const MAX_SUMMARY_ROWS = 5_000;
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeAdd = (left, right, label) => {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds safe integer range`);
  return value;
};
const zeroCounts = values => Object.fromEntries(values.map(value => [value, 0]));

function coversWindow(intervals, start, end) {
  let coveredUntil = start;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.end <= coveredUntil) continue;
    if (interval.start > coveredUntil) return false;
    coveredUntil = interval.end;
    if (coveredUntil >= end) return true;
  }
  return false;
}

function storedReceipt(parsed, receipt, now) {
  const identity = [parsed.source.kind, parsed.source.id, receipt.run, receipt.attempt];
  const receiptKey = hash(identity);
  // Snapshot generation and coverage describe an export, not the immutable run attempt.
  // Repeated evidence from a later overlapping export must remain idempotent.
  const contentHash = hash({ source: parsed.source, receipt });
  return {
    receiptKey,
    contentHash,
    values: [
      receiptKey,
      contentHash,
      parsed.source.kind,
      parsed.source.id,
      receipt.id,
      receipt.run,
      receipt.project,
      parsed.generatedAt,
      parsed.coverage.start,
      parsed.coverage.end,
      parsed.coverage.complete ? 1 : 0,
      JSON.stringify(parsed.coverage.limitations),
      receipt.startedAt,
      receipt.endedAt,
      receipt.status,
      receipt.attempt,
      receipt.retryOf,
      JSON.stringify(receipt.resources),
      receipt.cost?.kind ?? null,
      receipt.cost?.minor ?? null,
      receipt.cost?.currency ?? null,
      receipt.cost?.sourceTime ?? null,
      receipt.outcome.state,
      receipt.outcome.verificationRef,
      now,
    ],
  };
}

const INSERT = `INSERT OR IGNORE INTO private_run_receipts (
  receipt_key, content_hash, source_kind, source_id, receipt_id, run_id, project_id,
  generated, coverage_start, coverage_end, coverage_complete, coverage_limitations,
  started, ended, status, attempt, retry_of, resources,
  cost_kind, cost_minor, cost_currency, cost_source_time,
  outcome_state, verification_ref, imported
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

export async function importRunReceiptFile(DB, text, { now = Date.now(), registry = projects } = {}) {
  requireValue(DB?.prepare && DB?.batch, 'A D1-compatible database is required');
  requireValue(Number.isSafeInteger(now) && now >= 0, 'Invalid import time');
  const parsed = parseRunReceiptFile(text, registry);
  requireValue(parsed.generatedAt <= now + 300_000, 'Run receipt file is future dated');
  const stored = parsed.receipts.map(receipt => storedReceipt(parsed, receipt, now));
  const pending = [];

  // Validate every existing identity before writing anything. A repeated byte-equivalent receipt is
  // idempotent; the same source/run/attempt with changed evidence is a conflict, never an overwrite.
  for (const item of stored) {
    const existing = await DB.prepare('SELECT content_hash FROM private_run_receipts WHERE receipt_key=?')
      .bind(item.receiptKey).first();
    if (existing) {
      requireValue(existing.content_hash === item.contentHash, 'Conflicting run receipt identity');
    } else pending.push(item);
  }

  const results = pending.length
    ? await DB.batch(pending.map(item => DB.prepare(INSERT).bind(...item.values)))
    : [];
  const imported = results.reduce((total, result) => safeAdd(total, Number(result.meta?.changes || 0), 'Imported receipt count'), 0);
  return {
    received: parsed.receipts.length,
    imported,
    duplicates: parsed.receipts.length - imported,
    visibility: 'private',
  };
}

function parseStoredList(value, allowed, label) {
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new TypeError(`Invalid stored ${label}`); }
  requireValue(Array.isArray(parsed) && parsed.every(item => allowed(item)), `Invalid stored ${label}`);
  return parsed;
}

export async function readRunReceiptSummary(DB, { project, start, end, registry = projects } = {}) {
  requireValue(DB?.prepare, 'A D1-compatible database is required');
  requireValue(typeof project === 'string' && Object.hasOwn(registry, project), 'Unknown project summary');
  requireValue(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start
    && end - start <= RUN_RECEIPT_MAX_WINDOW_MS, 'Invalid summary window');
  const { results } = await DB.prepare(`SELECT * FROM private_run_receipts
    WHERE project_id=? AND started>=? AND ended<=?
    ORDER BY started, receipt_key LIMIT ?`).bind(project, start, end, MAX_SUMMARY_ROWS + 1).all();
  if (results.length > MAX_SUMMARY_ROWS) throw new RangeError('Run receipt summary row limit exceeded');

  const statuses = zeroCounts(RUN_RECEIPT_STATUSES), outcomes = zeroCounts(RUN_RECEIPT_OUTCOMES);
  const runs = new Set(), limitations = new Set(), resources = new Map(), costs = new Map();
  const coverageBySource = new Map();
  let durationMs = 0, retries = 0, generatedAt = null, claimedComplete = results.length > 0;

  for (const row of results) {
    statuses[row.status]++;
    outcomes[row.outcome_state]++;
    runs.add(JSON.stringify([row.source_kind, row.source_id, row.run_id]));
    const source = JSON.stringify([row.source_kind, row.source_id]);
    if (row.attempt > 1) retries++;
    durationMs = safeAdd(durationMs, row.ended - row.started, 'Run duration');
    generatedAt = generatedAt === null ? row.generated : Math.max(generatedAt, row.generated);
    requireValue(Number.isSafeInteger(row.coverage_start) && Number.isSafeInteger(row.coverage_end)
      && row.coverage_start >= 0 && row.coverage_end > row.coverage_start,
    'Invalid stored coverage window');
    const intervals = coverageBySource.get(source) || [];
    intervals.push({ start: row.coverage_start, end: row.coverage_end });
    coverageBySource.set(source, intervals);
    claimedComplete &&= row.coverage_complete === 1;

    for (const limitation of parseStoredList(row.coverage_limitations,
      item => typeof item === 'string' && item.length <= 80, 'coverage limitations')) limitations.add(limitation);
    for (const resource of parseStoredList(row.resources,
      item => item && typeof item.unit === 'string' && Number.isSafeInteger(item.value) && item.value >= 0, 'resources')) {
      resources.set(resource.unit, safeAdd(resources.get(resource.unit) || 0, resource.value, `Resource ${resource.unit}`));
    }
    if (row.cost_kind !== null) {
      requireValue(RUN_RECEIPT_COST_KINDS.includes(row.cost_kind) && typeof row.cost_currency === 'string'
        && Number.isSafeInteger(row.cost_minor) && row.cost_minor >= 0 && Number.isSafeInteger(row.cost_source_time),
      'Invalid stored cost');
      const key = `${row.cost_kind}:${row.cost_currency}`;
      const current = costs.get(key) || {
        kind: row.cost_kind,
        currency: row.cost_currency,
        minor: 0,
        receipts: 0,
        sourceTime: { earliest: row.cost_source_time, latest: row.cost_source_time },
      };
      current.minor = safeAdd(current.minor, row.cost_minor, 'Cost total');
      current.receipts++;
      current.sourceTime.earliest = Math.min(current.sourceTime.earliest, row.cost_source_time);
      current.sourceTime.latest = Math.max(current.sourceTime.latest, row.cost_source_time);
      costs.set(key, current);
    }
  }

  // One source cannot certify a missing interval for another observed source.
  const complete = claimedComplete
    && [...coverageBySource.values()].every(intervals => coversWindow(intervals, start, end));
  const costList = [...costs.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency));
  let costPerVerifiedAccepted = null, costAbstention = null;
  if (results.length === 0) costAbstention = 'No run receipts were observed in this window.';
  else if (outcomes['verified-accepted'] === 0) costAbstention = 'No verified accepted outcome is available as a denominator.';
  else if (!complete) costAbstention = 'Receipt coverage is incomplete, so cost per verified accepted outcome would overstate certainty.';
  else if (costList.length !== 1 || costList[0].receipts !== results.length) {
    costAbstention = 'Cost coverage is incomplete or mixes cost kinds/currencies; no combined unit cost is calculated.';
  } else {
    const cost = costList[0], denominator = outcomes['verified-accepted'];
    costPerVerifiedAccepted = {
      kind: cost.kind,
      currency: cost.currency,
      numeratorMinor: cost.minor,
      denominator,
      valueMinor: cost.minor / denominator,
    };
  }

  return {
    schema: 'pulseboard.private-run-summary/1',
    visibility: 'private',
    trust: 'unverified-file',
    generatedAt,
    project,
    window: { start, end },
    statuses,
    attempts: { receipts: results.length, distinctRuns: runs.size, retries },
    durationMs,
    resources: [...resources].map(([unit, value]) => ({ unit, value })).sort((a, b) => a.unit.localeCompare(b.unit)),
    costs: costList,
    outcomes,
    coverage: { complete, sources: coverageBySource.size, limitations: [...limitations].sort() },
    costPerVerifiedAccepted,
    costAbstention,
    limitations: [
      'Private aggregate; excluded from public pulse exports.',
      'Imported files are not authenticated provider evidence.',
      'Attempt counts and resource totals are not developer productivity or value scores.',
    ],
  };
}
