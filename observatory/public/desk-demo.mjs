/** Deterministic invented scenarios. Never written to the collector or presented as production evidence. */
import { DAY, fraction } from './desk-model.mjs';
import { PRODUCT_SCHEMA, PRODUCT_EVENTS_SCHEMA, PRODUCT_WINDOWS, PRODUCT_EVENTS_LIMIT, rankQuantile } from './desk-product.mjs';
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

/** SYNTHETIC product events: one seeded pool per (project, window, now), so the summary and every explorer read agree.
 *  Invented sessions, puzzles and errors; the pool lives in this tab and is never sent anywhere. */
function productPool(project, days, now) {
  if (!PRODUCT_WINDOWS.includes(days) || !/^[a-z0-9-]{1,64}$/.test(project) || !Number.isSafeInteger(now)) throw new RangeError('Unknown demo setting');
  let seed = [...`${project}|${days}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = xs => xs[Math.floor(rand() * xs.length)];
  const hex = k => Array.from({ length: k }, () => Math.floor(rand() * 16).toString(16)).join('');
  const alibi = project === 'alibi', endDay = new Date(now).toISOString().slice(0, 10), start = Date.parse(endDay) - (days - 1) * DAY;
  const places = [['GB', 'GB-ENG'], ['GB', 'GB-SCT'], ['RO', 'RO-B'], ['MD', 'MD-CU'], ['US', 'US-CA'], ['unknown', 'unknown']];
  const puzzles = [['castle-1', 0.9], ['castle-2', 0.75], ['castle-3', 0.45], ['quiet-wing-1', 0.8], ['quiet-wing-2', 0.35], ['library-4', 0.6]];
  const actions = ['action.requested', 'settings.opened', 'export.created', 'search.used'];
  const out = [], sessionCount = Math.min(360, 8 + days * 12);
  for (let s = 0; s < sessionCount; s++) {
    const session = `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
    const [country, region] = pick(places), context = { country, region, browser: pick(['chrome', 'firefox', 'safari', 'edge']),
      os: pick(['windows', 'macos', 'android', 'ios', 'linux']), device: pick(['desktop', 'desktop', 'mobile', 'tablet']) };
    const release = rand() < 0.8 ? (alibi ? '0.13.0' : '1.4.0') : (alibi ? '0.12.0' : '1.3.2');
    let at = start + Math.floor(rand() * Math.max(1, now - start - 3_600_000)), ms = 400 + Math.floor(rand() * 3000), seq = 0;
    const push = (name, route, props, withSession = true) => {
      at += 1000 + Math.floor(rand() * 40_000); ms += 1000 + Math.floor(rand() * 40_000);
      const received = Math.min(at, now);
      out.push({ received, day: new Date(received).toISOString().slice(0, 10), session: withSession ? session : null, seq: ++seq,
        name, route, release, ms: Math.min(ms, 86_400_000), props, redacted: 0, ...context });
    };
    push('app.opened', 'home', { entry: pick(['direct', 'link', 'bookmark']), returning: rand() < 0.6 });
    if (alibi) for (let k = 0, games = 1 + Math.floor(rand() * 2); k < games; k++) {
      const [puzzle, ease] = pick(puzzles), hints = Math.floor(rand() * (3 - ease * 2) + 0.2);
      push('puzzle.started', 'puzzle', { puzzle });
      for (let h = 0; h < hints; h++) push('hint.requested', 'puzzle', { puzzle });
      const roll = rand(), attempts = 1 + Math.floor(rand() * 3);
      if (roll < ease) push('puzzle.completed', 'puzzle', { puzzle, seconds: Math.round(60 + (1 - ease) * 400 + rand() * 240), hints, attempts });
      else if (roll < ease + 0.12) push('puzzle.failed', 'puzzle', { puzzle, attempts });
    }
    else for (let k = 0, steps = 1 + Math.floor(rand() * 4); k < steps; k++) push(pick(actions), 'workspace', { panel: pick(['editor', 'preview', 'files']), items: Math.floor(rand() * 40), meta: { theme: pick(['dark', 'light']) } });
    if (rand() < 0.5) push('page.engaged', alibi ? 'puzzle' : 'workspace', { seconds: Math.round(20 + rand() * 900), scroll: Math.round(rand() * 100) });
    for (const metric of ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']) if (rand() < 0.7) {
      const value = metric === 'CLS' ? Math.round(rand() * rand() * 3000) / 10000 : Math.round({ LCP: 1400, INP: 90, FCP: 900, TTFB: 250 }[metric] * (0.5 + rand() * (alibi && metric === 'INP' ? 5 : 2.2)));
      push('web.vital', pick(alibi ? ['home', 'puzzle'] : ['home', 'workspace']), { metric, value, rating: 'good' }, false);
    }
    if (rand() < 0.08) push('js.error', alibi ? 'puzzle' : 'workspace', pick([{ kind: 'TypeError', message: "Cannot read properties of undefined (reading 'clue')", source: 'board.js', line: 212 },
      { kind: 'NetworkError', message: 'Failed to fetch', source: 'sync.js', line: 40 }]), false);
  }
  return out.sort((a, b) => b.received - a.received);
}
const byKey = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); if (m.has(k)) m.get(k).push(x); else m.set(k, [x]); } return m; };
const demoWindow = (days, now) => { const endDay = new Date(now).toISOString().slice(0, 10);
  return { startDay: new Date(Date.parse(endDay) - (days - 1) * DAY).toISOString().slice(0, 10), endDay, days, timezone: 'UTC', partialToday: true }; };
const counted = (xs, key, label) => [...byKey(xs, key)].map(([value, rows]) => ({ [label]: value, n: rows.length })).sort((a, b) => b.n - a.n || String(a[label]).localeCompare(String(b[label])));
/** A deterministic pulseboard.product/1 summary of the demo pool, computed the way the plan specifies (raw-value p75, never averaged). */
export function makeProductDemo(days = 7, now = Date.now(), project = 'alibi') {
  const pool = productPool(project, days, now), sessions = [...byKey(pool.filter(x => x.session), x => x.session).values()].map(xs => xs.sort((a, b) => a.seq - b.seq));
  const lengths = sessions.map(xs => xs.length).sort((a, b) => a - b), durations = sessions.map(xs => xs.at(-1).ms - xs[0].ms).sort((a, b) => a - b);
  return { schema: PRODUCT_SCHEMA, project, generatedAt: now, mode: 'demo', window: demoWindow(days, now), collectionAdmitted: true,
    population: 'synthetic product events', limitations: ['SYNTHETIC. Invented sessions and events for exploring the view; not your production data.',
      'Journeys are the latest 100 sessions. A session is one browser tab, not a person.'],
    total: pool.length,
    totals: { names: counted(pool, x => x.name, 'name'), routes: counted(pool, x => x.route, 'route'), releases: counted(pool, x => x.release, 'release'),
      days: counted(pool, x => x.day, 'day').sort((a, b) => a.day.localeCompare(b.day)), truncated: { names: false, routes: false, releases: false } },
    sessions: { n: sessions.length, medianEvents: rankQuantile(lengths, 0.5), medianDurationMs: rankQuantile(durations, 0.5) },
    journeys: sessions.sort((a, b) => b[0].received - a[0].received).slice(0, 100)
      .map(xs => ({ session: xs[0].session, startedAt: xs[0].received, durationMs: xs.at(-1).ms - xs[0].ms, steps: xs.slice(0, 60).map(x => x.name), stepsTruncated: xs.length > 60 })),
    exits: counted(sessions.map(xs => xs.at(-1)), x => x.name, 'name'),
    vitals: [...byKey(pool.filter(x => x.name === 'web.vital'), x => `${x.props.metric}|${x.route}`)].map(([key, xs]) => {
      const [metric, route] = key.split('|'), values = xs.map(x => x.props.value).sort((a, b) => a - b);
      return { metric, route, p75: rankQuantile(values, 0.75), n: values.length };
    }).sort((a, b) => a.metric.localeCompare(b.metric) || a.route.localeCompare(b.route)),
    errors: [...byKey(pool.filter(x => x.name === 'js.error'), x => `${x.props.kind}|${x.props.message}`).values()]
      .map(xs => ({ kind: xs[0].props.kind, message: xs[0].props.message, n: xs.length, lastSeen: Math.max(...xs.map(x => x.received)) })).sort((a, b) => b.n - a.n) };
}
/** The explorer's raw read over the same pool: newest first, one event name, bounded by limit. */
export function makeProductEventsDemo(days, now, project, name, limit = 1000) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRODUCT_EVENTS_LIMIT) throw new RangeError('Unknown demo setting');
  const matched = productPool(project, days, now).filter(x => x.name === name);
  return { schema: PRODUCT_EVENTS_SCHEMA, project, generatedAt: now, mode: 'demo', window: demoWindow(days, now), name, limit,
    truncated: matched.length > limit, events: matched.slice(0, limit) };
}
