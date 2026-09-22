/** GitHub development evidence: closed contract, deployment leads and the release notebook. Shared by server and browser. */
import { DAY, RULE_VERSION, fingerprint } from './desk-model.mjs';
import { requireValue, boundedString, exactKeys, list, safeFindingText } from './desk-bridge.mjs';
export const GITHUB_SCHEMA = 'pulseboard.github-evidence/1';
export const GITHUB_RULES = 'github-evidence/1';
/** `observed` is presence without a pass/fail meaning (a repository or a release list). */
export const GITHUB_STATES = ['unconfigured', 'missing', 'pending', 'passing', 'failing', 'inconclusive', 'stale', 'rate-limited', 'unavailable', 'observed'];
const READ = ['missing', 'pending', 'passing', 'failing', 'inconclusive', 'observed'];
export const WORKFLOW_ROLES = ['ci', 'release', 'deploy'];
export const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$/;
export const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9_.-]{1,100}\.ya?ml$/;
export const ENVIRONMENT = /^[A-Za-z0-9 _.-]{1,64}$/;
const SHA = /^[0-9a-f]{40}$/, REASON = /^[a-z0-9_-]{1,40}$/;
export const GITHUB_LIMITATIONS = [
  'Read from the GitHub REST API through a reviewed numeric-id mapping. Unmapped workflows and repositories are not shown.',
  'A passing run describes one workflow on one branch. It is not repository health, product availability or a verified release.',
  'Deployment and release times are leads. Temporal proximity is not a cause.',
  'Stale readings are last-known history, never current state. Missing means not observed, not absent.',
];
const positive = value => Number.isSafeInteger(value) && value > 0;
const stamp = value => requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000, 'Invalid timestamp');
const maybe = (value, check) => { if (value !== null) check(value); };
const slug = value => requireValue(typeof value === 'string' && REASON.test(value), 'Invalid state text');
const ITEM = ['target', 'state', 'reason', 'observedAt', 'sourceTime', 'evidence', 'resetAt', 'truncated', 'lastKnown'];
const targets = {
  workflow: t => { exactKeys(t, ['workflowId', 'path', 'branch', 'role']); requireValue(positive(t.workflowId) && WORKFLOW_PATH.test(t.path) && WORKFLOW_ROLES.includes(t.role), 'Invalid workflow target'); boundedString(t.branch, 100); },
  environment: t => { exactKeys(t, ['name']); requireValue(ENVIRONMENT.test(t.name), 'Invalid environment target'); },
  releases: t => { exactKeys(t, ['max']); requireValue(Number.isSafeInteger(t.max) && t.max >= 0 && t.max <= 10, 'Invalid release target'); },
};
const evidence = {
  workflow: v => { exactKeys(v, ['runId', 'runAttempt', 'headSha', 'status', 'conclusion']); requireValue(positive(v.runId) && positive(v.runAttempt) && SHA.test(v.headSha), 'Invalid run identity'); slug(v.status); maybe(v.conclusion, slug); },
  environment: v => { exactKeys(v, ['deploymentId', 'sha', 'environment', 'createdAt', 'status']); requireValue(positive(v.deploymentId) && SHA.test(v.sha) && ENVIRONMENT.test(v.environment), 'Invalid deployment identity'); stamp(v.createdAt); maybe(v.status, slug); },
  releases: v => {
    exactKeys(v, ['releases']); requireValue(list(v.releases, 10).length > 0, 'Empty release evidence');
    for (const r of v.releases) { exactKeys(r, ['id', 'tag', 'prerelease', 'publishedAt']); requireValue(positive(r.id) && typeof r.prerelease === 'boolean', 'Invalid release'); boundedString(r.tag, 160); stamp(r.publishedAt); }
  },
};
function reading(r, kind) {
  requireValue(GITHUB_STATES.includes(r.state), 'Unknown evidence state'); slug(r.reason);
  if (!READ.includes(r.state)) return requireValue(r.observedAt === null && r.sourceTime === null && r.evidence === null, 'An unread item cannot carry evidence');
  requireValue((r.state === 'observed') === (kind === 'releases') || r.state === 'missing', 'State does not fit this evidence kind');
  // A 404 is missing without an observation of the item; a read that returned nothing matching is missing with one.
  if (r.state === 'missing') { maybe(r.observedAt, stamp); return requireValue(r.sourceTime === null && r.evidence === null, 'Missing evidence cannot carry a reading'); }
  stamp(r.observedAt);
  stamp(r.sourceTime); evidence[kind](r.evidence);
}
function item(i, kind, configuration) {
  exactKeys(i, ITEM); targets[kind](i.target);
  requireValue(typeof i.truncated === 'boolean' && (configuration !== 'no-token' || i.state === 'unconfigured'), 'Invalid evidence item');
  maybe(i.resetAt, stamp); requireValue(i.state !== 'rate-limited' || i.resetAt !== null, 'Rate limit without a reset time');
  if (i.state !== 'stale') { requireValue(i.lastKnown === null, 'Only stale items carry last-known evidence'); return reading(i, kind); }
  slug(i.reason);
  requireValue(i.observedAt === null && i.sourceTime === null && i.evidence === null, 'Stale evidence cannot look current');
  exactKeys(i.lastKnown, ['state', 'reason', 'observedAt', 'sourceTime', 'evidence']);
  requireValue(READ.includes(i.lastKnown.state), 'Invalid last-known state'); reading(i.lastKnown, kind);
}
/** Validate every field the desk reads before it replaces anything in tab memory. */
export function assertGithubEvidence(x) {
  exactKeys(x, ['schema', 'mode', 'generatedAt', 'project', 'configuration', 'mapping', 'rules', 'repositories', 'limitations']);
  requireValue(x.schema === GITHUB_SCHEMA && ['live', 'demo'].includes(x.mode) && x.rules === GITHUB_RULES
    && ['unmapped', 'no-token', 'ready'].includes(x.configuration) && typeof x.project === 'string' && /^[a-z0-9-]{1,64}$/.test(x.project), 'Unexpected GitHub evidence contract');
  stamp(x.generatedAt); exactKeys(x.mapping, ['schema', 'revision', 'reviewedAt']);
  requireValue(x.mapping.schema === 'pulseboard.github-map/1' && positive(x.mapping.revision) && /^\d{4}-\d\d-\d\d$/.test(x.mapping.reviewedAt), 'Invalid mapping provenance');
  list(x.limitations, 8).forEach(text => boundedString(text, 500));
  const repositories = list(x.repositories, 4);
  requireValue((x.configuration === 'unmapped') === (repositories.length === 0), 'Configuration and repositories disagree');
  for (const r of repositories) {
    exactKeys(r, ['repositoryId', 'repository', 'renamed', 'state', 'reason', 'observedAt', 'workflows', 'environments', 'releases']);
    requireValue(positive(r.repositoryId) && REPOSITORY.test(r.repository) && ['observed', 'unconfigured', 'missing', 'rate-limited', 'unavailable'].includes(r.state), 'Invalid repository');
    slug(r.reason); requireValue((r.state === 'observed') === (r.observedAt !== null), 'Repository observation time mismatch'); maybe(r.observedAt, stamp);
    if (r.renamed !== null) { exactKeys(r.renamed, ['mapped', 'observed']); requireValue(r.renamed.mapped === r.repository && REPOSITORY.test(r.renamed.observed) && r.renamed.observed !== r.repository, 'Invalid rename'); }
    list(r.workflows, 4).forEach(i => item(i, 'workflow', x.configuration));
    list(r.environments, 2).forEach(i => item(i, 'environment', x.configuration));
    item(r.releases, 'releases', x.configuration);
  }
  return x;
}
/** A deployment within a day before an opened monitor, or inside its failure window, is a lead to check. Nothing more. */
export function deploymentLeads(evidence, snapshot) {
  const monitor = snapshot?.projects?.find(p => p.id === evidence.project)?.monitor || {};
  const opened = Number.isFinite(monitor.opened) ? monitor.opened : null;
  return evidence.repositories.flatMap(r => r.environments.filter(i => i.evidence).map(({ target, evidence: d }) => {
    const relation = opened === null ? null : d.createdAt <= opened && opened - d.createdAt <= DAY ? 'before-monitor-opened'
      : monitor.state === 'down' && d.createdAt > opened && d.createdAt <= monitor.checked ? 'inside-failure-window' : null;
    return { kind: relation ? 'lead' : 'context', relation, repository: r.repository, environment: target.name, deploymentId: d.deploymentId,
      sha: d.sha, deployedAt: d.createdAt, text: relation ? 'Temporal proximity, not a cause.' : 'No overlap with an opened monitor in this snapshot.' };
  })).sort((a, b) => (a.kind === 'lead' ? 0 : 1) - (b.kind === 'lead' ? 0 : 1) || b.deployedAt - a.deployedAt);
}
export const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const NOTE_RETENTION = 'Tab memory only. Cleared on disconnect and on pagehide. Nothing is stored on the server.';
/** A frozen copy: later refreshes cannot rewrite what the operator was looking at. */
export function pinInvestigation(snapshot, evidence, projectId, now = Date.now()) {
  assertGithubEvidence(evidence);
  const p = snapshot?.projects?.find(x => x.id === projectId);
  requireValue(p && evidence.project === projectId && Number.isSafeInteger(now), 'Evidence and snapshot must describe the same project');
  requireValue((snapshot.mode === 'demo') === (evidence.mode === 'demo'), 'Synthetic and live evidence cannot share a note');
  return deepFreeze(structuredClone({ schema: 'pulseboard.investigation/1', mode: evidence.mode, project: projectId, pinnedAt: now,
    rules: { desk: RULE_VERSION, github: GITHUB_RULES }, mapping: evidence.mapping,
    snapshot: { generatedAt: snapshot.generatedAt, window: snapshot.window, fingerprint: fingerprint(snapshot), monitor: p.monitor, totals: p.totals },
    evidence, leads: deploymentLeads(evidence, snapshot) }));
}
const note = value => safeFindingText(typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);
export function makeReleaseNote(pin, input, now = Date.now()) {
  requireValue(pin?.schema === 'pulseboard.investigation/1' && Object.isFrozen(pin) && Object.isFrozen(pin.evidence), 'Pin the evidence first');
  exactKeys(input, ['suspected', 'alternativeCheck']);
  return { schema: 'pulseboard.release-note/1', mode: pin.mode, project: pin.project, pinnedAt: pin.pinnedAt, writtenAt: now,
    rules: pin.rules, mapping: pin.mapping, snapshot: { generatedAt: pin.snapshot.generatedAt, fingerprint: pin.snapshot.fingerprint },
    status: 'lead, not proof', suspected: note(input.suspected), alternativeCheck: note(input.alternativeCheck),
    leads: pin.leads, repositories: pin.evidence.repositories, retention: NOTE_RETENTION,
    boundaries: ['A lead, not proof. Check the alternative before acting.', 'No automatic task, rollback, deployment or page.', 'Review before sharing.'] };
}
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : 'not observed';
export function releaseNoteMarkdown(n) {
  const line = (r, kind, i) => {
    const v = i.state === 'stale' ? i.lastKnown : i, id = v.evidence?.runId ? `run ${v.evidence.runId} attempt ${v.evidence.runAttempt} ${v.evidence.headSha}`
      : v.evidence?.sha ? `deployment ${v.evidence.deploymentId} ${v.evidence.sha}` : v.evidence?.releases?.map(x => x.tag).join(', ') || 'no identity';
    const name = kind === 'workflow' ? `${i.target.path} @ ${i.target.branch}` : kind === 'environment' ? `environment ${i.target.name}` : 'releases';
    return `- ${r.repository} ${name}: ${i.state}${i.state === 'stale' ? ` (last known ${v.state})` : ''}, ${i.reason}. Source ${iso(v.sourceTime)}, observed ${iso(v.observedAt)}. ${id}`;
  };
  return [`# Release note: a lead, not proof`, '', ...(n.mode === 'demo' ? ['SYNTHETIC DEMO. Every repository, run and deployment is invented.', ''] : []),
    `Project ${n.project}. Pinned ${iso(n.pinnedAt)}, written ${iso(n.writtenAt)}. Rules ${n.rules.desk}, ${n.rules.github}; mapping revision ${n.mapping.revision}; snapshot ${n.snapshot.fingerprint} from ${iso(n.snapshot.generatedAt)}.`,
    '', '## Suspected', n.suspected, '', '## Alternative check', n.alternativeCheck, '', '## Deployment leads',
    ...(n.leads.length ? n.leads.map(l => `- ${l.kind}: ${l.environment} ${l.sha} at ${iso(l.deployedAt)}. ${l.text}`) : ['- None in this pin.']),
    '', '## Evidence', ...n.repositories.flatMap(r => [...r.workflows.map(i => line(r, 'workflow', i)), ...r.environments.map(i => line(r, 'environment', i)), line(r, 'releases', r.releases)]),
    '', '## Retention', n.retention, '', ...n.boundaries.map(b => `- ${b}`), ''].join('\n');
}
