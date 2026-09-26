/** Alibi product panel: per-puzzle starts, completions, failures, hint use, solve time and where people give up.
 *  ASSUMED PROPS (reconcile with Alibi's Pulseboard.track calls when the host wave lands):
 *    puzzle.started   { puzzle: <string id> }
 *    puzzle.completed { puzzle, seconds: <number, time to solve>, hints: <number used>, attempts: <number> }
 *    puzzle.failed    { puzzle, seconds?, attempts? }
 *    hint.requested   { puzzle }
 *  An event without a string props.puzzle is counted as unattributed, never guessed. Give-ups need a session id, so
 *  Diagnostics-only (session null) events cannot show one. */
import { rankQuantile } from '../desk-product.mjs';
export const ALIBI_EVENT_NAMES = Object.freeze(['puzzle.started', 'puzzle.completed', 'puzzle.failed', 'hint.requested']);

export function alibiPuzzles(events) {
  const puzzles = new Map(), sessions = new Map(); let unattributed = 0, sessionless = 0;
  const row = id => puzzles.get(id) ?? puzzles.set(id, { puzzle: id, starts: 0, completions: 0, failures: 0, hints: 0, seconds: [], attempts: [] }).get(id);
  for (const x of events) {
    const id = x.props?.puzzle;
    if (typeof id !== 'string' || !id || !ALIBI_EVENT_NAMES.includes(x.name)) { unattributed++; continue; }
    const r = row(id);
    if (x.name === 'puzzle.started') r.starts++;
    else if (x.name === 'puzzle.failed') r.failures++;
    else if (x.name === 'hint.requested') r.hints++;
    else {
      r.completions++;
      if (Number.isFinite(x.props.seconds) && x.props.seconds >= 0) r.seconds.push(x.props.seconds);
      if (Number.isFinite(x.props.attempts) && x.props.attempts >= 0) r.attempts.push(x.props.attempts);
    }
    if (x.name !== 'puzzle.started' && x.name !== 'puzzle.completed') continue;
    if (!x.session) { sessionless++; continue; }
    const key = `${x.session}|${id}`, seen = sessions.get(key) ?? { puzzle: id, started: false, completed: false };
    if (x.name === 'puzzle.started') seen.started = true; else seen.completed = true;
    sessions.set(key, seen);
  }
  const gaveUp = new Map(), startedSessions = new Map();
  for (const s of sessions.values()) if (s.started) {
    startedSessions.set(s.puzzle, (startedSessions.get(s.puzzle) ?? 0) + 1);
    if (!s.completed) gaveUp.set(s.puzzle, (gaveUp.get(s.puzzle) ?? 0) + 1);
  }
  const rows = [...puzzles.values()].map(r => {
    const seconds = r.seconds.sort((a, b) => a - b), attempts = r.attempts.sort((a, b) => a - b);
    return { puzzle: r.puzzle, starts: r.starts, completions: r.completions, failures: r.failures, hints: r.hints,
      completionRate: r.starts ? r.completions / r.starts : null,
      solve: { n: seconds.length, median: rankQuantile(seconds, 0.5), p90: rankQuantile(seconds, 0.9) },
      medianAttempts: rankQuantile(attempts, 0.5),
      startedSessions: startedSessions.get(r.puzzle) ?? 0, gaveUp: gaveUp.get(r.puzzle) ?? 0 };
  }).sort((a, b) => b.starts - a.starts || a.puzzle.localeCompare(b.puzzle));
  const giveUps = rows.filter(r => r.gaveUp > 0).map(r => ({ puzzle: r.puzzle, sessions: r.gaveUp, of: r.startedSessions, share: r.gaveUp / r.startedSessions }))
    .sort((a, b) => b.sessions - a.sessions || b.share - a.share || a.puzzle.localeCompare(b.puzzle));
  return { puzzles: rows, giveUps, unattributed, sessionless, events: events.length };
}

/** Rendered through the Desk's own helpers; every value becomes a text node. */
function renderAlibi(model, ui) {
  const { e, table, panel, count, percent } = ui;
  const seconds = v => v === null ? '—' : `${count(v)} s`;
  return [e('div', { class: 'overview-grid' },
    panel('Per puzzle', model.puzzles.length ? e('div', { class: 'table-shell' }, table(['Puzzle', 'Starts', 'Completions', 'Failures', 'Completions per start', 'Solve time median · p90', 'Hint requests'],
      model.puzzles.map(r => [r.puzzle, count(r.starts), count(r.completions), count(r.failures), percent(r.completionRate),
        r.solve.n ? `${seconds(r.solve.median)} · ${seconds(r.solve.p90)} (n=${r.solve.n})` : 'No solve times', count(r.hints)])))
      : e('p', { class: 'muted' }, 'No puzzle events in this window.'), e('span', { class: 'mini-label' }, 'FROM RAW EVENTS')),
    panel('Where people give up', model.giveUps.length ? e('div', { class: 'table-shell' }, table(['Puzzle', 'Sessions without a completion', 'Of sessions that started it'],
      model.giveUps.map(g => [g.puzzle, count(g.sessions), `${count(g.of)} (${percent(g.share)})`])))
      : e('p', { class: 'muted' }, 'Every session that started a puzzle also completed it in this sample.'), e('span', { class: 'mini-label' }, 'SAME SESSION'))),
  e('p', { class: 'tiny muted' }, `${count(model.events)} events read. ${count(model.unattributed)} without a puzzle id; ${count(model.sessionless)} starts or completions without a session cannot show a give-up. A give-up is a started puzzle with no completion in the same session: the player may have resumed later, in another tab.`)];
}

export const alibiPanel = Object.freeze({ title: 'Alibi puzzles', names: ALIBI_EVENT_NAMES, compute: alibiPuzzles, render: renderAlibi });
