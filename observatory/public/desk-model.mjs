/** Pulseboard Desk v1. Pure decision helpers shared by the UI and tests. GPL-3.0-only. */
export const DAY = 86_400_000;
export const RULE_VERSION = 'desk-rules/1';
export const MIN_OUTCOMES = 20;
export const STALE_AFTER = 30 * 60_000;
export const sum = (xs, get = x => x) => xs.reduce((n, x) => n + get(x), 0);
export const percent = value => value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
export const count = value => Number.isFinite(value) ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value) : '—';

export function wilson(successes, total) {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(successes) || total <= 0 || successes < 0 || successes > total) return null;
  const z2 = 1.96 ** 2, p = successes / total, d = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / d;
  const radius = 1.96 * Math.sqrt(p * (1 - p) / total + z2 / (4 * total ** 2)) / d;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
}
export function fraction(numerator, denominator) {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null, interval: wilson(numerator, denominator) };
}
export function monitorState(project, now) {
  if (!project.probeExpected) return 'local';
  if (!Number.isFinite(project.monitor.checked)) return 'unknown';
  if (project.monitor.checked > now || now - project.monitor.checked > STALE_AFTER) return 'stale';
  return ['up', 'down', 'unknown'].includes(project.monitor.state) ? project.monitor.state : 'unknown';
}
export function compareReleases(baseline, candidate) {
  if (!baseline || !candidate || baseline.release === candidate.release || [baseline.release, candidate.release].includes('unattributed')) {
    return { supported: false, reason: 'Choose two different, attributed release cohorts.', delta: null };
  }
  const a = fraction(baseline.failed, baseline.completed + baseline.failed);
  const b = fraction(candidate.failed, candidate.completed + candidate.failed);
  const supported = Math.min(a.denominator, b.denominator) >= MIN_OUTCOMES;
  return { supported, baseline: a, candidate: b, delta: supported ? b.value - a.value : null,
    reason: supported ? 'Descriptive difference in reported outcomes. Different users, routes and time periods can explain it.'
      : `At least ${MIN_OUTCOMES} reported outcomes per cohort are required. This is a display guard, not a significance test.` };
}
function fingerprint(value) {
  let hash = 2166136261;
  for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
/** Rules surface inspectable observations, never diagnoses or automated changes. */
export function buildSignals(snapshot, now = Date.now()) {
  const signals = [];
  const add = (project, rule, severity, title, detail, evidence, next) => {
    const id = `${project?.id || 'portfolio'}:${rule}`;
    signals.push({ id, key: `${snapshot.mode}:${id}:${fingerprint(evidence)}`, project: project?.id || null,
      label: project?.label || 'Portfolio', rule, version: RULE_VERSION, severity, title, detail, evidence, next });
  };
  if (!snapshot.collectionEnabled) add(null, 'collection.paused', 'note', 'Collection is switched off',
    'The desk is readable. Browser events are not being admitted.', { collectionEnabled: false },
    'Finish the rollout checks before explicitly enabling collection.');
  if (now - snapshot.generatedAt > STALE_AFTER || snapshot.generatedAt > now) add(null, 'snapshot.stale', 'warning', 'This snapshot needs a fresh reading',
    'Keep its observations as history, not current health.', { generatedAt: snapshot.generatedAt }, 'Reconnect to the collector or import a newer snapshot.');
  for (const p of snapshot.projects) {
    const state = monitorState(p, now);
    if (state === 'down') add(p, 'monitor.down', 'critical', `${p.label} failed its synthetic check`,
      'The configured path failed the monitor hysteresis. This does not prove every user journey is down.',
      { state, checked: p.monitor.checked, failures: p.monitor.failures, status: p.monitor.status },
      'Check the configured probe, then the latest deployment and a real product journey.');
    if (state === 'stale') add(p, 'monitor.stale', 'warning', `${p.label} has an old probe reading`,
      'No current availability claim is possible.', { checked: p.monitor.checked }, 'Check the probe schedule and collector readiness.');
    if (state === 'unknown') add(p, 'monitor.unknown', 'note', `${p.label} is waiting for probe evidence`,
      'Unknown is neither healthy nor broken.', { state }, 'Run the configured synthetic probe after reviewing its target.');
    const ratio = p.budget.limit > 0 ? p.budget.used / p.budget.limit : null;
    if (ratio !== null && ratio >= 0.8) add(p, 'budget.pressure', 'warning', `${p.label} is close to its event allowance`,
      'Admission stops at the configured daily limit. Counts describe admitted events, not all traffic.',
      { used: p.budget.used, limit: p.budget.limit, day: p.budget.day }, 'Inspect event volume and sampling before raising the allowance.');
    const outcomes = p.totals.completed + p.totals.failed;
    if (outcomes >= MIN_OUTCOMES && p.totals.failed / outcomes >= 0.1) add(p, 'outcomes.failure', 'warning', `${p.label} has a failure signal`,
      'At least 10% of reported action outcomes failed, with at least 20 outcomes. Retries may appear more than once.',
      { failed: p.totals.failed, outcomes, interval: wilson(p.totals.failed, outcomes), threshold: 0.1, minimum: MIN_OUTCOMES },
      'Compare release and route cohorts; check the hooks before drawing conclusions.');
    const unattributed = p.releases.find(r => r.release === 'unattributed')?.events || 0;
    if (p.totals.events > 0 && unattributed / p.totals.events >= 0.5) add(p, 'release.unattributed', 'note', `${p.label} needs release labels`,
      'At least half of admitted events cannot be linked to a named release.', { unattributed, total: p.totals.events },
      'Register an allowed release label in the collector and the client adapter.');
  }
  const rank = { critical: 0, warning: 1, note: 2 };
  return signals.sort((a, b) => rank[a.severity] - rank[b.severity] || a.label.localeCompare(b.label) || a.rule.localeCompare(b.rule));
}
export function reviewState(signal, reviews, now = Date.now()) {
  const review = reviews[signal.key];
  if (!review || review.until <= now) return 'open';
  return review.state === 'acknowledged' ? 'acknowledged' : review.state === 'snoozed' ? 'snoozed' : 'open';
}
/** `stale` means the last refresh failed: the snapshot below is last-good history, not a current reading. */
export function makeBrief(snapshot, signals, stale = false) {
  const projects = snapshot.projects;
  const mode = snapshot.mode === 'demo' ? 'SYNTHETIC DEMO' : 'PRIVATE AGGREGATE SNAPSHOT';
  return [`# Pulseboard field note`, '', `${mode}. Generated ${new Date(snapshot.generatedAt).toISOString()}.`,
    ...(stale === true ? ['REFRESH FAILED. Last-good snapshot; current health unknown.'] : []),
    `Window: ${new Date(snapshot.window.start).toISOString()} to ${new Date(snapshot.window.end).toISOString()} (end exclusive).`,
    '', `${projects.length} projects. ${sum(projects, p => p.totals.sessions)} reported sessions, not verified people.`,
    `Collection: ${snapshot.collectionEnabled ? 'enabled' : 'disabled'}. ${signals.length} rule observations.`, '',
    ...signals.flatMap(s => [`## ${s.title}`, s.detail, `Evidence: ${JSON.stringify(s.evidence)}`, `Next check: ${s.next}`, '']),
    '## Reading limits', ...snapshot.limitations.map(x => `- ${x}`), '',
    'This is an operator note, not an instruction to merge, deploy, page anyone, or publish private data.', ''].join('\n');
}
export function makeHandoff(snapshot, signal, stale = false) {
  return { schema: 'pulseboard.handoff/1', mode: snapshot.mode, generatedAt: snapshot.generatedAt, stale: stale === true,
    destination: 'review-before-import', title: signal.title, project: signal.project,
    observation: signal.detail, evidence: signal.evidence, nextCheck: signal.next,
    rule: { id: signal.rule, version: signal.version }, window: snapshot.window,
    boundaries: ['No automatic task creation or execution.', 'Contains aggregates, not event rows.', 'Review before sharing.'] };
}
