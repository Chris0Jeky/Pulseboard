/** Voices view model: the pulseboard.voices/1 read and its closed contract. Voices are what players chose to send
 *  (docs/VOICES.md); the Desk renders every text field as a text node, never markup.
 *
 *  ASSUMED SHAPE (src/voices.mjs; every limit is a constant below):
 *
 *  GET /v1/voices/<id>?days=1|7|14|30|90  →
 *  { schema: 'pulseboard.voices/1', project, generatedAt: <ms>, mode?: 'demo',
 *    window: { startDay, endDay, days, timezone: 'UTC', partialToday: true }, collectionAdmitted: <bool>,
 *    population: <text ≤120>, limitations: [<text ≤500>] ≤16,
 *    feedback: [{ id: <uuid v4>, day, written, release, kind: bug|idea|puzzle|praise|other, route, subject: '' | <id>,
 *                 text: <1..2000, newlines and tabs allowed>, redacted: <int>, device, country, browser, os }] ≤500, newest first,
 *    feedbackTruncated: <bool>,
 *    surveys: [{ survey, respondents: <int>, questions: [{ id, type: one|many, required, max? (many), answered: <int>,
 *                options: [{ id, n }] }], comments: [<text 1..500>] ≤100, commentsTruncated: <bool> }],
 *    ratings: null | { survey, n, subjects: [{ subject, family, tier, n, tooEasy, justRight, tooHard, more }] ≤500, subjectsTruncated,
 *                      families: [{ family, n, tooEasy, justRight, tooHard, more }], tiers: [{ tier, … }] } }
 */
import { plain, requireValue, boundedString, list, exactKeys, unique } from './desk-bridge.mjs';
import { rankQuantile } from './desk-product.mjs';
export const VOICES_SCHEMA = 'pulseboard.voices/1';
/** 500 feedback texts of up to 2,000 characters (6 KB of UTF-8 each at worst) plus surveys and ratings. */
export const VOICES_MAX_BYTES = 4 * 1048576;
export const VOICES_WINDOWS = Object.freeze([1, 7, 14, 30, 90]);
export const VOICE_KINDS = Object.freeze(['bug', 'idea', 'puzzle', 'praise', 'other']);
const VOICE_LIMITS = Object.freeze({ feedback: 500, text: 2000, comments: 100, comment: 500, surveys: 16, questions: 32, options: 64, subjects: 500, rollups: 64 });
const VOICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, VOICE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VOICE_RELEASE = /^[0-9A-Za-z.+-]{1,32}$/, VOICE_PROJECT = /^[a-z0-9-]{1,64}$/, VOICE_DATE = /^\d{4}-\d\d-\d\d$/;
const VOICE_DEVICES = ['mobile', 'tablet', 'desktop'];
const voiceWhole = (value, min = 0) => { requireValue(Number.isSafeInteger(value) && value >= min, 'Invalid voices integer'); return value; };
const voiceMatching = (value, pattern) => { requireValue(typeof value === 'string' && pattern.test(value), 'Invalid voices value'); return value; };
const voiceDate = value => { requireValue(typeof value === 'string' && VOICE_DATE.test(value) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value), 'Invalid UTC day'); return value; };
/** Player text: 1..max UTF-16 units; newlines and tabs are its own, every other control character was removed by the collector. */
const voiceText = (value, max) => { requireValue(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value), 'Invalid voices text'); return value; };
const voiceSum = rows => rows.reduce((sum, row) => sum + row.n, 0);

export function requestVoices(fetcher, { project, token, days, signal }) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher');
  requireValue(typeof project === 'string' && VOICE_PROJECT.test(project) && VOICES_WINDOWS.includes(days), 'Invalid voices request');
  return fetcher(`/v1/voices/${project}?days=${days}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
}

function voiceTallies(row, keys, min) {
  exactKeys(row, [...keys, 'n', 'tooEasy', 'justRight', 'tooHard', 'more']);
  voiceWhole(row.n, min); voiceWhole(row.tooEasy); voiceWhole(row.justRight); voiceWhole(row.tooHard); voiceWhole(row.more);
  requireValue(row.tooEasy + row.justRight + row.tooHard === row.n && row.more <= row.n, 'Ratings disagree');
}

export function assertVoices(input, days, project) {
  requireValue(plain(input) && input.schema === VOICES_SCHEMA && input.project === project, 'Unexpected voices contract');
  // Closed: an unexpected field (a respondent-shaped one included) is refused, not ignored. Only the sandbox adds mode.
  exactKeys(input, ['schema', 'project', 'generatedAt', 'window', 'collectionAdmitted', 'population', 'limitations', 'feedback', 'feedbackTruncated',
    'surveys', 'ratings', ...(input.mode === 'demo' ? ['mode'] : [])]);
  voiceWhole(input.generatedAt);
  const w = input.window;
  exactKeys(w, ['startDay', 'endDay', 'days', 'timezone', 'partialToday']);
  requireValue(VOICES_WINDOWS.includes(days) && w.days === days && w.timezone === 'UTC' && w.partialToday === true, 'Invalid voices window');
  voiceDate(w.startDay); voiceDate(w.endDay);
  requireValue(Date.parse(w.endDay) - Date.parse(w.startDay) === (days - 1) * 86400000, 'Invalid voices window');
  requireValue(typeof input.collectionAdmitted === 'boolean' && typeof input.feedbackTruncated === 'boolean', 'Invalid voices flag');
  boundedString(input.population, 120);
  list(input.limitations, 16).forEach(text => boundedString(text, 500));
  list(input.feedback, VOICE_LIMITS.feedback).forEach(f => {
    exactKeys(f, ['id', 'day', 'written', 'release', 'kind', 'route', 'subject', 'text', 'redacted', 'device', 'country', 'browser', 'os']);
    voiceMatching(f.id, VOICE_ID); voiceDate(f.written); voiceMatching(f.release, VOICE_RELEASE); voiceMatching(f.route, VOICE_SLUG);
    requireValue(voiceDate(f.day) >= w.startDay && f.day <= w.endDay, 'Feedback outside window');
    requireValue(VOICE_KINDS.includes(f.kind) && VOICE_DEVICES.includes(f.device), 'Invalid feedback kind or device');
    requireValue(f.subject === '' || VOICE_SLUG.test(f.subject), 'Invalid feedback subject');
    voiceText(f.text, VOICE_LIMITS.text); voiceWhole(f.redacted);
    for (const key of ['country', 'browser', 'os']) boundedString(f[key], 16);
  });
  unique(input.feedback.map(f => f.id));
  list(input.surveys, VOICE_LIMITS.surveys).forEach(s => {
    exactKeys(s, ['survey', 'respondents', 'questions', 'comments', 'commentsTruncated']);
    voiceMatching(s.survey, VOICE_SLUG); voiceWhole(s.respondents);
    requireValue(typeof s.commentsTruncated === 'boolean', 'Invalid comments flag');
    list(s.questions, VOICE_LIMITS.questions).forEach(q => {
      requireValue(plain(q) && ['one', 'many'].includes(q.type), 'Invalid question type');
      exactKeys(q, q.type === 'many' ? ['id', 'type', 'required', 'max', 'answered', 'options'] : ['id', 'type', 'required', 'answered', 'options']);
      voiceMatching(q.id, VOICE_SLUG); requireValue(typeof q.required === 'boolean', 'Invalid required flag');
      requireValue(voiceWhole(q.answered) <= s.respondents && (!q.required || q.answered === s.respondents), 'Answers disagree with respondents');
      list(q.options, VOICE_LIMITS.options).forEach(o => { exactKeys(o, ['id', 'n']); voiceMatching(o.id, VOICE_SLUG); requireValue(voiceWhole(o.n) <= q.answered, 'Option above answers'); });
      unique(q.options.map(o => o.id));
      // One answer each: the options sum to the answers. Several: each option at most once per answer, at most max per answer.
      if (q.type === 'one') requireValue(voiceSum(q.options) === q.answered, 'Options disagree with answers');
      else requireValue(voiceWhole(q.max, 1) && voiceSum(q.options) <= q.answered * q.max, 'Options exceed answers');
    });
    unique(s.questions.map(q => q.id));
    list(s.comments, VOICE_LIMITS.comments).forEach(text => voiceText(text, VOICE_LIMITS.comment));
    requireValue(s.comments.length <= s.respondents, 'More comments than respondents');
  });
  unique(input.surveys.map(s => s.survey));
  const r = input.ratings;
  if (r !== null) {
    exactKeys(r, ['survey', 'n', 'subjects', 'subjectsTruncated', 'families', 'tiers']);
    voiceMatching(r.survey, VOICE_SLUG); voiceWhole(r.n); requireValue(typeof r.subjectsTruncated === 'boolean', 'Invalid subjects flag');
    list(r.subjects, VOICE_LIMITS.subjects).forEach(x => { voiceTallies(x, ['subject', 'family', 'tier'], 1); voiceMatching(x.subject, VOICE_SLUG); voiceMatching(x.family, VOICE_SLUG); voiceMatching(x.tier, VOICE_SLUG); });
    unique(r.subjects.map(x => `${x.subject}|${x.family}|${x.tier}`));
    list(r.families, VOICE_LIMITS.rollups).forEach(x => { voiceTallies(x, ['family'], 0); voiceMatching(x.family, VOICE_SLUG); });
    list(r.tiers, VOICE_LIMITS.rollups).forEach(x => { voiceTallies(x, ['tier'], 0); voiceMatching(x.tier, VOICE_SLUG); });
    unique(r.families.map(x => x.family)); unique(r.tiers.map(x => x.tier));
    requireValue(voiceSum(r.families) === r.n && voiceSum(r.tiers) === r.n, 'Ratings roll-ups disagree');
    requireValue(r.subjectsTruncated ? voiceSum(r.subjects) <= r.n : voiceSum(r.subjects) === r.n, 'Rated puzzles disagree with the total');
  }
  return input;
}

/** Content demand (docs/VOICES.md section 4): the puzzle journey events Alibi sends with props.family and props.tier. */
export const VOICE_CONTENT_NAMES = Object.freeze(['puzzle.started', 'puzzle.completed', 'puzzle.failed', 'hint.requested']);
const VOICE_CONTENT_ROWS = 64;
/** Per family and per tier: started, completed and failed counts, completions per start (two independent counts, not a
 *  per-player rate), the nearest-rank median of the raw props.seconds on completions (never an average of medians), and
 *  hint requests per completion; joined with the rating roll-ups. Computed in the tab from events already read.
 *  Property values are open JSON, so rows are capped at 64 per table, most started first, and the rest are counted. */
export function voiceContent(events, ratings = null) {
  const groups = { family: new Map(), tier: new Map() };
  let attributed = 0, unattributed = 0;
  const slot = (map, key) => { let r = map.get(key); if (!r) map.set(key, r = { started: 0, completed: 0, failed: 0, hints: 0, seconds: [] }); return r; };
  for (const x of events) {
    if (!VOICE_CONTENT_NAMES.includes(x.name)) continue;
    const labels = { family: x.props?.family, tier: x.props?.tier };
    if (!['family', 'tier'].some(dim => typeof labels[dim] === 'string' && labels[dim])) { unattributed++; continue; }
    attributed++;
    for (const dim of ['family', 'tier']) {
      if (typeof labels[dim] !== 'string' || !labels[dim]) continue;
      const r = slot(groups[dim], labels[dim]);
      if (x.name === 'puzzle.started') r.started++;
      else if (x.name === 'puzzle.failed') r.failed++;
      else if (x.name === 'hint.requested') r.hints++;
      else { r.completed++; const time = x.props.seconds; if (typeof time === 'number' && Number.isFinite(time) && time >= 0) r.seconds.push(time); }
    }
  }
  const grouped = dim => {
    const rolled = (ratings?.[dim === 'family' ? 'families' : 'tiers'] ?? []).filter(x => x.n > 0);
    const keys = new Set([...groups[dim].keys(), ...rolled.map(x => x[dim])]);
    const rows = [...keys].map(key => {
      const r = groups[dim].get(key) ?? { started: 0, completed: 0, failed: 0, hints: 0, seconds: [] }, sorted = r.seconds.sort((a, b) => a - b);
      const rating = rolled.find(x => x[dim] === key);
      return { [dim]: key, started: r.started, completed: r.completed, failed: r.failed, completionRate: r.started ? r.completed / r.started : null,
        medianSeconds: rankQuantile(sorted, 0.5), timed: sorted.length, hintsPerCompletion: r.completed ? r.hints / r.completed : null,
        ratings: rating ? { n: rating.n, tooEasy: rating.tooEasy, justRight: rating.justRight, tooHard: rating.tooHard, more: rating.more } : null };
    }).sort((a, b) => b.started - a.started || b.completed - a.completed || (a[dim] < b[dim] ? -1 : a[dim] > b[dim] ? 1 : 0));
    return { rows: rows.slice(0, VOICE_CONTENT_ROWS), more: Math.max(0, rows.length - VOICE_CONTENT_ROWS) };
  };
  return { families: grouped('family'), tiers: grouped('tier'), attributed, unattributed };
}

/** Feedback counts per kind in the rows read, in contract order, for the kind filter. */
export const voiceKindCounts = feedback => VOICE_KINDS.map(kind => ({ kind, n: feedback.filter(f => f.kind === kind).length }));

/** The Alibi taste survey as the collector's registry declares it (src/surveys.mjs); a test keeps the two equal. */
export const VOICE_DEMO_FAMILIES = Object.freeze(['bridges', 'scene', 'dossier', 'witness', 'sudoku', 'nonogram', 'binary', 'futoshiki', 'lightup', 'tents', 'aquarium', 'network', 'trail']);
export const VOICE_DEMO_TIERS = Object.freeze(['gentle', 'steady', 'tricky', 'expert', 'master', 'grandmaster']);
export const VOICE_DEMO_TASTE = Object.freeze([
  { id: 'often', type: 'one', required: true, options: ['daily', 'few-a-week', 'weekly', 'now-and-then', 'first-time'] },
  { id: 'more', type: 'many', required: false, max: 5, options: [...VOICE_DEMO_FAMILIES, 'archive-heist', 'borough', 'duel', 'block-cabinet', 'gardens', 'casebooks', 'castle'] },
  { id: 'difficulty', type: 'one', required: true, options: ['too-easy', 'mostly-right', 'too-hard', 'mixed'] },
  { id: 'tiers', type: 'many', required: false, max: 3, options: [...VOICE_DEMO_TIERS] },
  { id: 'next', type: 'one', required: false, options: ['more-puzzles', 'harder-puzzles', 'new-families', 'more-story', 'club-games', 'polish'] },
  { id: 'feel', type: 'one', required: false, options: ['love-it', 'fine', 'cluttered', 'confusing'] },
  { id: 'recommend', type: 'one', required: false, options: ['definitely', 'probably', 'not-sure', 'probably-not'] },
]);
const VOICE_DEMO_TEXT = [
  ['bug', 'puzzle', 'vault-binary-04', "The last row won't accept a moon even though the row has room."],
  ['idea', 'home', '', 'A daily puzzle streak would bring me back every morning.'],
  ['praise', 'castle', '', 'The castle story is lovely.\nMore chapters, please!'],
  ['puzzle', 'puzzle', 'castle-3', 'I think this one has two solutions: the left bridge can go either way.'],
  ['other', 'settings', '', 'Pasted from my notes: <img src=x onerror=alert(1)> should show as text.'],
  ['bug', 'games', '', 'The duel timer kept running after I paused. Contact me at [email]'],
  ['idea', 'puzzle', 'sudoku-gentle-02', 'Let me mark candidates with long press on mobile.'],
];
/** Invented, deterministic Voices for the sandbox: nothing is read from or sent to a collector. Alibi only; any other
 *  project has no voice registry and reads empty, as the collector would answer. */
export function makeVoicesDemo(days = 7, now = Date.now(), project = 'alibi') {
  let seed = 7919 + days;
  const next = max => { seed = (seed * 48271) % 2147483647; return seed % max; };
  const endDay = new Date(now).toISOString().slice(0, 10), startDay = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
  const day = offset => new Date(now - Math.min(offset, days - 1) * 86400000).toISOString().slice(0, 10);
  const base = { schema: VOICES_SCHEMA, project, generatedAt: now, mode: 'demo', window: { startDay, endDay, days, timezone: 'UTC', partialToday: true },
    collectionAdmitted: project === 'alibi', population: 'player-initiated feedback, survey answers and puzzle ratings',
    limitations: ['Invented sandbox data: no player sent any of it.', 'A survey key is an installation, not a person.'] };
  if (project !== 'alibi') return { ...base, feedback: [], feedbackTruncated: false, surveys: [], ratings: null };
  const feedback = VOICE_DEMO_TEXT.map(([kind, route, subject, text], i) => ({ id: `0b8f6c7e-3f1a-4d8e-9c55-${String(i + 1).padStart(12, '0')}`,
    day: day(i), written: day(i), release: i < 3 ? '0.15.0' : '0.14.1', kind, route, subject, text, redacted: text.includes('[email]') ? 1 : 0,
    device: ['mobile', 'desktop', 'tablet'][i % 3], country: ['GB', 'US', 'DE'][i % 3], browser: ['chrome', 'safari', 'firefox'][i % 3], os: ['android', 'ios', 'windows'][i % 3] }));
  const respondents = 14 + next(9);
  const questions = VOICE_DEMO_TASTE.map(q => {
    const answered = q.required ? respondents : respondents - 2 - next(4);
    const counts = q.options.map(() => 0);
    for (let i = 0; i < answered; i++) {
      if (q.type === 'one') counts[next(q.options.length)]++;
      else { const picked = new Set(); for (let k = 0; k < 1 + next(q.max); k++) picked.add(next(q.options.length)); for (const index of picked) counts[index]++; }
    }
    return { id: q.id, type: q.type, required: q.required, ...(q.type === 'many' ? { max: q.max } : {}), answered, options: q.options.map((id, i) => ({ id, n: counts[i] })) };
  });
  const subjects = [];
  for (let i = 0; i < 18; i++) {
    const family = VOICE_DEMO_FAMILIES[i % VOICE_DEMO_FAMILIES.length], tier = VOICE_DEMO_TIERS[(i * 5) % VOICE_DEMO_TIERS.length], n = 1 + next(9);
    const tooEasy = next(n + 1), tooHard = next(n - tooEasy + 1);
    subjects.push({ subject: `${family}-${tier}-${String(i + 1).padStart(2, '0')}`, family, tier, n, tooEasy, justRight: n - tooEasy - tooHard, tooHard, more: next(n + 1) });
  }
  subjects.sort((a, b) => b.n - a.n || (a.subject < b.subject ? -1 : 1));
  const roll = (key, values) => values.map(value => subjects.filter(x => x[key] === value).reduce((t, x) => ({ ...t, n: t.n + x.n, tooEasy: t.tooEasy + x.tooEasy,
    justRight: t.justRight + x.justRight, tooHard: t.tooHard + x.tooHard, more: t.more + x.more }), { [key]: value, n: 0, tooEasy: 0, justRight: 0, tooHard: 0, more: 0 }));
  return { ...base, feedback, feedbackTruncated: false,
    surveys: [{ survey: 'alibi-taste-1', respondents, questions,
      comments: ['More castles, please.', 'The gentle tier is perfect for my commute.', 'I would pay for a harder nonogram pack.'], commentsTruncated: false }],
    ratings: { survey: 'puzzle-rating', n: voiceSum(subjects), subjects, subjectsTruncated: false,
      families: roll('family', VOICE_DEMO_FAMILIES), tiers: roll('tier', VOICE_DEMO_TIERS) } };
}
