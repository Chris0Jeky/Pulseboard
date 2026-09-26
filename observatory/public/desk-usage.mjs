/** Usage view model: one project's aggregate statistics read, its contract check and a synthetic twin.
 *  Counts are client-reported events, never people; nothing here derives visitors, retention or conversion. */
import { plain, requireValue, boundedString, list, exactKeys, unique } from './desk-bridge.mjs';
export const STATISTICS_SCHEMA = 'pulseboard.statistics/2';
export const STATISTICS_MAX_BYTES = 65536;
const TOP_KEYS = ['schema', 'project', 'generatedAt', 'window', 'collectionAdmitted', 'observationStatus', 'population', 'limitations', 'total', 'events', 'daily', 'routes', 'releases', 'eventDaily'];
const VOCABULARY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DAY_TEXT = /^\d{4}-\d\d-\d\d$/;
const PROJECT = /^[a-z0-9-]{1,64}$/;
const nonNegative = value => { requireValue(Number.isSafeInteger(value) && value >= 0, 'Invalid count'); return value; };
const word = value => { requireValue(typeof value === 'string' && VOCABULARY.test(value), 'Invalid vocabulary'); return value; };
const day = value => { requireValue(typeof value === 'string' && DAY_TEXT.test(value) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value), 'Invalid UTC day'); return value; };

/** Read only while the Usage view is open, so the portfolio poll's read budget is unchanged elsewhere. */
export function requestStatistics(fetcher, { project = 'alibi', token, days, signal }) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher');
  requireValue(typeof project === 'string' && PROJECT.test(project) && [1, 7, 14].includes(days), 'Invalid statistics request');
  return fetcher(`/v1/statistics/${project}?days=${days}`, {
    headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
  });
}

export function assertStatistics(input, days, project = 'alibi') {
  requireValue(plain(input) && input.schema === STATISTICS_SCHEMA && input.project === project, 'Unexpected statistics contract');
  // Closed: a field the reader does not emit today (a people-shaped one included) is refused, not ignored. Only the sandbox adds mode.
  exactKeys(input, [...TOP_KEYS, ...(input.mode === 'demo' ? ['mode'] : [])]);
  requireValue(Number.isSafeInteger(input.generatedAt) && input.generatedAt >= 0, 'Invalid timestamp');
  requireValue(typeof input.collectionAdmitted === 'boolean' && ['observed', 'no-admitted-counts'].includes(input.observationStatus), 'Invalid observation status');
  const w = input.window;
  exactKeys(w, ['startDay', 'endDay', 'days', 'timezone', 'partialToday']);
  requireValue(w.days === days && w.timezone === 'UTC' && w.partialToday === true, 'Invalid statistics window');
  day(w.startDay); day(w.endDay);
  requireValue(Date.parse(w.endDay) - Date.parse(w.startDay) === (days - 1) * 86400000, 'Invalid statistics window');
  list(input.limitations, 16).forEach(text => boundedString(text, 500));
  boundedString(input.population, 120);
  nonNegative(input.total);
  const inWindow = d => requireValue(day(d) >= w.startDay && d <= w.endDay, 'Day outside window');
  const rows = (value, max, keys, check) => { list(value, max).forEach(r => { exactKeys(r, [...keys, 'n']); check(r); nonNegative(r.n); });
    unique(value.map(r => keys.map(k => r[k]).join('|'))); };
  rows(input.events, 64, ['event'], r => word(r.event));
  rows(input.routes, 64, ['route'], r => word(r.route));
  rows(input.releases, 64, ['release'], r => word(r.release));
  rows(input.daily, 14, ['day'], r => inWindow(r.day));
  rows(input.eventDaily, 14 * 64, ['day', 'event'], r => { inWindow(r.day); word(r.event); });
  const total = rows => rows.reduce((n, r) => n + r.n, 0);
  requireValue([input.events, input.routes, input.releases, input.daily, input.eventDaily].every(xs => total(xs) === input.total), 'Statistics totals disagree');
  requireValue(input.daily.every(d => total(input.eventDaily.filter(r => r.day === d.day)) === d.n), 'Daily statistics disagree');
  return input;
}

const n = (stats, event) => stats.events.find(r => r.event === event)?.n || 0;
/** Headline figures. The per-start ratio compares two independent counts; it is not a per-player rate.
 *  Alibi reads its named puzzle journey; every other project reads the shared action events. */
export function usageReading(stats) {
  const journey = stats.project === 'alibi' ? 'puzzle' : 'action';
  const [s, c, f] = journey === 'puzzle' ? ['puzzle.started', 'puzzle.completed', 'puzzle.failed'] : ['action.requested', 'action.completed', 'action.failed'];
  const started = n(stats, s), completed = n(stats, c), failed = n(stats, f);
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
    journey, days, series: { all: series(null), views: series('page.view'), started: series(s), completed: series(c) },
    busiest, topRoute: stats.routes[0] ?? null,
  };
}

/** Suggested questions, not verdicts: each names the counts it came from. */
export function usageQuestions(stats, reading = usageReading(stats)) {
  const out = [];
  if (!stats.collectionAdmitted) out.push({ kind: 'boundary', text: 'Aggregate collection is not admitted on this collector, so a zero here says nothing about traffic.' });
  else if (!stats.total) out.push({ kind: 'boundary', text: 'Collection is admitted but no counts arrived in this window. Check the site is deployed with the statistics adapter before reading this as no visitors.' });
  if (reading.started >= 10 && reading.completedPerStart !== null && reading.completedPerStart < 0.5)
    out.push({ kind: 'question', text: `${reading.completed} completions against ${reading.started} ${reading.journey} starts. Is one step stalling, or do attempts resume later? A journey check would tell.` });
  if (reading.started >= 10 && reading.hintsPerStart !== null && reading.hintsPerStart > 1)
    out.push({ kind: 'question', text: `${reading.hints} hint requests against ${reading.started} starts. Is one puzzle's difficulty out of line with the rest?` });
  if (reading.errors > 0) out.push({ kind: 'question', text: `${reading.errors} app errors reported in this window. Which release carries them? Compare the release mix below.` });
  if (stats.releases.length > 1) out.push({ kind: 'note', text: `Counts arrived under ${stats.releases.length} release labels. Check which are current: a non-current label can be a cached client or a QA count.` });
  if (reading.views && !reading.started) out.push({ kind: 'question', text: `Pages are viewed but no ${reading.journey} was started. Is the start path obvious from the landing page?` });
  return out;
}

/** Deterministic invented counts for the sandbox; never sent anywhere. */
export function makeStatisticsDemo(days = 7, now = Date.now(), project = 'alibi') {
  requireValue([1, 7, 14].includes(days) && PROJECT.test(project), 'Unknown window');
  const alibi = project === 'alibi';
  const endDay = new Date(now).toISOString().slice(0, 10);
  const dayList = Array.from({ length: days }, (_, i) => new Date(Date.parse(endDay) - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  const shape = alibi ? { 'page.view': 38, 'app.ready': 30, 'puzzle.started': 14, 'puzzle.completed': 8, 'puzzle.failed': 3, 'hint.requested': 11, 'app.error': 1 }
    : { 'page.view': 21, 'app.ready': 18, 'action.requested': 9, 'action.completed': 7, 'action.failed': 1, 'app.error': 1 };
  const eventDaily = dayList.flatMap((d, i) => Object.entries(shape).map(([event, base]) => ({ day: d, event, n: Math.max(0, Math.round(base * (0.6 + ((i * 7 + event.length) % 9) / 10))) })));
  const total = eventDaily.reduce((s, r) => s + r.n, 0);
  const events = Object.keys(shape).sort().map(event => ({ event, n: eventDaily.filter(r => r.event === event).reduce((s, r) => s + r.n, 0) }));
  const daily = dayList.map(d => ({ day: d, n: eventDaily.filter(r => r.day === d).reduce((s, r) => s + r.n, 0) }));
  const split = (names, weights) => { let left = total; return names.map((name, i) => { const v = i === names.length - 1 ? left : Math.floor(total * weights[i]); left -= v; return [name, v]; }); };
  return { schema: STATISTICS_SCHEMA, project, generatedAt: now, mode: 'demo',
    window: { startDay: dayList[0], endDay, days, timezone: 'UTC', partialToday: true },
    collectionAdmitted: true, observationStatus: 'observed', population: 'synthetic aggregate counts',
    limitations: ['SYNTHETIC. Invented counts for exploring the view; not your production numbers.'],
    total, events, daily,
    routes: (alibi ? split(['puzzle', 'home', 'castle', 'quiet-wing', 'other'], [0.52, 0.27, 0.12, 0.06]) : split(['home'], [])).map(([route, n]) => ({ route, n })),
    releases: (alibi ? split(['0.12.0', '0.11.6'], [0.86]) : split(['unattributed'], [])).map(([release, n]) => ({ release, n })),
    eventDaily };
}
