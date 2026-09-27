/** Voices admission contracts (docs/VOICES.md): `pulseboard.feedback/1` for POST /v1/feedback/<id> and
 *  `pulseboard.survey/1` for PUT /v1/survey/<id>. Both are player-initiated: nothing is sent unless the player presses
 *  Send, submits a survey or taps a rating. Shapes are closed (no other keys at any level) and validated against the
 *  project's registry in src/surveys.mjs. Free text is cleaned, bounded and redacted on the server before storage;
 *  redaction never rejects. A survey key is hashed with the project id before storage and never stored or returned raw. */
import { ADDRESS_PATTERNS, cutText } from './product-contract.mjs';
import { projects } from './projects.mjs';
import { releaseAccepted } from './release-label.mjs';
import { voiceRegistry } from './surveys.mjs';

export const VOICE_VERSION = 1;
/** Per project and UTC day, overridable as `voiceLimit` in src/projects.mjs. */
export const VOICE_DEFAULT_LIMIT = 300;
/** Across every project, per UTC day. Sized well inside D1's 500 MB free-plan cap next to product events' 310 MB:
 *  a feedback row at the 2,000-character bound is about 2.5 KB with its index, so 100 x 2.5 KB x 365 days is about
 *  91 MB (docs/VOICES.md "Budget and storage"). Survey and rating updates replace rows in place and add nothing. */
export const VOICE_GLOBAL_LIMIT = 100;
export const VOICE_GLOBAL_KEY = '*:voice';
export const FEEDBACK_KINDS = Object.freeze(['bug', 'idea', 'puzzle', 'praise', 'other']);
export const FEEDBACK_TEXT_MAX = 2000;
export const COMMENT_MAX = 500;
/** `written` is the UTC day the player pressed Send: at most one day after the receipt day, at most 30 before it. */
export const WRITTEN_PAST_DAYS = 30;
export const WRITTEN_FUTURE_DAYS = 1;
/** UTC calendar dates kept, including today (the retention sweep in src/worker.mjs). */
export const FEEDBACK_RETENTION_DAYS = 365;
export const SURVEY_RETENTION_DAYS = 400;
export const VOICE_DEVICES = Object.freeze(['mobile', 'tablet', 'desktop']);
export const SUBJECT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RELEASE = /^[0-9A-Za-z.+-]{1,32}$/;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const FEEDBACK_KEYS = Object.freeze(['v', 'id', 'release', 'kind', 'route', 'subject', 'text', 'written', 'context']);
const SURVEY_KEYS = Object.freeze(['v', 'survey', 'subject', 'respondent', 'release', 'answers', 'meta', 'comment', 'context']);

const plain = value => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
/** Every listed key present and no other: a missing key and an extra key are both a contract failure. */
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** The product-batch rule: the release shape, then the project's release admission (src/release-label.mjs, q-28). */
const releaseOf = (id, value) => typeof value === 'string' && RELEASE.test(value) && Object.hasOwn(projects, id) && releaseAccepted(projects[id], value);
const deviceOf = context => exact(context, ['device']) && VOICE_DEVICES.includes(context.device) ? context.device : null;

/** Control characters other than newline and tab become spaces, then the text is trimmed. Length is in UTF-16 units,
 *  as a browser text area and JSON measure it. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
export const cleanVoiceText = value => value.replace(CONTROL, ' ').trim();

// A link is anything with a scheme and `//`, or a bare `www.` host, up to the next space; closing punctuation that
// ends the sentence stays.
const LINK = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.[^\s]+/gi;
const LINK_TAIL = /[.,;:!?)\]}'"]+$/;
// Dates are not phone numbers: ISO days, year-first and day-first shapes are set aside before the phone pass, but only
// when they stand alone. A date shape inside a longer digit run (06.12.34.56.78, a dotted phone number) is not a date.
const DATES = /(?<!\d[-./])\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b(?![-./]\d)|(?<!\d[-./])\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b(?![-./]\d)/g;
/** Only a date that could be real is set aside: month 1-12 and day 1-31, day-first or month-first when the year is
 *  last. Anything else with a date's shape (5551-23-45, 98/76/5432) stays a phone candidate. */
const plausibleDate = match => {
  const parts = match.split(/[-./]/).map(Number);
  const day = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  if (/^\d{4}/.test(match)) return day(parts[2], parts[1]);
  return day(parts[0], parts[1]) || day(parts[1], parts[0]);
};
// A candidate run starts at a digit, `+` or `(` that is not inside a word, version or path, and ends at a digit.
const PHONE = /(?<![\w+./-])(?:\+|\()?\d[\d ()./-]{5,40}\d(?!\w)/g;
/** Phone-number-like: nine or more digits, or seven or more written with a separator, `+` or brackets. Long digit
 *  runs of any length (card numbers, account numbers) are therefore removed too. */
const phoneLike = run => {
  const digits = run.replace(/\D/g, '').length;
  return digits >= 9 || (digits >= 7 && /[ ()./+-]/.test(run));
};
/** Best-effort removal of links, e-mail addresses, IP addresses and phone-number-like runs from free text. Each removal
 *  is replaced by a marker ([link], [email], [ip], [phone]) and counted; the result is cut back to `max` because a
 *  marker can be longer than what it replaced. Returns { text, redacted }. */
export function redactVoiceText(text, max) {
  let redacted = 0;
  const mark = label => () => { redacted++; return label; };
  let value = text.replace(LINK, match => { redacted++; return '[link]' + (match.match(LINK_TAIL)?.[0] ?? ''); })
    .replace(ADDRESS_PATTERNS.EMAIL, mark('[email]'))
    .replace(ADDRESS_PATTERNS.IPV6_V4, mark('[ip]')).replace(ADDRESS_PATTERNS.IPV4, mark('[ip]')).replace(ADDRESS_PATTERNS.IPV6, mark('[ip]'));
  // Set dates aside behind private-use placeholders (no digits, no word characters), then restore them untouched.
  const kept = [];
  value = value.replace(DATES, match => { if (!plausibleDate(match)) return match; kept.push(match); return '\u0000' + String.fromCharCode(0xe000 + kept.length - 1) + '\u0000'; });
  value = value.replace(PHONE, run => phoneLike(run) ? (redacted++, '[phone]') : run);
  value = value.replace(/\u0000([-])\u0000/g, (_, index) => kept[index.charCodeAt(0) - 0xe000]);
  return { text: cutText(value, max), redacted };
}

/** A real calendar day in `YYYY-MM-DD`, from 30 days before the receipt day to one day after it (offline queue). */
export function writtenInWindow(value, now) {
  if (typeof value !== 'string' || !DAY_TEXT.test(value)) return false;
  const start = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== value) return false;
  const day = start / DAY_MS, today = Math.floor(now / DAY_MS);
  return day >= today - WRITTEN_PAST_DAYS && day <= today + WRITTEN_FUTURE_DAYS;
}

/** `pulseboard.feedback/1`. Returns the record to store (text cleaned and redacted) or null for a contract failure. */
export function parseFeedback(body, project, now = Date.now()) {
  const registry = voiceRegistry(project);
  if (!registry || !exact(body, FEEDBACK_KEYS) || body.v !== VOICE_VERSION) return null;
  if (typeof body.id !== 'string' || !UUID_V4.test(body.id) || !releaseOf(project, body.release)) return null;
  if (!FEEDBACK_KINDS.includes(body.kind) || !registry.routes.includes(body.route)) return null;
  if (body.subject !== '' && (typeof body.subject !== 'string' || !SUBJECT.test(body.subject))) return null;
  if (typeof body.text !== 'string') return null;
  const text = cleanVoiceText(body.text);
  if (text.length < 1 || text.length > FEEDBACK_TEXT_MAX || !writtenInWindow(body.written, now)) return null;
  const device = deviceOf(body.context);
  if (!device) return null;
  const scrubbed = redactVoiceText(text, FEEDBACK_TEXT_MAX);
  return { id: body.id, release: body.release, kind: body.kind, route: body.route, subject: body.subject,
    text: scrubbed.text, redacted: scrubbed.redacted, written: body.written, device };
}
export const validateFeedback = (body, project, now = Date.now()) => parseFeedback(body, project, now) !== null;

/** Answers in registry order, `many` options in registry order; an empty optional `many` is the same as no answer.
 *  Null when a question or option is unknown, a required answer is missing, or a `many` answer repeats or exceeds max. */
function canonicalAnswers(answers, questions) {
  if (!plain(answers) || Object.keys(answers).some(key => !questions.some(q => q.id === key))) return null;
  const out = {};
  for (const q of questions) {
    if (!Object.hasOwn(answers, q.id)) { if (q.required) return null; continue; }
    const value = answers[q.id];
    if (q.type === 'one') {
      if (typeof value !== 'string' || !q.options.includes(value)) return null;
      out[q.id] = value;
      continue;
    }
    if (!Array.isArray(value) || value.length > q.max || new Set(value).size !== value.length
      || !value.every(option => typeof option === 'string' && q.options.includes(option))) return null;
    if (value.length === 0) { if (q.required) return null; continue; }
    out[q.id] = q.options.filter(option => value.includes(option));
  }
  return out;
}
/** Meta keys and values from the survey's declaration, in declaration order; unknown keys or values are refused. */
function canonicalMeta(meta, declared) {
  if (!plain(meta) || Object.keys(meta).some(key => !Object.hasOwn(declared, key))) return null;
  const out = {};
  for (const [key, rule] of Object.entries(declared)) {
    if (!Object.hasOwn(meta, key)) { if (rule.required) return null; continue; }
    if (typeof meta[key] !== 'string' || !rule.values.includes(meta[key])) return null;
    out[key] = meta[key];
  }
  return out;
}

/** `pulseboard.survey/1`. Returns the record to store, with answers and meta as canonical JSON and the comment cleaned
 *  and redacted, or null. `respondent` is still the raw key here: hash it with respondentHash() before storage. */
export function parseSurvey(body, project) {
  const registry = voiceRegistry(project);
  if (!registry || !exact(body, SURVEY_KEYS) || body.v !== VOICE_VERSION) return null;
  if (typeof body.survey !== 'string' || !Object.hasOwn(registry.surveys, body.survey)) return null;
  const survey = registry.surveys[body.survey];
  if (survey.subject === 'none' ? body.subject !== '' : typeof body.subject !== 'string' || !SUBJECT.test(body.subject)) return null;
  if (typeof body.respondent !== 'string' || !UUID_V4.test(body.respondent) || !releaseOf(project, body.release)) return null;
  const answers = canonicalAnswers(body.answers, survey.questions), meta = canonicalMeta(body.meta, survey.meta);
  if (answers === null || meta === null || typeof body.comment !== 'string') return null;
  const comment = cleanVoiceText(body.comment);
  if (comment.length > COMMENT_MAX || (!survey.comment && comment !== '')) return null;
  const device = deviceOf(body.context);
  if (!device) return null;
  const scrubbed = comment ? redactVoiceText(comment, COMMENT_MAX) : { text: '', redacted: 0 };
  return { survey: body.survey, subject: body.subject, respondent: body.respondent, release: body.release,
    answers: JSON.stringify(answers), meta: JSON.stringify(meta), comment: scrubbed.text, redacted: scrubbed.redacted, device };
}
export const validateSurvey = (body, project) => parseSurvey(body, project) !== null;

/** The stored respondent: lower-case hex SHA-256 of `project + ':' + key`. The raw key never reaches storage. */
export async function respondentHash(project, key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(project + ':' + key));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
