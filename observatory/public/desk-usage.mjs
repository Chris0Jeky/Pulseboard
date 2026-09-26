/** Usage view model: the aggregate Alibi statistics read, its contract check and a synthetic twin.
 *  Counts are client-reported events, never people; nothing here derives visitors, retention or conversion. */
import { plain, requireValue, boundedString, list } from './desk-bridge.mjs';
export const STATISTICS_SCHEMA = 'pulseboard.statistics/2';
export const STATISTICS_MAX_BYTES = 65536;
const VOCABULARY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DAY_TEXT = /^\d{4}-\d\d-\d\d$/;
const count = value => { requireValue(Number.isSafeInteger(value) && value >= 0, 'Invalid count'); return value; };
const word = value => { requireValue(typeof value === 'string' && VOCABULARY.test(value), 'Invalid vocabulary'); return value; };
const day = value => { requireValue(typeof value === 'string' && DAY_TEXT.test(value) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value), 'Invalid UTC day'); return value; };

/** Read only while the Usage view is open, so the portfolio poll's read budget is unchanged elsewhere. */
export function requestStatistics(fetcher, { token, days, signal }) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher');
  return fetcher(`/v1/statistics/alibi?days=${days}`, {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
  });
}

export function assertStatistics(input, days) {
  requireValue(plain(input) && input.schema === STATISTICS_SCHEMA && input.project === 'alibi', 'Unexpected statistics contract');
  requireValue(Number.isSafeInteger(input.generatedAt) && input.generatedAt >= 0, 'Invalid timestamp');
  requireValue(typeof input.collectionAdmitted === 'boolean' && ['observed', 'no-admitted-counts'].includes(input.observationStatus), 'Invalid observation status');
  const w = input.window;
  requireValue(plain(w) && w.days === days && w.timezone === 'UTC', 'Invalid statistics window');
  day(w.startDay); day(w.endDay);
  requireValue(Date.parse(w.endDay) - Date.parse(w.startDay) === (days - 1) * 86400000, 'Invalid statistics window');
  list(input.limitations, 16).forEach(text => boundedString(text, 500));
  boundedString(input.population, 120);
  count(input.total);
  const inWindow = d => requireValue(day(d) >= w.startDay && d <= w.endDay, 'Day outside window');
  list(input.events, 64).forEach(r => { word(r.event); count(r.n); });
  list(input.routes, 64).forEach(r => { word(r.route); count(r.n); });
  list(input.releases, 64).forEach(r => { word(r.release); count(r.n); });
  list(input.daily, 14).forEach(r => { inWindow(r.day); count(r.n); });
  list(input.eventDaily, 14 * 64).forEach(r => { inWindow(r.day); word(r.event); count(r.n); });
  const total = rows => rows.reduce((n, r) => n + r.n, 0);
  requireValue([input.events, input.routes, input.releases, input.daily, input.eventDaily].every(rows => total(rows) === input.total), 'Statistics totals disagree');
  return input;
}

const n = (stats, event) => stats.events.find(r => r.event === event)?.n || 0;
/** Headline figures. The per-start ratio compares two independent counts; it is not a per-player rate. */
export function usageReading(stats) {
  const started = n(stats, 'puzzle.started'), completed = n(stats, 'puzzle.completed'), failed = n(stats, 'puzzle.failed');
  const views = n(stats, 'page.view'), errors = n(stats, 'app.error'), hints = n(stats, 'hint.requested');
  const days = [];
  for (let t = Date.parse(stats.window.startDay); t <= Date.parse(stats.window.endDay); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const series = event => days.map(d => stats.eventDaily.filter(r => r.day === d && (!event || r.event === event)).reduce((s, r) => s + r.n, 0));
  const busiest = stats.daily.reduce((best, r) => r.n > (best?.n ?? -1) ? r : best, null);
  return {
    total: stats.total, views, started, completed, failed, hints, errors,
    completedPerStart: started ? completed / started : null,
    hintsPerStart: started ? hints / started : null,
    errorsPer100Views: views ? errors / views * 100 : null,
    days, series: { all: series(null), views: series('page.view'), started: series('puzzle.started'), completed: series('puzzle.completed') },
    busiest, topRoute: stats.routes[0] ?? null,
  };
}

/** Suggested questions, not verdicts: each names the counts it came from. */
export function usageQuestions(stats, reading = usageReading(stats)) {
  const out = [];
  if (!stats.collectionAdmitted) out.push({ kind: 'boundary', text: 'Aggregate collection is not admitted on this collector, so a zero here says nothing about traffic.' });
  else if (!stats.total) out.push({ kind: 'boundary', text: 'Collection is admitted but no counts arrived in this window. Check the site is deployed with the statistics adapter before reading this as no visitors.' });
  if (reading.started >= 10 && reading.completedPerStart !== null && reading.completedPerStart < 0.5)
    out.push({ kind: 'question', text: `${reading.completed} completions against ${reading.started} starts. Are players stalling on one puzzle, or leaving and returning later? A puzzle-level journey check would tell.` });
  if (reading.started >= 10 && reading.hintsPerStart !== null && reading.hintsPerStart > 1)
    out.push({ kind: 'question', text: `${reading.hints} hint requests against ${reading.started} starts. Is one puzzle's difficulty out of line with the rest?` });
  if (reading.errors > 0) out.push({ kind: 'question', text: `${reading.errors} app errors reported in this window. Which release carries them? Compare the release mix below.` });
  if (stats.releases.length > 1) out.push({ kind: 'note', text: `${stats.releases.length} releases reported counts. Older releases still sending means cached or unupdated clients.` });
  if (reading.views && !reading.started) out.push({ kind: 'question', text: 'Pages are viewed but no puzzle was started. Is the start path obvious from the landing page?' });
  return out;
}

/** Deterministic invented counts for the sandbox; never sent anywhere. */
export function makeStatisticsDemo(days = 7, now = Date.now()) {
  requireValue([1, 7, 14].includes(days), 'Unknown window');
  const endDay = new Date(now).toISOString().slice(0, 10);
  const dayList = Array.from({ length: days }, (_, i) => new Date(Date.parse(endDay) - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  const shape = { 'page.view': 38, 'app.ready': 30, 'puzzle.started': 14, 'puzzle.completed': 8, 'puzzle.failed': 3, 'hint.requested': 11, 'app.error': 1 };
  const eventDaily = dayList.flatMap((d, i) => Object.entries(shape).map(([event, base]) => ({ day: d, event, n: Math.max(0, Math.round(base * (0.6 + ((i * 7 + event.length) % 9) / 10))) })));
  const total = eventDaily.reduce((s, r) => s + r.n, 0);
  const events = Object.keys(shape).sort().map(event => ({ event, n: eventDaily.filter(r => r.event === event).reduce((s, r) => s + r.n, 0) }));
  const daily = dayList.map(d => ({ day: d, n: eventDaily.filter(r => r.day === d).reduce((s, r) => s + r.n, 0) }));
  const split = (names, weights) => { let left = total; return names.map((name, i) => { const v = i === names.length - 1 ? left : Math.floor(total * weights[i]); left -= v; return [name, v]; }); };
  return { schema: STATISTICS_SCHEMA, project: 'alibi', generatedAt: now, mode: 'demo',
    window: { startDay: dayList[0], endDay, days, timezone: 'UTC', partialToday: true },
    collectionAdmitted: true, observationStatus: 'observed', population: 'synthetic aggregate counts',
    limitations: ['SYNTHETIC. Invented counts for exploring the view; not your production numbers.'],
    total, events, daily,
    routes: split(['puzzle', 'home', 'castle', 'quiet-wing', 'other'], [0.52, 0.27, 0.12, 0.06]).map(([route, n]) => ({ route, n })),
    releases: split(['0.12.0', '0.11.6'], [0.86]).map(([release, n]) => ({ release, n })),
    eventDaily };
}
