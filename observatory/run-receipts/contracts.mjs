import { projects } from '../src/projects.mjs';

export const RUN_RECEIPT_MAX_BYTES = 262_144;
export const RUN_RECEIPT_MAX_ITEMS = 256;
export const RUN_RECEIPT_MAX_WINDOW_MS = 90 * 86_400_000;
export const RUN_RECEIPT_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed-out', 'skipped'];
export const RUN_RECEIPT_OUTCOMES = ['verified-accepted', 'verified-rejected', 'unverified', 'not-applicable'];
export const RUN_RECEIPT_RESOURCE_UNITS = [
  'runner_seconds',
  'cpu_seconds',
  'gpu_seconds',
  'storage_byte_seconds',
  'network_bytes',
  'tokens_input',
  'tokens_output',
];
export const RUN_RECEIPT_COST_KINDS = ['actual', 'estimated', 'subscription-allocation'];
export const RUN_RECEIPT_LIMITATIONS = [
  'manual-export',
  'partial-history',
  'billing-estimate',
  'cancelled-runs-included',
  'outcomes-incomplete',
  'provider-retries-unavailable',
  'clock-skew-possible',
];

const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };
const exactKeys = (value, keys, message = 'Unexpected receipt fields') => {
  requireValue(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), message);
};
const unique = (values, message = 'Duplicate receipt identity') => requireValue(new Set(values).size === values.length, message);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => {
  requireValue(Number.isSafeInteger(value) && value >= 0 && value <= max, 'Invalid non-negative integer');
  return value;
};
const identifier = (value, max = 96) => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= max, 'Invalid bounded identifier');
  requireValue(/^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/.test(value), 'Invalid bounded identifier');
  requireValue(!/(?:github_pat_|gh[pousr]_|sk-)/i.test(value), 'Credential-shaped identifier');
  return value;
};
const utc = value => {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 'Expected canonical UTC timestamp');
  const stamp = Date.parse(value);
  requireValue(Number.isSafeInteger(stamp) && new Date(stamp).toISOString() === value, 'Expected canonical UTC timestamp');
  return stamp;
};
const enumValue = (value, allowed, message) => {
  requireValue(allowed.includes(value), message);
  return value;
};
const boundedList = (value, max, message) => {
  requireValue(Array.isArray(value) && value.length <= max, message);
  return value;
};

function readCoverage(value, generatedAt) {
  exactKeys(value, ['start', 'end', 'complete', 'limitations'], 'Unexpected coverage fields');
  const start = utc(value.start), end = utc(value.end);
  requireValue(end > start && end - start <= RUN_RECEIPT_MAX_WINDOW_MS && generatedAt >= end, 'Invalid receipt coverage window');
  requireValue(typeof value.complete === 'boolean', 'Coverage completeness must be explicit');
  const limitations = boundedList(value.limitations, 8, 'Too many coverage limitations')
    .map(item => enumValue(item, RUN_RECEIPT_LIMITATIONS, 'Unknown coverage limitation'));
  unique(limitations, 'Duplicate coverage limitation');
  return { start, end, complete: value.complete, limitations: [...limitations].sort() };
}

function readResource(value) {
  exactKeys(value, ['unit', 'value'], 'Unexpected resource fields');
  return {
    unit: enumValue(value.unit, RUN_RECEIPT_RESOURCE_UNITS, 'Unknown resource unit'),
    value: integer(value.value, 1_000_000_000_000_000),
  };
}

function readCost(value, coverage, generatedAt) {
  if (value === null) return null;
  exactKeys(value, ['kind', 'minor', 'currency', 'sourceTime'], 'Unexpected cost fields');
  const sourceTime = utc(value.sourceTime);
  requireValue(sourceTime >= coverage.start && sourceTime <= generatedAt, 'Cost source time is outside the import window');
  requireValue(typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency), 'Invalid ISO currency');
  return {
    kind: enumValue(value.kind, RUN_RECEIPT_COST_KINDS, 'Unknown cost kind'),
    minor: integer(value.minor, 1_000_000_000_000),
    currency: value.currency,
    sourceTime,
  };
}

function readOutcome(value) {
  exactKeys(value, ['state', 'verificationRef'], 'Unexpected outcome fields');
  const state = enumValue(value.state, RUN_RECEIPT_OUTCOMES, 'Unknown outcome state');
  const verified = state === 'verified-accepted' || state === 'verified-rejected';
  requireValue(verified ? value.verificationRef !== null : value.verificationRef === null,
    'Verified outcomes require a bounded reference; other outcomes must omit it');
  return { state, verificationRef: verified ? identifier(value.verificationRef, 96) : null };
}

function readReceipt(value, context, registry) {
  exactKeys(value, [
    'id', 'run', 'project', 'startedAt', 'endedAt', 'status', 'attempt', 'retryOf',
    'resources', 'cost', 'outcome',
  ]);
  const id = identifier(value.id, 96), run = identifier(value.run, 96), project = identifier(value.project, 64);
  requireValue(Object.hasOwn(registry, project), 'Unknown project mapping');
  const startedAt = utc(value.startedAt), endedAt = utc(value.endedAt);
  requireValue(startedAt >= context.coverage.start && endedAt <= context.coverage.end && endedAt >= startedAt,
    'Receipt time is outside coverage');
  requireValue(endedAt - startedAt <= 7 * 86_400_000, 'Receipt duration exceeds seven days');
  const attempt = integer(value.attempt, 100);
  requireValue(attempt >= 1, 'Attempt numbers start at one');
  const retryOf = value.retryOf === null ? null : identifier(value.retryOf, 96);
  requireValue(attempt === 1 ? retryOf === null : retryOf !== null, 'Retry linkage must match the attempt number');
  requireValue(retryOf !== id, 'A receipt cannot retry itself');
  const resources = boundedList(value.resources, 8, 'Too many resource units').map(readResource);
  requireValue(resources.length > 0, 'At least one measured resource is required');
  unique(resources.map(item => item.unit), 'Duplicate resource unit');
  resources.sort((a, b) => a.unit.localeCompare(b.unit));
  return {
    id,
    run,
    project,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    status: enumValue(value.status, RUN_RECEIPT_STATUSES, 'Unknown run status'),
    attempt,
    retryOf,
    resources,
    cost: readCost(value.cost, context.coverage, context.generatedAt),
    outcome: readOutcome(value.outcome),
  };
}

export function parseRunReceiptFile(text, registry = projects) {
  requireValue(typeof text === 'string' && new TextEncoder().encode(text).length <= RUN_RECEIPT_MAX_BYTES,
    'Run receipt import exceeds 256 KiB');
  const input = JSON.parse(text);
  exactKeys(input, ['schema', 'source', 'generatedAt', 'coverage', 'receipts'], 'Unexpected run receipt envelope fields');
  requireValue(input.schema === 'pulseboard.run-receipts/1', 'Unsupported run receipt schema');
  exactKeys(input.source, ['kind', 'id'], 'Unexpected source fields');
  requireValue(input.source.kind === 'github-actions-file', 'Unsupported run receipt source');
  const source = { kind: input.source.kind, id: identifier(input.source.id, 80) };
  const generatedAt = utc(input.generatedAt);
  const coverage = readCoverage(input.coverage, generatedAt);
  const rawReceipts = boundedList(input.receipts, RUN_RECEIPT_MAX_ITEMS, 'Too many run receipts');
  requireValue(rawReceipts.length > 0, 'At least one run receipt is required');
  const context = { generatedAt, coverage };
  const receipts = rawReceipts.map(value => readReceipt(value, context, registry));

  unique(receipts.map(item => item.id));
  unique(receipts.map(item => `${item.run}:${item.attempt}`), 'Duplicate run attempt');
  requireValue(new Set(receipts.map(item => item.project)).size <= 16, 'Too many project mappings');
  requireValue(new Set(receipts.flatMap(item => item.cost ? [item.cost.currency] : [])).size <= 4, 'Too many currencies');

  const byId = new Map(receipts.map(item => [item.id, item]));
  for (const item of receipts) {
    if (item.retryOf === null) continue;
    const previous = byId.get(item.retryOf);
    requireValue(previous && previous.run === item.run && previous.project === item.project && previous.attempt < item.attempt,
      'Retry link must reference an earlier attempt for the same run and project');
  }

  return {
    schema: 'pulseboard.private-run-receipts/1',
    visibility: 'private',
    trust: 'unverified-file',
    source,
    generatedAt,
    coverage,
    receipts,
    limitations: [
      'Imported file claims are not authenticated provider evidence.',
      'Receipts measure attempts and configured resource units, not developer productivity or business value.',
      'Run and verification identities stay private and are excluded from public pulse exports.',
    ],
  };
}

const zeroCounts = values => Object.fromEntries(values.map(value => [value, 0]));
export function previewRunReceiptFile(text, registry = projects) {
  const parsed = parseRunReceiptFile(text, registry);
  const projectCounts = new Map(), resourceTotals = new Map(), costTotals = new Map();
  const statuses = zeroCounts(RUN_RECEIPT_STATUSES), outcomes = zeroCounts(RUN_RECEIPT_OUTCOMES);
  let totalDurationMs = 0;
  for (const item of parsed.receipts) {
    projectCounts.set(item.project, (projectCounts.get(item.project) || 0) + 1);
    statuses[item.status]++;
    outcomes[item.outcome.state]++;
    totalDurationMs += item.durationMs;
    for (const resource of item.resources) resourceTotals.set(resource.unit, (resourceTotals.get(resource.unit) || 0) + resource.value);
    if (item.cost) {
      const key = `${item.cost.kind}:${item.cost.currency}`;
      const current = costTotals.get(key) || { kind: item.cost.kind, currency: item.cost.currency, minor: 0, receipts: 0 };
      current.minor += item.cost.minor; current.receipts++; costTotals.set(key, current);
    }
  }
  const sorted = map => [...map.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    schema: 'pulseboard.run-receipt-preview/1',
    visibility: 'private',
    trust: parsed.trust,
    source: parsed.source,
    generatedAt: parsed.generatedAt,
    coverage: parsed.coverage,
    receiptCount: parsed.receipts.length,
    projects: [...projectCounts].map(([project, receipts]) => ({ project, receipts })).sort((a, b) => a.project.localeCompare(b.project)),
    statuses,
    outcomes,
    totalDurationMs,
    resources: [...resourceTotals].map(([unit, value]) => ({ unit, value })).sort((a, b) => a.unit.localeCompare(b.unit)),
    costs: sorted(costTotals),
    redacted: ['receipt ids', 'run ids', 'retry links', 'verification references'],
    limitations: parsed.limitations,
  };
}
