/** Deterministic invented scenarios. Never written to the collector or presented as production evidence. */
import { DAY, fraction } from './desk-model.mjs';
export const SCENARIOS = { release: 'Release wobble', quiet: 'Quiet portfolio', blind: 'Missing readings', pressure: 'Event pressure' };
const catalog = [
  ['alibi', 'Alibi'], ['commitatlas', 'CommitAtlas'], ['taskdeck', 'Taskdeck'], ['developer-lens', 'Developer Lens'],
  ['mdviewer', 'MDviewer'], ['portfolio', 'Portfolio'], ['idleharbor', 'IdleHarbor'], ['wealthlens', 'WealthLens'],
];
function spread(total, days) {
  const weights = days.map((_, i) => 3 + (i * 7 + 5) % 11);
  const scale = weights.reduce((a, b) => a + b, 0);
  let left = total;
  return days.map((day, i) => {
    const n = i === days.length - 1 ? left : Math.floor(total * weights[i] / scale);
    left -= n; return { day, n };
  });
}
export function makeDemo(scenario = 'release', { now = Date.now(), days = 7, phase = 1 } = {}) {
  if (!Object.hasOwn(SCENARIOS, scenario) || ![1, 7, 14].includes(days) || ![0, 1, 2].includes(phase)) throw new RangeError('Unknown demo setting');
  const end = Math.floor(now / 60_000) * 60_000;
  const start = end - days * DAY;
  const buckets = Array.from({ length: Math.ceil(end / DAY) - Math.floor(start / DAY) }, (_, i) => Math.floor(start / DAY) + i);
  const projects = catalog.map(([id, label], i) => {
    const local = id === 'taskdeck', empty = scenario === 'quiet' || local;
    const failed = i === 0 && scenario === 'release' && phase === 1 ? 37 : 2 + i;
    const releases = empty ? [] : [
      { release: '0.6.1', events: (640 - i * 35) * days, completed: 160 - i * 9, failed, errors: failed + 2,
        last: end - 4 * 60_000, duration: { n: 100, mean: i === 0 && phase === 1 ? 624 : 212, p95: i === 0 && phase === 1 ? 1450 : 390, unit: 'ms', method: 'nearest-rank' } },
      { release: '0.6.0', events: (420 - i * 25) * days, completed: 195 - i * 10, failed: 3,
        errors: 4, last: end - 12 * 3600_000, duration: { n: 100, mean: 190, p95: 360, unit: 'ms', method: 'nearest-rank' } },
    ];
    const n = key => releases.reduce((sum, r) => sum + r[key], 0);
    const daily = spread(n('events'), buckets);
    const admittedToday = daily.find(d => d.day === Math.floor(end / DAY))?.n || 0;
    const stale = scenario === 'blind' || (i === 6 && scenario === 'release');
    const down = scenario === 'release' && i === 0 && phase === 1;
    const checked = local ? null : end - (stale ? 95 : 3) * 60_000;
    return { id, label, origin: null, collectionEligible: !local, collectionAdmitted: !local, probeExpected: !local,
      monitor: { state: local ? 'unknown' : down ? 'down' : 'up', checked, opened: down ? end - 18 * 60_000 : null,
        status: down ? 503 : 200, duration: down ? 8100 : 80 + i * 23, failures: down ? 4 : 0, successes: down ? 0 : 8 },
      probeSamples: fraction(local ? 0 : down ? 190 : 201, local ? 0 : 201),
      totals: { events: n('events'), sessions: Math.floor(n('events') / 5), completed: n('completed'), failed: n('failed'), errors: n('errors'), last: empty ? null : end - 4 * 60_000 },
      flow: fraction(empty ? 0 : 72 + i * 2, empty ? 0 : 100 + i * 3), daily,
      routes: empty ? [] : [{ route: 'home', n: Math.floor(n('events') * 0.3) }, { route: 'workspace', n: n('events') - Math.floor(n('events') * 0.3) }],
      releases, budget: { used: empty ? 0 : scenario === 'pressure' ? 2400 + i : Math.max(admittedToday, 280 + i * 47), limit: 2500, day: new Date(end).toISOString().slice(0, 10) } };
  });
  return { schema: 'pulseboard.portfolio/2', mode: 'demo', generatedAt: end, collectionEnabled: true,
    window: { start, end, days, timezone: 'UTC' }, projects,
    limitations: ['Every number in this scenario is invented. No production request is made.',
      'Sessions are client-reported, not verified people. Repeated action outcomes are possible.',
      'Probe samples are not time-weighted uptime. Release differences do not establish causality.',
      'Taskdeck remains local-first. No private board, task or repository content is collected.'] };
}
/** SYNTHETIC GitHub evidence for the demo drawer. Invented ids and hashes; it never reaches a server or a live snapshot. */
export function makeGithubDemo(snapshot, project) {
  const at = snapshot.generatedAt, opened = snapshot.projects.find(p => p.id === project)?.monitor.opened, deployedAt = (opened ?? at - 5 * 3600_000) - 42 * 60_000;
  const read = (target, state, reason, sourceTime, evidence) => ({ target, state, reason, observedAt: at, sourceTime, evidence, resetAt: null, truncated: false, lastKnown: null });
  const failed = read({ workflowId: 12, path: '.github/workflows/e2e.yml', branch: 'main', role: 'ci' }, 'failing', 'failure', at - 9 * 3600_000,
    { runId: 902, runAttempt: 2, headSha: '0d15ea5e'.repeat(5), status: 'completed', conclusion: 'failure' });
  return { schema: 'pulseboard.github-evidence/1', mode: 'demo', generatedAt: at, project, configuration: 'ready',
    mapping: { schema: 'pulseboard.github-map/1', revision: 1, reviewedAt: '2026-09-10' }, rules: 'github-evidence/1',
    repositories: [{ repositoryId: 1, repository: `example/${project}`, renamed: null, state: 'observed', reason: 'read', observedAt: at,
      workflows: [read({ workflowId: 11, path: '.github/workflows/ci.yml', branch: 'main', role: 'ci' }, 'passing', 'success', deployedAt - 6 * 60_000,
        { runId: 901, runAttempt: 1, headSha: 'c0ffee00'.repeat(5), status: 'completed', conclusion: 'success' }),
        { ...failed, state: 'stale', reason: 'old-observation', observedAt: null, sourceTime: null, evidence: null,
          lastKnown: { state: failed.state, reason: failed.reason, observedAt: at - 8 * 3600_000, sourceTime: failed.sourceTime, evidence: failed.evidence } }],
      environments: [read({ name: 'production' }, 'passing', 'success', deployedAt + 90_000,
        { deploymentId: 77, sha: 'c0ffee00'.repeat(5), environment: 'production', createdAt: deployedAt, status: 'success' })],
      releases: read({ max: 3 }, 'observed', 'listed', deployedAt - 60_000, { releases: [{ id: 5, tag: '0.6.1', prerelease: false, publishedAt: deployedAt - 60_000 }] }) }],
    limitations: ['SYNTHETIC. Every repository, run, deployment and release here is invented. No request reached GitHub.',
      'Temporal proximity is not a cause. Stale readings are last-known history, never current state.'] };
}
