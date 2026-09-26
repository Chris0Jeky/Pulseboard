import { DAY, sum, count, percent, fraction, monitorState, monitorDisplay, buildSignals, compareReleases, reviewState, makeBrief, makeHandoff } from './desk-model.mjs';
import { makeDemo, makeGithubDemo, SCENARIOS } from './desk-demo.mjs';
import { BRIDGE_MAX_BYTES, parseBridge, makePublicPulse, readLimitedJson, assertPortfolio } from './desk-bridge.mjs';
import { READ_TIMEOUT_MS, requestPortfolio } from './desk-network.mjs';
import { requestStatistics, assertStatistics, usageReading, usageQuestions, makeStatisticsDemo, STATISTICS_MAX_BYTES } from './desk-usage.mjs';
import { assertGithubEvidence, deploymentLeads, pinInvestigation, makeReleaseNote, releaseNoteMarkdown } from './desk-release.mjs';

const $ = selector => document.querySelector(selector);
/** One visible-tab poll interval, named once: it sets the collector read multiplier documented in docs/ENGINEERING.md. */
const REFRESH_MS = 30_000;
const state = { snapshot: null, token: '', days: 7, scenario: 'release', phase: 1, query: '', sort: 'attention',
  view: 'overview', reviewed: false, reviews: {}, releaseProject: '', baseline: '', candidate: '',
  stale: false, busy: false, epoch: 0, controller: null, timer: null, export: null, error: '', imported: {}, pendingImport: null, publicSelection: [], github: {}, pin: null, usage: null, usageError: '', usageRead: null };
const views = {
  overview: ['The desk.', 'A clear place to see what needs you.'],
  signals: ['Signal inbox.', 'Observations you can inspect, park, or turn into a next step.'],
  releases: ['Release lab.', 'Compare what changed. Be careful about why.'],
  connections: ['Connections.', 'Small contracts between useful tools. No surprise data routes.'],
  usage: ['Usage.', 'How your sites are used: aggregate counts, never people.'],
};
const labels = { up: 'Probe up', down: 'Probe down', stale: 'Stale probe', unknown: 'No probe evidence', local: 'Local boundary' };
const e = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children.flat(Infinity)) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
const button = (label, action, className = '') => e('button', { type: 'button', class: className, onClick: action }, label);
const date = value => Number.isFinite(value) ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Not observed';
const relative = value => {
  if (!Number.isFinite(value)) return 'No reading';
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
const matches = p => `${p.label} ${p.id}`.toLowerCase().includes(state.query);
/** Every export warning starts here, so an invented snapshot stays labelled whichever exporter wrote the preview. */
const demoPrefix = () => state.snapshot?.mode === 'demo' ? 'SYNTHETIC DEMO. ' : '';
const signalSet = () => state.snapshot ? buildSignals(state.snapshot, Date.now(), state.stale) : [];
const signals = () => signalSet().filter(s => !state.query || `${s.label} ${s.title} ${s.rule}`.toLowerCase().includes(state.query));
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 4500); }
function showDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function empty(title, detail, action = null) { return e('section', { class: 'empty' }, e('div', { class: 'empty-mark', 'aria-hidden': true }, '⌁'), e('h2', {}, title), e('p', {}, detail), action); }
function stat(title, value, note, accent = '') { return e('article', { class: 'stat' }, e('div', { class: 'stat-title' }, title), e('strong', { class: `stat-value ${accent}` }, value), e('div', { class: 'stat-note' }, note)); }
/** A failed refresh makes the reading unknown; it never erases a last-known failure or invents a probe claim. */
function chip(p) {
  const failedRefresh = state.stale && state.snapshot?.mode === 'live';
  const display = monitorDisplay(p, Date.now(), failedRefresh);
  if (display.lastKnown) {
    const age = display.freshness === 'stale' ? ' · old reading' : '';
    return e('span', { class: 'state-chip down last-known' }, `${labels.down} · last known${age}`);
  }
  return failedRefresh && p.probeExpected ? e('span', { class: 'state-chip stale' }, 'Reading unknown')
    : e('span', { class: `state-chip ${display.state}` }, labels[display.state]);
}
function panel(title, body, action = null) { return e('section', { class: 'panel' }, e('div', { class: 'panel-top' }, e('h2', {}, title), action), body); }
function table(headers, rows) { return e('table', {}, e('thead', {}, e('tr', {}, headers.map(text => e('th', { scope: 'col' }, text)))), e('tbody', {}, rows.map(row => e('tr', {}, row.map(cell => e('td', {}, cell)))))); }
function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pulseboard.desk.reviews') || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      state.reviews = Object.fromEntries(Object.entries(saved).slice(-500).filter(([key, value]) => key.length < 160 && value
        && ['acknowledged', 'snoozed'].includes(value.state) && Number.isFinite(value.until) && value.until > Date.now()));
    }
    if (localStorage.getItem('pulseboard.desk.density') === 'compact') document.body.dataset.density = 'compact';
  } catch { /* Restricted storage is a supported mode. */ }
}
function review(signal, kind) {
  state.reviews[signal.key] = { state: kind, until: Date.now() + (kind === 'snoozed' ? 3600_000 : 7 * DAY) };
  state.reviews = Object.fromEntries(Object.entries(state.reviews).filter(([, r]) => r.until > Date.now()).slice(-500));
  try { localStorage.setItem('pulseboard.desk.reviews', JSON.stringify(state.reviews)); } catch { notify('Review kept in memory; browser storage is unavailable.'); }
  render(); notify(kind === 'snoozed' ? 'Snoozed for one hour on this browser.' : 'Reviewed on this browser. Changed evidence will resurface.');
}
function signalCard(signal, compact = false) {
  const status = reviewState(signal, state.reviews);
  return e('article', { class: `signal ${signal.severity}` }, e('div', { class: 'signal-header' }, e('span', { class: 'severity-mark', 'aria-hidden': true }),
    e('div', {}, e('h3', {}, signal.title), !compact ? e('div', { class: 'subline' }, `${signal.severity.toUpperCase()} / ${signal.rule} / ${signal.version}`) : null,
      e('p', {}, compact ? signal.next : signal.detail))),
    e('div', { class: 'signal-actions' }, button('See evidence ↗', () => signalDetail(signal)),
      status === 'open' ? button('Review', () => review(signal, 'acknowledged')) : e('span', { class: 'state-label' }, status),
      status === 'open' ? button('Snooze 1h', () => review(signal, 'snoozed')) : null));
}
function signalDetail(signal) {
  const evidenceSnapshot = state.snapshot, evidenceStale = state.stale;
  $('#detail').replaceChildren(e('h2', { id: 'detail-title' }, signal.title), e('p', { class: 'muted' }, signal.detail),
    e('div', { class: 'subline' }, `${signal.severity.toUpperCase()} / ${signal.rule} / ${signal.version}`),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'The evidence'), e('pre', { class: 'code-evidence', tabindex: '0' }, JSON.stringify(signal.evidence, null, 2))),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'A sensible next check'), e('p', {}, signal.next),
      button('Prepare a task handoff ↗', () => {
        $('#detail-dialog').close();
        preview(JSON.stringify(makeHandoff(evidenceSnapshot, signal, evidenceStale), null, 2), `pulseboard-${evidenceSnapshot.mode}-handoff.json`, 'application/json');
      }, 'primary')),
    e('p', { class: 'tiny muted' }, 'Rules are deterministic. A signal is an observation to inspect, not a diagnosis, productivity score, or instruction to deploy.'));
  showDialog('#detail-dialog');
}
function chart(projects, mini = false) {
  const { start, end } = state.snapshot.window;
  const days = Array.from({ length: Math.ceil(end / DAY) - Math.floor(start / DAY) }, (_, i) => Math.floor(start / DAY) + i);
  const totals = days.map(day => sum(projects, p => p.daily.find(d => d.day === day)?.n || 0));
  if (mini) {
    const max = Math.max(1, ...totals), points = totals.map((n, i) => `${i * 88 / Math.max(1, days.length - 1)},${22 - n / max * 19}`).join(' ');
    return svg('svg', { viewBox: '0 0 90 25', class: 'spark', role: 'img', 'aria-label': `Admitted events by UTC day: ${totals.join(', ')}` }, svg('polyline', { points, class: 'spark-line' }));
  }
  const width = 680, left = 38, right = 8, plot = width - left - right, max = Math.max(1, ...totals);
  const image = svg('svg', { viewBox: `0 0 ${width} 190`, class: 'chart', role: 'img', 'aria-label': `Admitted event counts by UTC day. ${sum(totals)} events. The first and last calendar days can be partial.` });
  for (const ratio of [0, 0.5, 1]) {
    const y = 148 - ratio * 126;
    image.append(svg('line', { x1: left, x2: width - right, y1: y, y2: y, class: 'chart-grid' }), svg('text', { x: left - 7, y: y + 4, 'text-anchor': 'end', class: 'chart-text' }, count(Math.round(max * ratio))));
  }
  totals.forEach((n, i) => {
    const x = left + i * plot / days.length + 5, height = n / max * 126;
    image.append(svg('rect', { x, y: 148 - height, width: Math.max(1, plot / days.length - 10), height, rx: 2, class: 'chart-bar' }, svg('title', {}, `${new Date(days[i] * DAY).toISOString().slice(0, 10)}: ${count(n)} admitted events`)));
    if (days.length <= 9 || i % 2 === 0) image.append(svg('text', { x: x + (plot / days.length - 10) / 2, y: 175, 'text-anchor': 'middle', class: 'chart-text' }, new Date(days[i] * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })));
  });
  return e('div', {}, image, e('div', { class: 'chart-caption' }, e('span', {}, 'Admitted events · all projects'), e('span', {}, 'UTC · edge days may be partial')),
    e('details', { class: 'chart-data' }, e('summary', {}, 'Inspect daily counts'), table(['UTC date', 'Admitted events'], days.map((day, i) => [new Date(day * DAY).toISOString().slice(0, 10), count(totals[i])]))));
}
function projectTable() {
  const ss = signalSet();
  const priority = p => sum(ss.filter(s => s.project === p.id), s => s.severity === 'critical' ? 100 : s.severity === 'warning' ? 10 : 1);
  const projects = state.snapshot.projects.filter(matches).sort((a, b) => state.sort === 'name' ? a.label.localeCompare(b.label)
    : state.sort === 'events' ? b.totals.events - a.totals.events || a.label.localeCompare(b.label)
      : priority(b) - priority(a) || a.label.localeCompare(b.label));
  const headerButton = (text, sort) => button(text + (state.sort === sort ? ' ↓' : ''), () => { state.sort = sort; render(); });
  const content = e('table', {}, e('thead', {}, e('tr', {},
    e('th', { scope: 'col', 'aria-sort': state.sort === 'name' ? 'ascending' : 'none' }, headerButton('PROJECT', 'name')),
    e('th', { scope: 'col', 'aria-sort': state.sort === 'attention' ? 'descending' : 'none' }, headerButton('PROBE / BOUNDARY', 'attention')),
    e('th', { scope: 'col', class: 'right', 'aria-sort': state.sort === 'events' ? 'descending' : 'none' }, headerButton('EVENTS', 'events')),
    e('th', { scope: 'col', class: 'right' }, 'SESSIONS'), e('th', { scope: 'col', class: 'right' }, 'OUTCOMES'), e('th', { scope: 'col', class: 'right' }, 'DAILY ALLOWANCE'))),
    e('tbody', {}, projects.map(p => e('tr', {},
      e('td', {}, e('div', { class: 'project-name' }, e('span', { class: 'project-glyph', 'aria-hidden': true }, p.label.slice(0, 2).toUpperCase()), e('div', {}, button(p.label, () => projectDetail(p)), e('small', {}, p.probeExpected ? relative(p.totals.last) : 'No external probe by design')))),
      e('td', {}, chip(p), e('div', { class: 'tiny muted' }, p.collectionEligible ? (p.collectionAdmitted ? 'Collection admitted' : 'Collection not admitted') : 'Local-only; no browser collection')), e('td', { class: 'right mono' }, count(p.totals.events), chart([p], true)),
      e('td', { class: 'right mono' }, count(p.totals.sessions)),
      e('td', { class: 'right' }, e('span', { class: 'mono' }, percent(fraction(p.totals.completed, p.totals.completed + p.totals.failed).value)), e('div', { class: 'tiny muted' }, `${count(p.totals.completed + p.totals.failed)} reported`)),
      e('td', { class: 'right' }, e('span', { class: 'mono' }, `${count(p.budget.used)} / ${count(p.budget.limit)}`), e('meter', { class: 'budget-meter', min: 0, max: Math.max(1, p.budget.limit), value: p.budget.used, 'aria-label': `${p.label}: ${p.budget.used} of ${p.budget.limit} daily admission units used` }))))));
  return e('section', {}, e('div', { class: 'section-heading' }, e('h2', {}, 'Project register'), e('p', {}, `${projects.length} shown · success / reported outcomes · no cross-project identity`)),
    projects.length ? e('div', { class: 'table-shell', tabindex: '0', role: 'region', 'aria-label': 'Project register; scroll horizontally on small screens' }, content) : empty('No matches.', 'Try another project name or clear the search.'));
}
function overview() {
  const s = state.snapshot, ps = s.projects, ss = signals(), open = ss.filter(signal => reviewState(signal, state.reviews) === 'open');
  const completed = sum(ps, p => p.totals.completed), outcomes = completed + sum(ps, p => p.totals.failed);
  return [e('section', { class: 'stats-grid', 'aria-label': 'Whole portfolio summary' },
    stat('Receiving evidence', `${ps.filter(p => p.totals.events > 0).length} / ${ps.length}`, 'Projects with admitted browser events', 'lime'),
    stat('Needs a look', count(signalSet().filter(x => x.severity !== 'note').length), 'Warnings and critical observations', 'orange'),
    stat('Reported sessions', count(sum(ps, p => p.totals.sessions)), 'Summed per project. Not unique people.'),
    stat('Completed outcomes', percent(fraction(completed, outcomes).value), `${count(outcomes)} reported action outcomes`)),
    e('div', { class: 'overview-grid' }, panel('What needs you', open.length ? e('div', {}, open.slice(0, 2).map(x => signalCard(x, true)))
      : e('p', { class: 'muted' }, 'No open observations in this view. Uninstrumented journeys still need checking.'), button('All signals →', () => navigate('signals'))),
      panel('The last few days', chart(ps), e('span', { class: 'mini-label' }, 'EVENT RECEIPTS'))), projectTable()];
}
function projectDetail(p) {
  // The drawer, its deployment leads and any pin all read the snapshot it opened with, not a later poll.
  state.drawerSnapshot = state.snapshot; state.drawerStale = state.stale;
  const outcomes = p.totals.completed + p.totals.failed;
  $('#detail').replaceChildren(e('h2', { id: 'detail-title' }, p.label), chip(p),
    e('div', { class: 'facts' }, ...[['Admitted events', count(p.totals.events)], ['Reported sessions', count(p.totals.sessions)],
      ['Completed / reported outcomes', `${p.totals.completed} / ${outcomes}`], ['Probe successes / samples', `${p.probeSamples.numerator} / ${p.probeSamples.denominator}`],
      ['Collection admission', p.collectionEligible ? (p.collectionAdmitted ? 'Admitted' : 'Not admitted') : 'Not eligible (local-only)']]
      .map(([label, value]) => e('div', { class: 'fact' }, e('span', {}, label), e('strong', {}, value)))),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Provenance'), e('p', { class: 'muted' }, `Snapshot: ${date(state.snapshot.generatedAt)}. Last probe: ${date(p.monitor.checked)}. Browser data is opt-in and client-reported. Probe data comes from the configured synthetic check.`)),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Paired flow'), e('p', {}, `${p.flow.numerator} completed of ${p.flow.denominator} started session / route / release groups (${percent(p.flow.value)}).`),
      e('p', { class: 'muted' }, 'A later completion must match the session, route and release. This is not a user retention metric or a named-action conversion funnel.')),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Route receipts'), e('div', { class: 'table-shell' }, table(['Allowed route', 'Events'], p.routes.map(r => [r.route, count(r.n)])))),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Release cohorts'), e('div', { class: 'table-shell' }, table(['Release', 'Outcomes', 'Failures', 'p95 duration'], p.releases.map(r => [r.release, count(r.completed + r.failed), count(r.failed), r.duration ? `${count(r.duration.p95)} ms · n=${r.duration.n}` : 'No samples']))),
      button('Open release comparison →', () => { state.releaseProject = p.id; state.baseline = ''; state.candidate = ''; $('#detail-dialog').close(); navigate('releases'); })),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Development evidence (GitHub)'), e('div', { id: 'github-evidence', 'data-project': p.id }, githubView(p.id))),
    e('section', { class: 'drawer-section' }, e('h3', {}, 'Reading limits'), e('ul', {}, state.snapshot.limitations.map(text => e('li', {}, text)))));
  showDialog('#detail-dialog');
}
const githubClass = { passing: 'up', observed: 'up', failing: 'down', stale: 'stale', 'rate-limited': 'stale' };
function githubRow(repository, kind, name, item) {
  const v = item.state === 'stale' ? item.lastKnown : item, x = v.evidence;
  const identity = x?.runId ? `run ${x.runId} #${x.runAttempt} · ${x.headSha.slice(0, 7)}` : x?.sha ? `deployment ${x.deploymentId} · ${x.sha.slice(0, 7)}` : x?.releases ? x.releases.map(r => r.tag).join(', ') : 'No identity';
  return [repository, `${kind}: ${name}`, e('span', { class: `state-chip ${githubClass[item.state] || 'unknown'}` }, `${item.state} · ${item.reason}`),
    item.state === 'stale' ? `last known ${v.state} · ${date(v.sourceTime)}` : date(item.sourceTime), identity];
}
/** Filled only by the button: never by the poll, never into signals or a public pulse. */
function githubView(id) {
  const ev = state.github[id], read = button('Read workflow evidence', () => readGithub(id), 'primary');
  if (!ev) return e('div', {}, e('p', { class: 'muted' }, 'Not read. Workflow, deployment and release evidence loads only when you ask, and stays out of signals and public exports.'), read);
  const rows = ev.repositories.flatMap(r => { const name = r.repository + (r.renamed ? ` (now ${r.renamed.observed})` : '');
    return [...r.workflows.map(i => githubRow(name, 'Workflow', `${i.target.path} @ ${i.target.branch}`, i)), ...r.environments.map(i => githubRow(name, 'Deployment', i.target.name, i)), githubRow(name, 'Releases', `latest ${r.releases.target.max}`, r.releases)]; });
  return e('div', {}, e('p', { class: 'tiny muted' }, `${ev.mode === 'demo' ? 'SYNTHETIC · ' : ''}${ev.configuration.toUpperCase()} · mapping r${ev.mapping.revision} · read ${date(ev.generatedAt)} · ${ev.rules}`),
    rows.length ? e('div', { class: 'table-shell' }, table(['Repository', 'Evidence', 'State', 'Source time', 'Identity'], rows))
      : e('p', { class: 'muted' }, 'No reviewed repository mapping for this project. Nothing was requested from GitHub.'),
    deploymentLeads(ev, state.drawerSnapshot ?? state.snapshot).map(l => e('p', { class: l.kind === 'lead' ? 'notice' : 'tiny muted' }, `${l.kind.toUpperCase()} · ${l.environment} ${l.sha.slice(0, 7)} deployed ${date(l.deployedAt)}. ${l.text}`)),
    e('ul', { class: 'tiny muted' }, ev.limitations.map(text => e('li', {}, text))), read, rows.length ? button('Pin to release notebook', () => pinGithub(id)) : null);
}
async function readGithub(id) {
  const epoch = state.epoch;
  try {
    let ev;
    if (state.snapshot?.mode === 'demo') ev = makeGithubDemo(state.snapshot, id);
    else {
      if (!state.token) throw new Error('Connect the collector first.');
      const response = await fetch(`/v1/github-evidence?project=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${state.token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(90_000) });
      if (epoch !== state.epoch) return;
      if (response.status === 401) { disconnect(); notify('Read token rejected. Private data and the token were cleared.'); return; }
      if (!response.ok) throw new Error('GitHub evidence is unavailable.');
      ev = await readLimitedJson(response, 65536);
    }
    if (epoch !== state.epoch) return;
    assertGithubEvidence(ev); if (ev.project !== id) throw new Error('Unexpected GitHub evidence project');
    state.github[id] = ev;
    const view = $('#github-evidence'); if (view?.dataset.project === id) view.replaceChildren(githubView(id));
  } catch (error) { if (epoch === state.epoch) notify(error.message || 'Could not read GitHub evidence.'); }
}
function pinGithub(id) {
  try {
    // A drawer opened on a failed refresh keeps that marker even if a later poll succeeds.
    if (state.drawerSnapshot ? state.drawerStale : state.stale) throw new Error('Refresh the collector and reopen the project before pinning.');
    state.pin = pinInvestigation(state.drawerSnapshot ?? state.snapshot, state.github[id], id);
  } catch (error) { notify(error.message); return; }
  $('#suspected').value = ''; $('#alternative-check').value = '';
  $('#notebook-summary').textContent = `${state.pin.mode === 'demo' ? 'SYNTHETIC DEMO. ' : ''}Pinned ${date(state.pin.pinnedAt)} · snapshot ${state.pin.snapshot.fingerprint} · mapping r${state.pin.mapping.revision} · ${state.pin.leads.filter(l => l.kind === 'lead').length} deployment lead(s). The pinned copy does not change on refresh.`;
  $('#detail-dialog').close(); showDialog('#notebook-dialog');
}
function inbox() {
  const ss = signals().filter(s => state.reviewed || reviewState(s, state.reviews) === 'open');
  return [e('div', { class: 'filter-row' }, e('p', { class: 'muted' }, `${ss.length} observations · deterministic rules · no automatic paging`),
    e('label', {}, e('input', { type: 'checkbox', checked: state.reviewed, onChange: event => { state.reviewed = event.target.checked; render(); } }), 'Include reviewed / snoozed')),
    ss.length ? e('section', { class: 'panel signal-list' }, ss.map(s => signalCard(s))) : empty('Inbox clear.', 'No open matching observations. Acknowledgements stay on this browser and changed evidence resurfaces.')];
}
function selectControl(label, id, options, value, change) {
  return e('label', { for: id }, label, e('select', { id, onChange: event => change(event.target.value) }, options.map(([val, text]) => e('option', { value: val, selected: val === value }, text))));
}
function releaseLab() {
  const ps = state.snapshot.projects.filter(matches);
  if (!ps.length) return empty('No matching project.', 'Clear the search to compare release cohorts.');
  const p = ps.find(p => p.id === state.releaseProject) || ps.find(p => p.releases.length >= 2) || ps[0];
  state.releaseProject = p.id;
  const releases = p.releases.filter(r => r.release !== 'unattributed');
  const candidate = releases.find(r => r.release === state.candidate) || releases[0];
  const baseline = releases.find(r => r.release === state.baseline) || releases.find(r => r.release !== candidate?.release);
  const options = releases.map(r => [r.release, r.release]);
  const controls = e('div', { class: 'comparison-selects' },
    selectControl('Project', 'release-project', ps.map(p => [p.id, p.label]), p.id, id => { state.releaseProject = id; state.baseline = ''; state.candidate = ''; render(); }),
    selectControl('Baseline cohort', 'release-baseline', options, baseline?.release, value => { state.baseline = value; render(); }),
    selectControl('Candidate cohort', 'release-candidate', options, candidate?.release, value => { state.candidate = value; render(); }));
  if (releases.length < 2) return [controls, empty('Give each release a name.', 'Comparison needs two attributed release cohorts inside this window. Register release labels in the collector and the client SDK; events labelled unattributed cannot tell this story.')];
  const result = compareReleases(baseline, candidate);
  if (!result.baseline) return [controls, e('div', { class: 'notice' }, result.reason)];
  const image = svg('svg', { class: 'interval-chart', viewBox: '0 0 700 160', role: 'img', 'aria-label': 'Reported failure proportions with descriptive 95% Wilson intervals. These are not a causal or significance test.' });
  for (const [i, cohort] of [result.baseline, result.candidate].entries()) {
    const y = 40 + i * 54, cls = i ? ' candidate' : '';
    image.append(svg('text', { x: 0, y: y + 4, class: 'chart-text' }, i ? 'CANDIDATE' : 'BASELINE'), svg('line', { x1: 120, x2: 674, y1: y, y2: y, class: 'chart-grid' }));
    if (cohort.interval) image.append(svg('line', { x1: 120 + cohort.interval[0] * 554, x2: 120 + cohort.interval[1] * 554, y1: y, y2: y, class: `interval-line${cls}` }), svg('circle', { cx: 120 + cohort.value * 554, cy: y, r: 4, class: `interval-point${cls}` }));
  }
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) image.append(svg('text', { x: 120 + tick * 554, y: 136, class: 'chart-text', 'text-anchor': 'middle' }, `${tick * 100}%`));
  return [controls, e('div', { class: 'comparison-stats' }, stat('Baseline: reported failures', percent(result.baseline.value), `${result.baseline.numerator} / ${result.baseline.denominator} outcomes`),
    stat('Candidate: reported failures', percent(result.candidate.value), `${result.candidate.numerator} / ${result.candidate.denominator} outcomes`, 'orange'),
    stat('Difference', result.delta === null ? 'Not enough data' : `${result.delta >= 0 ? '+' : ''}${(result.delta * 100).toFixed(1)} pp`, 'Candidate minus baseline; percentage points')),
    panel('The interval matters', e('div', {}, image, e('p', { class: 'tiny muted' }, '95% Wilson intervals are descriptive. Overlap is not used as a significance test.'))),
    e('div', { class: 'notice' }, result.reason),
    panel('Before calling it a regression', e('p', { class: 'muted' }, 'Check route mix, the time window, retries, instrumentation changes, and how much traffic each release saw. A deployment timestamp or a contribution spike cannot establish that a code change caused an outcome.'))];
}
function importControl(kind, label) {
  return e('label', { class: 'file-control' }, label, e('input', { id: `import-${kind}`, type: 'file', accept: '.json,application/json', onChange: async event => {
    const file = event.target.files?.[0], epoch = state.epoch; event.target.value = ''; if (!file) return;
    try {
      if (file.size > BRIDGE_MAX_BYTES) throw new Error('Choose a JSON file no larger than 256 KiB.');
      const context = parseBridge(await file.text());
      if (epoch !== state.epoch) return;
      if (context.kind !== kind) throw new Error('This file belongs to the other adapter.');
      state.pendingImport = context; $('#import-preview').textContent = JSON.stringify(context, null, 2); showDialog('#import-dialog');
    } catch (error) { if (epoch === state.epoch) notify(error.message || 'Unsupported context file.'); }
  } }));
}
function publicPulseForm() {
  if (!state.snapshot) return e('p', { class: 'muted' }, 'Load a snapshot before selecting a public pulse.');
  const eligible = state.snapshot.projects.filter(p => p.probeExpected);
  // A background refresh re-renders this view; the operator's selection is held in state so it survives.
  state.publicSelection = state.publicSelection.filter(id => eligible.some(p => p.id === id));
  const choices = e('div', { class: 'public-choices' }, eligible.map(p =>
    e('label', {}, e('input', { type: 'checkbox', value: p.id, name: 'public-project', checked: state.publicSelection.includes(p.id),
      onChange: event => { state.publicSelection = event.target.checked ? [...state.publicSelection, p.id] : state.publicSelection.filter(id => id !== p.id); } }), p.label)));
  return e('div', {}, choices, button('Preview public pulse', () => {
    try {
      const selected = [...choices.querySelectorAll('input:checked')].map(node => node.value);
      if (state.stale) throw new Error('Refresh the collector before preparing a public pulse.');
      const packet = makePublicPulse(state.snapshot, selected);
      preview(JSON.stringify(packet, null, 2), `pulseboard-${state.snapshot.mode}-public-pulse.json`, 'application/json');
      $('#export-warning').textContent = `${demoPrefix()}PUBLIC PULSE CANDIDATE. Only selected project IDs and synthetic probe aggregates are included. No usage counts or imported findings. Review before sharing; no CommitAtlas consumer is installed by this action.`;
    } catch (error) { notify(error.message); }
  }));
}
function importedContext() {
  return Object.values(state.imported).map(context => {
    const stale = Date.now() - context.generatedAt > DAY || context.generatedAt > Date.now();
    const detail = context.kind === 'commitatlas'
      ? e('div', { class: 'table-shell' }, table(['Repository', 'Lifecycle', 'Imported CI claim', 'Named workflow', 'Release supplied', 'Open issues + PRs'], context.projects.map(p =>
          [p.repo, p.lifecycle, p.ci.state, p.ci.workflow || 'Not configured', p.releaseTag || 'Not supplied', count(p.openIssuesAndPullRequests)])))
      : e('div', {}, e('p', { class: 'muted' }, `${context.mode.toUpperCase()} · ${context.coverage.observed} observed / ${context.coverage.eligible} eligible · ${context.coverage.censored} censored · ${context.coverage.missing} missing`),
          ...context.findings.map(finding => e('article', { class: 'lens-finding' }, e('span', { class: 'mini-label' }, `${finding.kind.toUpperCase()} / n=${finding.n}`), e('h3', {}, finding.title), e('p', {}, finding.detail), e('p', { class: 'tiny muted' }, finding.limitations.join(' ')))));
    return panel(context.kind === 'commitatlas' ? 'CommitAtlas context' : 'Developer Lens context', e('div', {},
      e('p', { class: 'tiny muted' }, `UNVERIFIED FILE · ${date(context.generatedAt)}${stale ? ' · OLD OR FUTURE-DATED ARTIFACT' : ''} · separate from telemetry`), detail,
      e('ul', { class: 'tiny muted' }, context.limitations.map(text => e('li', {}, text)))),
      button('Remove', () => { delete state.imported[context.kind]; render(); }));
  });
}
function connections() {
  const card = (badge, title, detail, action = null) => e('section', { class: 'panel connection-card' }, e('span', { class: 'badge' }, badge), e('h2', {}, title), e('p', {}, detail), action);
  return [e('div', { class: 'flow-map', 'aria-label': 'Observatory provides aggregates to Pulseboard; Pulseboard provides reviewed handoffs' },
    e('div', { class: 'flow-node' }, 'COLLECT', e('strong', {}, 'Observatory')), e('span', { class: 'flow-arrow', 'aria-hidden': true }, '→'),
    e('div', { class: 'flow-node' }, 'UNDERSTAND', e('strong', {}, 'Pulseboard')), e('span', { class: 'flow-arrow', 'aria-hidden': true }, '→'),
    e('div', { class: 'flow-node' }, 'REVIEW', e('strong', {}, 'Your next move'))),
    e('div', { class: 'connections-grid' },
      card('AVAILABLE', 'Observatory', 'Read aggregate product events, synthetic probe state and admission budgets from the same-origin protected API.', button('Connect collector', () => showDialog('#connect-dialog'))),
      card('REVIEW HANDOFF', 'Taskdeck / repository agent', 'Inspect a signal and prepare a small JSON task handoff. The file is a proposal; it does not create or execute tasks.', button('Open signal inbox', () => navigate('signals'))),
      card('NATIVE V2 FILE READER', 'CommitAtlas', 'Import the existing projects.json catalogue. Named-workflow CI, lifecycle and release context remain separate from availability. No URLs in the file are followed.', importControl('commitatlas', 'Review a projects.json file')),
      card('PROJECTION READER / PRODUCER PENDING', 'Developer Lens', 'Import a reviewed pulseboard.lens-projection/1 file. Observations, patterns, hypotheses, censoring and limitations stay intact. Native Lens export support is a follow-up.', importControl('developer-lens', 'Review a redacted projection')),
      card('SELECT / REVIEW / DOWNLOAD', 'Public pulse', 'Prepare an expiring, minimal probe capsule for a future CommitAtlas or status-card consumer. No usage counts, task contents or private findings are included.', publicPulseForm()),
      card('SEPARATE RUNTIME', 'Feed workbench', 'The original FastAPI / Vue dashboard remains available for system metrics, HTTP JSON and custom feeds. Run its existing scripts; it has not been silently migrated.'),
      card('EXTENSION SEAM', 'OpenTelemetry / specialist backends', 'Keep traces and high-volume metrics in suitable backends. A future bounded adapter can bring evidence and links into this desk. No OTLP receiver is claimed.')),
    ...importedContext()];
}
/** Read only while the Usage view is open: the 30 s portfolio poll pays for this read on this view alone. */
async function readUsage() {
  // Keyed by read epoch, so a read cancelled by a window change or disconnect cannot leave the view stuck busy.
  if (!state.token || state.usageRead === state.epoch) return;
  const epoch = state.epoch, days = state.days; state.usageRead = epoch;
  try {
    const response = await requestStatistics(fetch, { token: state.token, days, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (epoch !== state.epoch) return;
    if (response.status === 401) { disconnect(); notify('Read token rejected. Private data and the token were cleared.'); return; }
    if (!response.ok) throw new Error('Usage statistics are unavailable.');
    const data = assertStatistics(await readLimitedJson(response, STATISTICS_MAX_BYTES), days);
    if (epoch !== state.epoch || days !== state.days) return;
    state.usage = data; state.usageError = '';
  } catch (error) { if (epoch === state.epoch) state.usageError = error.message || 'Could not read usage statistics.'; }
  finally { if (state.usageRead === epoch) state.usageRead = null; if (epoch === state.epoch && state.view === 'usage') render(); }
}
const ratio = value => value === null ? '—' : value.toFixed(2);
function usageChart(reading) {
  const width = 680, left = 38, right = 8, plot = width - left - right, totals = reading.series.all, starts = reading.series.started, max = Math.max(1, ...totals);
  const slot = plot / Math.max(1, totals.length);
  const image = svg('svg', { viewBox: `0 0 ${width} 190`, class: 'chart', role: 'img', 'aria-label': `Aggregate Alibi counts by UTC day: ${totals.join(', ')}. Puzzle starts: ${starts.join(', ')}. Today is partial.` });
  for (const r of [0, 0.5, 1]) { const y = 148 - r * 126; image.append(svg('line', { x1: left, x2: width - right, y1: y, y2: y, class: 'chart-grid' }), svg('text', { x: left - 7, y: y + 4, 'text-anchor': 'end', class: 'chart-text' }, count(Math.round(max * r)))); }
  totals.forEach((n, i) => {
    const x = left + i * slot + 5, w = Math.max(1, slot - 10), h = n / max * 126, hs = starts[i] / max * 126;
    image.append(svg('rect', { x, y: 148 - h, width: w, height: h, rx: 2, class: 'chart-bar' }, svg('title', {}, `${reading.days[i]}: ${count(n)} counts, ${count(starts[i])} puzzle starts`)),
      svg('rect', { x: x + w * 0.3, y: 148 - hs, width: w * 0.4, height: hs, rx: 1, class: 'chart-bar-accent' }));
    if (totals.length <= 9 || i % 2 === 0) image.append(svg('text', { x: x + w / 2, y: 175, 'text-anchor': 'middle', class: 'chart-text' }, new Date(reading.days[i] + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })));
  });
  return e('div', {}, image, e('div', { class: 'chart-caption' }, e('span', {}, 'All counts · inner bar: puzzle starts'), e('span', {}, 'UTC · today is partial')),
    e('details', { class: 'chart-data' }, e('summary', {}, 'Inspect daily counts'), table(['UTC date', 'All counts', 'Page views', 'Puzzle starts', 'Completions'],
      reading.days.map((d, i) => [d, count(totals[i]), count(reading.series.views[i]), count(starts[i]), count(reading.series.completed[i])]))));
}
function share(rows, key, total) {
  if (!rows.length) return e('p', { class: 'muted' }, 'No counts in this window.');
  return e('div', { class: 'table-shell' }, table([key[0].toUpperCase() + key.slice(1), 'Counts', 'Share'], rows.map(r => [r[key], count(r.n),
    e('meter', { class: 'budget-meter', min: 0, max: Math.max(1, total), value: r.n, 'aria-label': `${r[key]}: ${r.n} of ${total}` })])));
}
function coverage() {
  const describe = p => p.id === 'alibi' && state.usage?.collectionAdmitted ? 'Aggregate counts, on by default with visitor opt-out'
    : !p.collectionEligible ? 'Local-only by design; no browser collection'
      : p.collectionAdmitted ? 'Opt-in session events only' : 'Not measured. Needs your go-ahead: notice review and host adapter';
  return panel('Coverage across your sites', e('div', { class: 'table-shell' }, table(['Site', 'Usage measurement', 'Opt-in events (window)', 'Reachability'],
    state.snapshot.projects.map(p => [p.label, describe(p), count(p.totals.events), chip(p)]))), e('span', { class: 'mini-label' }, 'WHAT IS MEASURED'));
}
function usageView() {
  const u = state.usage;
  if (!u) return [state.usageRead !== null || !state.usageError ? empty('Reading usage…', 'Fetching aggregate Alibi counts for this window.')
    : empty('Usage unavailable.', state.usageError, button('Try again', () => { readUsage(); render(); }, 'primary')), coverage()];
  const r = usageReading(u), qs = usageQuestions(u, r);
  const synthetic = u.mode === 'demo' ? 'SYNTHETIC · ' : '';
  return [e('p', { class: 'tiny muted' }, `${synthetic}Alibi · ${u.window.startDay} to ${u.window.endDay} UTC · ${u.population} · read ${date(u.generatedAt)}${state.usageError ? ' · last read failed, showing previous' : ''}`),
    e('section', { class: 'stats-grid', 'aria-label': 'Alibi usage summary' },
      stat('Page views', count(r.views), r.busiest ? `Busiest day ${r.busiest.day} (${count(r.busiest.n)} counts)` : 'No counts in this window', 'lime'),
      stat('Puzzle starts', count(r.started), `${count(r.failed)} reported failures`),
      stat('Completions per start', ratio(r.completedPerStart), `${count(r.completed)} completions. Two independent counts, not a per-player rate.`),
      stat('Hints per start', ratio(r.hintsPerStart), `${count(r.hints)} hint requests · ${count(r.errors)} app errors`, r.errors ? 'orange' : '')),
    e('div', { class: 'overview-grid' },
      panel('Questions worth asking', qs.length ? e('ul', {}, qs.map(q => e('li', { class: q.kind === 'boundary' ? 'notice' : '' }, q.text))) : e('p', { class: 'muted' }, 'Nothing stands out in these counts. That is not proof the experience is good; watch a real session.'), e('span', { class: 'mini-label' }, 'LEADS, NOT VERDICTS')),
      panel('Day by day', usageChart(r), e('span', { class: 'mini-label' }, 'AGGREGATE COUNTS'))),
    e('div', { class: 'overview-grid' },
      panel('Where activity happens', share(u.routes, 'route', u.total), e('span', { class: 'mini-label' }, 'ROUTE MIX')),
      panel('What people do', share(u.events, 'event', u.total), e('span', { class: 'mini-label' }, 'EVENT MIX'))),
    e('div', { class: 'overview-grid' },
      panel('Which build they run', share(u.releases, 'release', u.total), e('span', { class: 'mini-label' }, 'RELEASE MIX')),
      panel('Reading limits', e('ul', { class: 'tiny muted' }, u.limitations.map(text => e('li', {}, text))))),
    coverage()];
}
function render() {
  const focusId = document.activeElement?.id;
  const [title, subtitle] = views[state.view];
  $('#page-title').textContent = title; $('#page-subtitle').textContent = subtitle; $('#breadcrumb').textContent = state.view.toUpperCase();
  for (const link of document.querySelectorAll('nav a')) { if (link.dataset.view === state.view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  $('#signal-count').textContent = state.snapshot ? String(signalSet().filter(s => reviewState(s, state.reviews) === 'open').length) : '0';
  $('#density').textContent = document.body.dataset.density === 'compact' ? 'Comfortable view' : 'Compact view';
  $('#brief').disabled = !state.snapshot; $('#refresh').disabled = state.busy || (!state.token && !state.snapshot);
  $('#disconnect').hidden = !state.snapshot && !state.token && !Object.keys(state.imported).length; $('#demo-controls').hidden = state.snapshot?.mode !== 'demo';
  const mode = $('#mode'); mode.className = 'badge';
  if (!state.snapshot) { mode.textContent = state.busy ? 'CONNECTING' : 'NOT CONNECTED'; $('#message').textContent = state.busy ? 'Reading this origin’s protected API…' : state.error || 'Your desk is empty. No health claims until there is evidence.'; }
  else if (state.snapshot.mode === 'demo') { mode.textContent = 'SYNTHETIC DEMO'; mode.classList.add('demo'); $('#message').textContent = `${SCENARIOS[state.scenario]}. Invented observations, not your production numbers.`; }
  else { mode.textContent = state.stale ? 'STALE SNAPSHOT' : 'CONNECTED'; mode.classList.add(state.stale ? 'stale' : 'live'); $('#message').textContent = state.stale ? 'Refresh failed. The last successful snapshot is still shown; current health is unknown.' : `Protected aggregate read · collection ${state.snapshot.collectionEnabled ? 'enabled' : 'disabled'} · ${document.hidden ? 'refresh paused while hidden' : `refresh every ${REFRESH_MS / 1000}s`}.`; }
  $('#stamp').textContent = state.snapshot ? `READ ${date(state.snapshot.generatedAt)} · ${state.snapshot.window.days}D WINDOW` : 'No snapshot loaded';
  $('#replay-label').textContent = ['Before', 'Incident', 'Recovery'][state.phase];
  const view = $('#view');
  if (state.view === 'connections') view.replaceChildren(...connections());
  else if (!state.snapshot) view.replaceChildren(empty('Your projects have a story. Start with a reading.',
    'Connect the collector for real evidence, or explore a deterministic scenario. Nothing is collected by opening this page.',
    e('div', { class: 'onramp-actions' }, button('Explore the desk →', () => beginDemo(), 'primary'), button('Connect my data', () => showDialog('#connect-dialog')))));
  else { const content = state.view === 'overview' ? overview() : state.view === 'signals' ? inbox() : state.view === 'usage' ? usageView() : releaseLab(); view.replaceChildren(...(Array.isArray(content) ? content : [content])); }
  if (focusId && document.activeElement === document.body) document.getElementById(focusId)?.focus({ preventScroll: true });
}
function navigate(view) { if (!Object.hasOwn(views, view)) return; if (location.hash === '#' + view) { state.view = view; render(); } else location.hash = view; }
function cancelRead() { state.epoch++; clearTimeout(state.timer); state.controller?.abort(); state.controller = null; state.busy = false; }
function disconnect() { cancelRead(); state.token = ''; state.snapshot = null; state.stale = false; state.error = ''; state.imported = {}; state.pendingImport = null; state.export = null; state.publicSelection = []; state.github = {}; state.pin = null; state.usage = null; state.usageError = ''; state.usageRead = null; state.drawerSnapshot = null; state.drawerStale = false; $('#suspected').value = ''; $('#alternative-check').value = ''; $('#notebook-summary').textContent = ''; $('#import-preview').textContent = ''; $('#export-confirm').checked = false; $('#token').value = ''; $('#export-preview').textContent = ''; $('#detail').replaceChildren(); for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); render(); }
function beginDemo() { disconnect(); state.snapshot = makeDemo(state.scenario, { days: state.days, phase: state.phase }); state.usage = makeStatisticsDemo(state.days); render(); }
async function refresh() {
  if (!state.token) { if (state.snapshot?.mode === 'demo') { state.snapshot = makeDemo(state.scenario, { days: state.days, phase: state.phase }); render(); } return; }
  if (state.busy || document.hidden) return;
  clearTimeout(state.timer);
  const epoch = state.epoch, controller = new AbortController(); state.controller = controller; state.busy = true; render();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await requestPortfolio(fetch, { token: state.token, days: state.days, signal: controller.signal });
    if (epoch !== state.epoch) return;
    if (response.status === 401) { disconnect(); notify('Read token rejected. Private data and the token were cleared.'); return; }
    if (!response.ok) throw new Error('Collector unavailable');
    const data = await readLimitedJson(response);
    if (epoch !== state.epoch) return;
    assertPortfolio(data);
    if (data.window.days !== state.days) throw new Error('Unexpected portfolio window');
    state.snapshot = data; state.stale = false; state.error = '';
    if (state.view === 'usage') readUsage();
  } catch { if (epoch === state.epoch) { state.stale = true; state.error = 'Could not read the collector. No demo data was substituted.'; notify(state.error); } }
  finally {
    clearTimeout(timeout);
    if (epoch === state.epoch) { state.busy = false; state.controller = null; render(); if (state.token && !document.hidden) state.timer = setTimeout(refresh, REFRESH_MS); }
  }
}
function preview(text, name, type = 'text/markdown') { state.export = { text, name, type }; $('#export-confirm').checked = false; $('#download-export').disabled = true; $('#export-preview').textContent = text; $('#export-warning').textContent = `${demoPrefix() || 'PRIVATE AGGREGATE EXPORT. '}Review the complete file below. Nothing is uploaded; sharing it later is your decision.`; showDialog('#export-dialog'); }
function fieldNote() { if (state.snapshot) preview(makeBrief(state.snapshot, signalSet(), state.stale), `pulseboard-${state.snapshot.mode}-field-note.md`); }
function density() { document.body.dataset.density = document.body.dataset.density === 'compact' ? 'comfortable' : 'compact'; try { localStorage.setItem('pulseboard.desk.density', document.body.dataset.density); } catch { /* In-memory setting works. */ } render(); }
readSettings();
for (const close of document.querySelectorAll('.close-dialog')) close.addEventListener('click', () => close.closest('dialog').close());
$('#open-connect').addEventListener('click', () => showDialog('#connect-dialog'));
$('#connect').addEventListener('submit', event => { event.preventDefault(); const token = $('#token').value.trim(); if (token.length < 32 || token.length > 256) return; disconnect(); state.token = token; refresh(); });
$('#disconnect').addEventListener('click', disconnect); $('#demo').addEventListener('click', beginDemo); $('#refresh').addEventListener('click', refresh);
$('#brief').addEventListener('click', fieldNote); $('#density').addEventListener('click', density);
$('#search').addEventListener('input', event => { state.query = event.target.value.toLowerCase().trim(); render(); });
$('#scenario').addEventListener('change', event => { state.scenario = event.target.value; beginDemo(); });
$('#replay').addEventListener('input', event => { state.phase = Number(event.target.value); if (state.snapshot?.mode === 'demo') { state.snapshot = makeDemo(state.scenario, { days: state.days, phase: state.phase }); render(); } });
$('#window').addEventListener('change', event => { state.days = Number(event.target.value); if (state.token) { cancelRead(); refresh(); } else if (state.snapshot?.mode === 'demo') beginDemo(); });
$('#export-confirm').addEventListener('change', () => { $('#download-export').disabled = !$('#export-confirm').checked; });
$('#accept-import').addEventListener('click', () => { if (!state.pendingImport) return; state.imported[state.pendingImport.kind] = state.pendingImport; state.pendingImport = null; $('#import-preview').textContent = ''; $('#import-dialog').close(); render(); notify('Reviewed context kept in this tab only.'); });
$('#import-dialog').addEventListener('close', () => { state.pendingImport = null; $('#import-preview').textContent = ''; });
$('#export-dialog').addEventListener('close', () => { state.export = null; $('#export-preview').textContent = ''; $('#export-confirm').checked = false; $('#download-export').disabled = true; });
$('#notebook').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const note = makeReleaseNote(state.pin, { suspected: $('#suspected').value, alternativeCheck: $('#alternative-check').value }), markdown = event.submitter?.value === 'md';
    $('#notebook-dialog').close();
    preview(markdown ? releaseNoteMarkdown(note) : JSON.stringify(note, null, 2), `pulseboard-${note.mode}-release-note.${markdown ? 'md' : 'json'}`, markdown ? 'text/markdown' : 'application/json');
    $('#export-warning').textContent = `${note.mode === 'demo' ? 'SYNTHETIC DEMO. ' : 'PRIVATE RELEASE NOTE. '}A lead, not proof. Review the complete file below. Nothing is uploaded.`;
  } catch (error) { notify(error.message); }
});
$('#download-export').addEventListener('click', () => {
  if (!state.export || !$('#export-confirm').checked) return;
  const { text, name, type } = state.export, url = URL.createObjectURL(new Blob([text], { type }));
  const link = e('a', { href: url, download: name }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); $('#export-dialog').close(); notify('Reviewed file downloaded. Nothing was uploaded.');
});
$('#command-list').replaceChildren(...Object.entries(views).map(([view, [title]]) => button(title, () => { $('#palette').close(); navigate(view); })),
  button('Explore a synthetic scenario', () => { $('#palette').close(); beginDemo(); }), button('Prepare a field note', () => { $('#palette').close(); fieldNote(); }), button('Toggle density', () => { $('#palette').close(); density(); }));
$('#commands').addEventListener('click', () => showDialog('#palette'));
window.addEventListener('hashchange', () => { state.view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; if (state.view === 'usage') readUsage(); render(); $('#page-title').focus({ preventScroll: true }); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showDialog('#palette'); return; }
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (event.key === '/') { event.preventDefault(); $('#search').focus(); }
  if (!event.ctrlKey && !event.altKey && !event.metaKey && /^[1-5]$/.test(event.key)) navigate(Object.keys(views)[Number(event.key) - 1]);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelRead(); render(); } else if (state.token) refresh(); });
window.addEventListener('pagehide', disconnect);
state.view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const requestedDemo = new URLSearchParams(location.search).get('demo');
if (Object.hasOwn(SCENARIOS, requestedDemo)) { state.scenario = requestedDemo; $('#scenario').value = requestedDemo; beginDemo(); } else render();
