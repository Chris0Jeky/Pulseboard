/** Inspection of a validated, pinned legacy-event reading, never a new data request. */
import { assertPortfolio } from './desk-bridge.mjs';
import { STALE_AFTER } from './desk-model.mjs';

export function operationReading(snapshot, project, now = Date.now(), refreshFailed = false) {
  if (!Number.isSafeInteger(now) || now < 0 || !['demo', 'live'].includes(snapshot?.mode)) throw new TypeError('Invalid operation reading');
  assertPortfolio({ ...snapshot, mode: 'live' });
  const p = snapshot.projects.find(p => p.id === project);
  if (!p) throw new TypeError('Unknown operation project');
  return structuredClone({ project, mode: snapshot.mode, sourceSchema: snapshot.schema,
    generatedAt: snapshot.generatedAt, window: snapshot.window, collectionAdmitted: p.collectionAdmitted,
    lastKnown: refreshFailed === true || snapshot.generatedAt > now || now - snapshot.generatedAt > STALE_AFTER,
    detailAvailable: snapshot.schema === 'pulseboard.portfolio/3', operations: p.operations || [] });
}

export function operationPanel(reading, { e, button, table, count, date }, review) {
  const known = reading.detailAvailable;
  return e('section', { class: 'drawer-section', role: 'region', 'aria-label': 'Named operation evidence' },
    e('h3', {}, 'Named operation evidence'),
    e('p', { class: 'tiny muted' }, `${reading.mode === 'demo' ? 'SYNTHETIC DEMO · ' : ''}${reading.lastKnown ? 'LAST-KNOWN · ' : ''}Pinned snapshot: ${date(reading.generatedAt)} · ${reading.sourceSchema}`),
    e('p', { class: 'tiny muted' }, `Legacy session events, not Product journeys or aggregate counts. Window: ${date(reading.window.start)} to ${date(reading.window.end)} (end exclusive). Session-event admission: ${reading.collectionAdmitted ? 'on' : 'off'}.`),
    !known ? e('p', { class: 'notice' }, 'Unmatched outcome detail is unavailable in this older reading, not zero.') : null,
    reading.operations.length ? reading.operations.map(op => e('article', { 'data-operation': op.id },
      e('h4', {}, `${op.id} · event contract v${op.version}`),
      e('p', {}, `${count(op.attempts)} starts: ${count(op.completed)} completed, ${count(op.failed)} failed, ${count(op.open)} open. ${count(op.retries)} retry candidates.`),
      known ? e('p', {}, `Unmatched outcomes: ${count(op.unmatched.completed)} completed, ${count(op.unmatched.failed)} failed.`) : null,
      e('p', { class: 'tiny muted' }, 'Open starts and unmatched outcomes are missing pairing evidence, not additional failures. Retry candidates need not be the same puzzle.'),
      e('details', {}, e('summary', {}, 'By release'),
        e('div', { class: 'table-shell', tabindex: '0', role: 'region', 'aria-label': `${op.id} outcomes by release` },
          table(['Release', 'Starts', 'Completed', 'Failed', 'Open', 'Retries', 'Unmatched completed', 'Unmatched failed'],
            op.releases.map(row => [row.release === 'other' ? 'Other releases (combined)' : row.release,
              ...['attempts', 'completed', 'failed', 'open', 'retries'].map(key => count(row[key])),
              known ? count(row.unmatched.completed) : 'Unavailable', known ? count(row.unmatched.failed) : 'Unavailable'])))),
      !known ? button('Review unavailable detail', () => review(op.id, 'missingness_unavailable'))
        : op.unmatched.completed + op.unmatched.failed > 0 ? button('Review unmatched outcomes', () => review(op.id, 'unmatched')) : null))
      : e('p', { class: 'muted' }, known ? 'No named operations supplied for this project.' : 'Named-operation definitions are not supplied by this reading.'),
    e('p', { class: 'tiny muted' }, 'This drawer stays on the snapshot it opened with. Reopen it to inspect a newer reading. No operation evidence enters a public pulse.'));
}
