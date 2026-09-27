/** Voices read model for the Desk (docs/VOICES.md section 3): `pulseboard.voices/1`. One D1 batch gives the whole reading
 *  one snapshot. Everything is bounded by project and UTC window; a survey row falls in the window by its last update.
 *  The response never carries a respondent hash, a survey key or a comment's author. */
import { READ_WINDOWS } from './statistics.mjs';
import { voiceRegistry, RATING_SURVEY } from './surveys.mjs';

export const VOICES_SCHEMA = 'pulseboard.voices/1';
/** Newest feedback rows, newest comments per survey, and rated subjects by count. One row past each cap is read, so
 *  truncation is measured rather than guessed. */
export const FEEDBACK_ROWS = 500, COMMENT_ROWS = 100, RATING_SUBJECTS = 500;
const LIMITATIONS = [
  'Voices are what players chose to send: client-reported and spoofable, and never a sample of all players.',
  'A survey key is an installation (one browser on one device), not a person; clearing site data or resetting the key creates a new respondent.',
  'Each installation counts once per survey and puzzle with its latest answers; the window is by the day of the last update, not the first answer.',
  'Links, e-mail addresses, IP addresses and phone-number-like runs are removed from text on the server; redaction is best effort, not a guarantee that text carries nothing personal.',
  'Feedback shows the newest 500 messages in the window and each survey its newest 100 comments; ratings list the 500 puzzles with the most ratings, while family and tier totals count every rating.',
  'A question that allows several answers can sum above its respondents; an optional question someone skipped is not counted for them.',
  'Family and tier are sent with each rating by the player\'s app; a puzzle reported with different values appears once per combination.',
  'Daily buckets are UTC calendar days and today is partial.',
];
function voiceWindow(days, now) {
  if (!READ_WINDOWS.includes(days) || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Unsupported window');
  return { startDay: new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10), endDay: new Date(now).toISOString().slice(0, 10),
    days, timezone: 'UTC', partialToday: true };
}
const W = 'project=? AND day>=? AND day<=?';
const tallies = row => ({ n: Number(row.n), tooEasy: Number(row.tooEasy), justRight: Number(row.justRight), tooHard: Number(row.tooHard), more: Number(row.more) });
const RATING_COLUMNS = `COUNT(*) AS n,
  COUNT(CASE WHEN json_extract(answers,'$.difficulty')='too-easy' THEN 1 END) AS tooEasy,
  COUNT(CASE WHEN json_extract(answers,'$.difficulty')='just-right' THEN 1 END) AS justRight,
  COUNT(CASE WHEN json_extract(answers,'$.difficulty')='too-hard' THEN 1 END) AS tooHard,
  COUNT(CASE WHEN json_extract(answers,'$.more')='yes' THEN 1 END) AS more`;

export async function readVoices(db, { project, days = 7, now = Date.now(), admitted = false } = {}) {
  if (typeof project !== 'string' || !/^[a-z0-9-]{1,64}$/.test(project)) throw new RangeError('Unsupported project');
  const w = voiceWindow(days, now), bind = [project, w.startDay, w.endDay], registry = voiceRegistry(project);
  const surveyIds = registry ? Object.entries(registry.surveys).filter(([, s]) => s.subject === 'none').map(([id]) => id) : [];
  const rating = registry && Object.hasOwn(registry.surveys, RATING_SURVEY) ? registry.surveys[RATING_SURVEY] : null;
  // Surveys without a subject, by optional table alias: the ratings are read separately below.
  const scope = (a = '') => `${a}project=? AND ${a}day>=? AND ${a}day<=? AND ${a}subject='' AND ${a}survey IN (${surveyIds.map(() => '?').join(',')})`;
  const statements = [db.prepare(`SELECT id,day,written,release,kind,route,subject,text,redacted,device,country,browser,os FROM voice_feedback
    WHERE ${W} ORDER BY received DESC, id LIMIT ${FEEDBACK_ROWS + 1}`).bind(...bind)];
  if (surveyIds.length) statements.push(
    db.prepare(`SELECT survey, COUNT(*) AS n FROM voice_survey WHERE ${scope()} GROUP BY survey`).bind(...bind, ...surveyIds),
    db.prepare(`SELECT s.survey, q.key AS question, COUNT(*) AS n FROM voice_survey s, json_each(s.answers) q
      WHERE ${scope('s.')} GROUP BY 1, 2`).bind(...bind, ...surveyIds),
    // `one` answers are strings and `many` answers arrays of strings; the CASE keeps json_each off non-array values.
    db.prepare(`SELECT s.survey, q.key AS question, q.value AS option, COUNT(*) AS n FROM voice_survey s, json_each(s.answers) q
        WHERE ${scope('s.')} AND q.type='text' GROUP BY 1, 2, 3
      UNION ALL
      SELECT s.survey, q.key, o.value, COUNT(*) FROM voice_survey s, json_each(s.answers) q,
        json_each(CASE WHEN q.type='array' THEN q.value ELSE '[]' END) o
        WHERE ${scope('s.')} AND q.type='array' AND o.type='text' GROUP BY 1, 2, 3`)
      .bind(...bind, ...surveyIds, ...bind, ...surveyIds),
    db.prepare(`SELECT survey, comment FROM (SELECT survey, comment, ROW_NUMBER() OVER (PARTITION BY survey ORDER BY received DESC, respondent) AS r
      FROM voice_survey WHERE ${scope()} AND comment<>'') WHERE r<=${COMMENT_ROWS + 1} ORDER BY survey, r`).bind(...bind, ...surveyIds));
  if (rating) statements.push(
    db.prepare(`SELECT subject, json_extract(meta,'$.family') AS family, json_extract(meta,'$.tier') AS tier, ${RATING_COLUMNS}
      FROM voice_survey WHERE ${W} AND survey=? GROUP BY 1, 2, 3 ORDER BY n DESC, subject, family, tier LIMIT ${RATING_SUBJECTS + 1}`).bind(...bind, RATING_SURVEY),
    db.prepare(`SELECT json_extract(meta,'$.family') AS family, ${RATING_COLUMNS} FROM voice_survey WHERE ${W} AND survey=? GROUP BY 1`).bind(...bind, RATING_SURVEY),
    db.prepare(`SELECT json_extract(meta,'$.tier') AS tier, ${RATING_COLUMNS} FROM voice_survey WHERE ${W} AND survey=? GROUP BY 1`).bind(...bind, RATING_SURVEY));
  const results = (await db.batch(statements)).map(result => result.results);
  const feedbackRows = results.shift();
  const [respondentRows, answeredRows, optionRows, commentRows] = surveyIds.length ? results.splice(0, 4) : [[], [], [], []];
  const [subjectRows, familyRows, tierRows] = rating ? results.splice(0, 3) : [[], [], []];

  const surveys = surveyIds.map(id => {
    const questions = registry.surveys[id].questions, comments = commentRows.filter(r => r.survey === id).map(r => r.comment);
    const count = (question, option) => Number(optionRows.find(r => r.survey === id && r.question === question && r.option === option)?.n ?? 0);
    return {
      survey: id, respondents: Number(respondentRows.find(r => r.survey === id)?.n ?? 0),
      // Registry order and registry options only, so an option nobody chose reads 0 rather than disappearing.
      questions: questions.map(q => ({ id: q.id, type: q.type, required: q.required, ...(q.type === 'many' ? { max: q.max } : {}),
        answered: Number(answeredRows.find(r => r.survey === id && r.question === q.id)?.n ?? 0),
        options: q.options.map(option => ({ id: option, n: count(q.id, option) })) })),
      comments: comments.slice(0, COMMENT_ROWS), commentsTruncated: comments.length > COMMENT_ROWS,
    };
  });
  const rollup = (rows, key, values) => values.map(value => ({ [key]: value, ...tallies(rows.find(r => r[key] === value) ?? { n: 0, tooEasy: 0, justRight: 0, tooHard: 0, more: 0 }) }));
  const ratings = rating ? {
    survey: RATING_SURVEY, n: 0,
    subjects: subjectRows.slice(0, RATING_SUBJECTS).map(r => ({ subject: r.subject, family: r.family, tier: r.tier, ...tallies(r) })),
    subjectsTruncated: subjectRows.length > RATING_SUBJECTS,
    families: rollup(familyRows, 'family', rating.meta.family.values),
    tiers: rollup(tierRows, 'tier', rating.meta.tier.values),
  } : null;
  // Every stored rating carries a registered family and tier, so both roll-ups sum to the same total.
  if (ratings) ratings.n = ratings.families.reduce((sum, r) => sum + r.n, 0);
  return {
    schema: VOICES_SCHEMA, project, generatedAt: now, window: w, collectionAdmitted: admitted,
    population: 'player-initiated feedback, survey answers and puzzle ratings', limitations: LIMITATIONS,
    feedback: feedbackRows.slice(0, FEEDBACK_ROWS).map(r => ({ id: r.id, day: r.day, written: r.written, release: r.release, kind: r.kind, route: r.route,
      subject: r.subject, text: r.text, redacted: Number(r.redacted), device: r.device, country: r.country, browser: r.browser, os: r.os })),
    feedbackTruncated: feedbackRows.length > FEEDBACK_ROWS,
    surveys, ratings,
  };
}
