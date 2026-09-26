import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VOICE_REGISTRY, ALIBI_FAMILIES, ALIBI_TIERS, RATING_SURVEY, voiceRegistry } from '../src/surveys.mjs';
import { parseFeedback, parseSurvey, validateFeedback, validateSurvey, redactVoiceText, cleanVoiceText, writtenInWindow, respondentHash,
  FEEDBACK_KINDS, FEEDBACK_TEXT_MAX, COMMENT_MAX, VOICE_DEFAULT_LIMIT, VOICE_GLOBAL_LIMIT, VOICE_GLOBAL_KEY,
  FEEDBACK_RETENTION_DAYS, SURVEY_RETENTION_DAYS } from '../src/voice-contract.mjs';
import { voiceAdmission, exactProjectList } from '../src/admission.mjs';
import { projects } from '../src/projects.mjs';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const ID = '0b8f6c7e-3f1a-4d8e-9c55-2a1d9e7b6f10', KEY = '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2';
const feedback = (extra = {}) => ({ v: 1, id: ID, release: '0.15.0', kind: 'bug', route: 'puzzle', subject: 'vault-binary-04',
  text: "The last row won't accept a moon even though the row has room.", written: '2026-09-27', context: { device: 'mobile' }, ...extra });
const taste = (extra = {}) => ({ v: 1, survey: 'alibi-taste-1', subject: '', respondent: KEY, release: '0.15.0',
  answers: { often: 'weekly', more: ['sudoku', 'scene'], difficulty: 'mostly-right' }, meta: {}, comment: '', context: { device: 'mobile' }, ...extra });
const rating = (extra = {}) => ({ v: 1, survey: 'puzzle-rating', subject: 'vault-binary-04', respondent: KEY, release: '0.15.0',
  answers: { difficulty: 'just-right', more: 'yes' }, meta: { family: 'binary', tier: 'tricky' }, comment: '', context: { device: 'desktop' }, ...extra });
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

test('the registry holds exactly the two Alibi surveys, the route vocabulary and the enums as tabled', () => {
  assert.deepEqual(Object.keys(VOICE_REGISTRY), ['alibi']);
  const alibi = voiceRegistry('alibi');
  assert.deepEqual(alibi.routes, ['home', 'puzzle', 'castle', 'quiet-wing', 'games', 'settings', 'other']);
  assert.deepEqual(Object.keys(alibi.surveys), ['alibi-taste-1', 'puzzle-rating']);
  assert.equal(RATING_SURVEY, 'puzzle-rating');
  assert.deepEqual(ALIBI_FAMILIES, ['bridges', 'scene', 'dossier', 'witness', 'sudoku', 'nonogram', 'binary', 'futoshiki', 'lightup', 'tents', 'aquarium', 'network', 'trail']);
  assert.deepEqual(ALIBI_TIERS, ['gentle', 'steady', 'tricky', 'expert', 'master', 'grandmaster']);
  const t = alibi.surveys['alibi-taste-1'];
  assert.equal(t.subject, 'none'); assert.equal(t.comment, true); assert.deepEqual(t.meta, {});
  assert.deepEqual(t.questions.map(q => [q.id, q.type, q.required, q.max ?? null]),
    [['often', 'one', true, null], ['more', 'many', false, 5], ['difficulty', 'one', true, null], ['tiers', 'many', false, 3],
      ['next', 'one', false, null], ['feel', 'one', false, null], ['recommend', 'one', false, null]]);
  assert.deepEqual(t.questions[0].options, ['daily', 'few-a-week', 'weekly', 'now-and-then', 'first-time']);
  assert.deepEqual(t.questions[1].options, [...ALIBI_FAMILIES, 'archive-heist', 'borough', 'duel', 'block-cabinet', 'gardens', 'casebooks', 'castle']);
  assert.deepEqual(t.questions[2].options, ['too-easy', 'mostly-right', 'too-hard', 'mixed']);
  assert.deepEqual(t.questions[3].options, ALIBI_TIERS);
  assert.deepEqual(t.questions[4].options, ['more-puzzles', 'harder-puzzles', 'new-families', 'more-story', 'club-games', 'polish']);
  assert.deepEqual(t.questions[5].options, ['love-it', 'fine', 'cluttered', 'confusing']);
  assert.deepEqual(t.questions[6].options, ['definitely', 'probably', 'not-sure', 'probably-not']);
  const r = alibi.surveys['puzzle-rating'];
  assert.equal(r.subject, 'puzzle'); assert.equal(r.comment, false);
  assert.deepEqual(r.meta, { family: { required: true, values: ALIBI_FAMILIES }, tier: { required: true, values: ALIBI_TIERS } });
  assert.deepEqual(r.questions, [{ id: 'difficulty', type: 'one', required: true, options: ['too-easy', 'just-right', 'too-hard'] },
    { id: 'more', type: 'one', required: false, options: ['yes'] }]);
  assert.ok(Object.isFrozen(VOICE_REGISTRY) && Object.isFrozen(t.questions[1].options) && Object.isFrozen(r.meta.family.values));
  for (const id of ['mdviewer', 'nope', '__proto__', 'constructor', 7]) assert.equal(voiceRegistry(id), null, String(id));
  assert.deepEqual(FEEDBACK_KINDS, ['bug', 'idea', 'puzzle', 'praise', 'other']);
  assert.equal(VOICE_DEFAULT_LIMIT, 300); assert.equal(VOICE_GLOBAL_KEY, '*:voice'); assert.ok(VOICE_GLOBAL_LIMIT > 0);
  assert.equal(FEEDBACK_RETENTION_DAYS, 365); assert.equal(SURVEY_RETENTION_DAYS, 400);
});

test('the example feedback is accepted and returned as the record to store', () => {
  assert.deepEqual(parseFeedback(feedback(), 'alibi', NOW), { id: ID, release: '0.15.0', kind: 'bug', route: 'puzzle', subject: 'vault-binary-04',
    text: "The last row won't accept a moon even though the row has room.", redacted: 0, written: '2026-09-27', device: 'mobile' });
  for (const kind of FEEDBACK_KINDS) assert.equal(validateFeedback(feedback({ kind }), 'alibi', NOW), true, kind);
  for (const route of voiceRegistry('alibi').routes) assert.equal(validateFeedback(feedback({ route }), 'alibi', NOW), true, route);
  for (const device of ['mobile', 'tablet', 'desktop']) assert.equal(validateFeedback(feedback({ context: { device } }), 'alibi', NOW), true, device);
  assert.equal(validateFeedback(feedback({ subject: '' }), 'alibi', NOW), true, 'no subject');
  assert.equal(validateFeedback(feedback({ subject: '0' }), 'alibi', NOW), true);
  assert.equal(validateFeedback(feedback({ subject: 'a' + 'b'.repeat(63) }), 'alibi', NOW), true);
  assert.equal(validateFeedback(feedback({ release: 'a'.repeat(32) }), 'alibi', NOW), true);
  assert.equal(validateFeedback(feedback({ release: '0.15.0+build.7-rc' }), 'alibi', NOW), true);
});

test('feedback refuses extra or missing keys at every level and every out-of-contract value', () => {
  const bad = [
    null, [], 'text', { ...feedback(), extra: 1 }, { ...feedback(), __proto__: null }, JSON.parse(JSON.stringify(feedback()).replace('{', '{"__proto__":{},')),
    ...['v', 'id', 'release', 'kind', 'route', 'subject', 'text', 'written', 'context'].map(key => without(feedback(), key)),
    feedback({ v: 2 }), feedback({ v: '1' }), feedback({ v: 1.0000001 }),
    feedback({ id: 'not-a-uuid' }), feedback({ id: ID.toUpperCase() }), feedback({ id: '0b8f6c7e-3f1a-1d8e-9c55-2a1d9e7b6f10' }),
    feedback({ id: '0b8f6c7e-3f1a-4d8e-7c55-2a1d9e7b6f10' }), feedback({ id: 7 }),
    feedback({ release: '' }), feedback({ release: 'a'.repeat(33) }), feedback({ release: '0.15 beta' }), feedback({ release: 15 }),
    feedback({ kind: 'Bug' }), feedback({ kind: 'complaint' }), feedback({ kind: '' }), feedback({ kind: ['bug'] }),
    feedback({ route: 'store' }), feedback({ route: 'Puzzle' }), feedback({ route: '/puzzle' }), feedback({ route: null }),
    feedback({ subject: 'Vault' }), feedback({ subject: '-vault' }), feedback({ subject: 'vault_04' }), feedback({ subject: 'a'.repeat(65) }),
    feedback({ subject: null }), feedback({ subject: 4 }), feedback({ subject: ' ' }),
    feedback({ text: '' }), feedback({ text: '   \n\t ' }), feedback({ text: '\u0000\u0001' }), feedback({ text: 'x'.repeat(FEEDBACK_TEXT_MAX + 1) }),
    feedback({ text: 42 }), feedback({ text: ['text'] }), feedback({ text: null }),
    feedback({ written: '2026-9-27' }), feedback({ written: '27-09-2026' }), feedback({ written: '2026-02-30' }), feedback({ written: '2026-09-27T00:00:00Z' }),
    feedback({ written: '2026-09-29' }), feedback({ written: '2026-08-27' }), feedback({ written: 20260927 }), feedback({ written: '' }),
    feedback({ context: {} }), feedback({ context: { device: 'phone' } }), feedback({ context: { device: 'mobile', scheme: 'dark' } }),
    feedback({ context: null }), feedback({ context: 'mobile' }), feedback({ context: { device: 'Mobile' } }),
  ];
  for (const body of bad) assert.equal(parseFeedback(body, 'alibi', NOW), null, JSON.stringify(body)?.slice(0, 160));
  // A project without a voice registry entry has no vocabulary to accept anything against.
  assert.equal(parseFeedback(feedback(), 'mdviewer', NOW), null);
  assert.equal(parseFeedback(feedback(), 'nope', NOW), null);
});

test('text is cleaned before the 1-2000 check: controls become spaces, newlines and tabs stay, ends are trimmed', () => {
  assert.equal(cleanVoiceText('  a\u0000b\u0007c\rd\u007fe\u0085f\ng\th  '), 'a b c d e f\ng\th');
  assert.equal(parseFeedback(feedback({ text: '  line one\nline two\ttabbed\u0000end  ' }), 'alibi', NOW).text, 'line one\nline two\ttabbed end');
  // Exactly 2000 after trimming is accepted even when the sent string is longer.
  const edge = parseFeedback(feedback({ text: '   ' + 'x'.repeat(FEEDBACK_TEXT_MAX) + '\n\n' }), 'alibi', NOW);
  assert.equal(edge.text.length, FEEDBACK_TEXT_MAX);
  assert.equal(parseFeedback(feedback({ text: 'x' }), 'alibi', NOW).text, 'x');
  // Length is counted in UTF-16 units, as a text area's maxlength counts it.
  assert.equal(validateFeedback(feedback({ text: '😀'.repeat(1000) }), 'alibi', NOW), true);
  assert.equal(validateFeedback(feedback({ text: '😀'.repeat(1000) + 'x' }), 'alibi', NOW), false);
});

test('written is a real UTC day from 30 days before the receipt day to one day after it', () => {
  const at = Date.parse('2026-09-27T23:59:59Z');
  for (const day of ['2026-09-28', '2026-09-27', '2026-08-28']) assert.equal(writtenInWindow(day, at), true, day);
  for (const day of ['2026-09-29', '2026-08-27', '2026-02-29', '2026-13-01', '0000-00-00']) assert.equal(writtenInWindow(day, at), false, day);
  const midnight = Date.parse('2026-09-27T00:00:00Z');
  assert.equal(writtenInWindow('2026-09-28', midnight), true);
  assert.equal(writtenInWindow('2026-08-28', midnight), true);
  assert.equal(writtenInWindow('2024-02-29', Date.parse('2024-03-01T00:00:00Z')), true, 'a real leap day');
});

test('e-mail addresses, IP addresses, links and phone-number-like runs are replaced and counted', () => {
  const cases = [
    ['write to jane.doe+alibi@example.co.uk please', 'write to [email] please', 1],
    ['my ip is 192.168.1.10.', 'my ip is [ip].', 1],
    ['v6 2001:db8::8a2e:370:7334 and ::ffff:10.0.0.1', 'v6 [ip] and [ip]', 2],
    ['see https://example.com/a?b=c#d, then', 'see [link], then', 1],
    ['(http://user:pw@host.test/x)', '([link])', 1],
    ['go to www.example.org/page now', 'go to [link] now', 1],
    ['call +44 7700 900123 today', 'call [phone] today', 1],
    ['or (555) 123-4567', 'or [phone]', 1],
    ['or 555-123-4567 or 555.123.4567', 'or [phone] or [phone]', 2],
    ['mobile 07700900123', 'mobile [phone]', 1],
    ['local 555-1234', 'local [phone]', 1],
    ['card 4111111111111111 no', 'card [phone] no', 1],
    ['a@b.co and https://x.test and 10.0.0.1 and +1 202 555 0143', '[email] and [link] and [ip] and [phone]', 4],
  ];
  for (const [input, expected, count] of cases) assert.deepEqual(redactVoiceText(input, 2000), { text: expected, redacted: count }, input);
});

test('dates, times, versions, puzzle ids and ordinary numbers are not mistaken for phone numbers', () => {
  const kept = ['On 2026-09-27 at 12:30:45 it broke', 'on 27/09/2026 and 09.27.2026 and 2026/09/27', 'release 0.15.0 and 0.14.1',
    'vault-binary-04 and castle-3', 'I did 12 puzzles in 45 minutes', 'scored 1234567 points', 'rows 1 2 3', 'grid 10x10 in 3:45',
    'version v1.2.3', 'no personal text here'];
  for (const text of kept) assert.deepEqual(redactVoiceText(text, 2000), { text, redacted: 0 }, text);
  // A date keeps its place while a phone number beside it is still removed.
  assert.deepEqual(redactVoiceText('2026-09-27: call 020 7946 0958', 2000), { text: '2026-09-27: call [phone]', redacted: 1 });
  // A dotted quad is IP-shaped wherever it appears, as in product-event props.
  assert.deepEqual(redactVoiceText('version v1.2.3.4', 2000), { text: 'version v[ip]', redacted: 1 });
});

test('redacted text is cut back to the bound when markers make it longer', () => {
  // 'a@b.co' is six characters and '[email]' seven, so a 2,000-character text becomes 2,001 before the cut.
  const text = 'x'.repeat(1993) + ' a@b.co';
  assert.equal(text.length, FEEDBACK_TEXT_MAX);
  const stored = parseFeedback(feedback({ text }), 'alibi', NOW);
  assert.equal(stored.redacted, 1);
  assert.equal(stored.text.length, FEEDBACK_TEXT_MAX);
  assert.ok(stored.text.endsWith(' [email'));
  const emoji = redactVoiceText('😀'.repeat(996) + ' a@b.co', 1999);
  assert.equal(emoji.text.length, 1999);
  assert.ok(!/[\ud800-\udbff]$/.test(emoji.text), 'never ends in half of a surrogate pair');
});

test('the example survey is accepted with answers in registry order and an empty optional many dropped', () => {
  const stored = parseSurvey(taste({ answers: { difficulty: 'mostly-right', more: ['scene', 'sudoku'], tiers: [], often: 'weekly' } }), 'alibi');
  assert.deepEqual(stored, { survey: 'alibi-taste-1', subject: '', respondent: KEY, release: '0.15.0',
    answers: '{"often":"weekly","more":["scene","sudoku"],"difficulty":"mostly-right"}', meta: '{}', comment: '', redacted: 0, device: 'mobile' });
  const full = parseSurvey(taste({ answers: { often: 'daily', more: ['castle', 'bridges', 'duel', 'trail', 'gardens'], difficulty: 'mixed',
    tiers: ['master', 'gentle', 'expert'], next: 'polish', feel: 'love-it', recommend: 'probably-not' }, comment: 'More castles!' }), 'alibi');
  assert.equal(full.answers, '{"often":"daily","more":["bridges","trail","duel","gardens","castle"],"difficulty":"mixed","tiers":["gentle","expert","master"],"next":"polish","feel":"love-it","recommend":"probably-not"}');
  assert.equal(full.comment, 'More castles!');
  assert.deepEqual(parseSurvey(rating(), 'alibi'), { survey: 'puzzle-rating', subject: 'vault-binary-04', respondent: KEY, release: '0.15.0',
    answers: '{"difficulty":"just-right","more":"yes"}', meta: '{"family":"binary","tier":"tricky"}', comment: '', redacted: 0, device: 'desktop' });
  // Meta keys are stored in declaration order whatever order they were sent in.
  assert.equal(parseSurvey(rating({ meta: { tier: 'master', family: 'trail' }, answers: { difficulty: 'too-hard' } }), 'alibi').meta, '{"family":"trail","tier":"master"}');
  for (const family of ALIBI_FAMILIES) for (const tier of ALIBI_TIERS) assert.equal(validateSurvey(rating({ meta: { family, tier } }), 'alibi'), true);
});

test('surveys refuse unknown surveys, questions, options, meta and every other out-of-contract value', () => {
  const answers = extra => taste({ answers: { often: 'weekly', difficulty: 'mostly-right', ...extra } });
  const bad = [
    null, [], { ...taste(), extra: 1 }, JSON.parse(JSON.stringify(taste()).replace('{', '{"__proto__":{},')),
    ...['v', 'survey', 'subject', 'respondent', 'release', 'answers', 'meta', 'comment', 'context'].map(key => without(taste(), key)),
    taste({ v: 2 }), taste({ survey: 'alibi-taste-2' }), taste({ survey: 'constructor' }), taste({ survey: 'toString' }), taste({ survey: '' }), taste({ survey: 1 }),
    // Subject: none-surveys take exactly '', puzzle-surveys need an id.
    taste({ subject: 'vault-binary-04' }), taste({ subject: ' ' }), taste({ subject: null }),
    rating({ subject: '' }), rating({ subject: 'Vault' }), rating({ subject: 'a'.repeat(65) }), rating({ subject: 3 }),
    // Respondent is a lower-case UUID v4.
    taste({ respondent: KEY.toUpperCase() }), taste({ respondent: '5f0a0c2e-8f7d-1b61-a3d4-0a8e77b1c9d2' }), taste({ respondent: '' }), taste({ respondent: null }),
    taste({ release: '' }), taste({ release: 'x y' }),
    // Answers.
    taste({ answers: [] }), taste({ answers: null }), taste({ answers: 'weekly' }),
    answers({ unknown: 'x' }), taste({ answers: JSON.parse('{"often":"weekly","difficulty":"mostly-right","__proto__":"x"}') }), without(taste(), 'answers'),
    taste({ answers: { difficulty: 'mostly-right' } }), taste({ answers: { often: 'weekly' } }),
    answers({ often: 'hourly' }), answers({ often: ['weekly'] }), answers({ often: '' }), answers({ often: null }),
    answers({ more: 'sudoku' }), answers({ more: ['sudoku', 'sudoku'] }), answers({ more: ['chess'] }), answers({ more: [1] }),
    answers({ more: ['bridges', 'scene', 'dossier', 'witness', 'sudoku', 'nonogram'] }), answers({ tiers: ['gentle', 'steady', 'tricky', 'expert'] }),
    answers({ tiers: ['legendary'] }), answers({ next: 'everything' }), answers({ feel: ['fine'] }), answers({ recommend: 'yes' }),
    rating({ answers: { more: 'yes' } }), rating({ answers: { difficulty: 'mostly-right' } }), rating({ answers: { difficulty: 'just-right', more: 'no' } }),
    rating({ answers: { difficulty: 'just-right', more: true } }), rating({ answers: { difficulty: 'just-right', often: 'weekly' } }),
    // Meta: declared keys and values only; the rating's family and tier are required.
    taste({ meta: { family: 'binary' } }), taste({ meta: null }), taste({ meta: [] }),
    rating({ meta: {} }), rating({ meta: { family: 'binary' } }), rating({ meta: { tier: 'tricky' } }), rating({ meta: { family: 'chess', tier: 'tricky' } }),
    rating({ meta: { family: 'binary', tier: 'legendary' } }), rating({ meta: { family: 'binary', tier: 'tricky', puzzle: 'x' } }),
    rating({ meta: { family: ['binary'], tier: 'tricky' } }),
    // Comment: a string; at most 500 after cleaning; only where the survey allows one.
    taste({ comment: 'x'.repeat(COMMENT_MAX + 1) }), taste({ comment: null }), taste({ comment: 5 }), rating({ comment: 'lovely' }),
    taste({ context: {} }), taste({ context: { device: 'watch' } }), taste({ context: { device: 'mobile', width: 390 } }),
  ];
  for (const body of bad) assert.equal(parseSurvey(body, 'alibi'), null, JSON.stringify(body)?.slice(0, 200));
  assert.equal(parseSurvey(taste(), 'mdviewer'), null);
  // Edges that are accepted.
  assert.equal(parseSurvey(taste({ comment: '  ' + 'y'.repeat(COMMENT_MAX) + '\n' }), 'alibi').comment.length, COMMENT_MAX);
  assert.equal(parseSurvey(rating({ comment: ' \n ' }), 'alibi').comment, '', 'a blank comment is no comment');
  assert.equal(validateSurvey(answers({ more: ['bridges', 'scene', 'dossier', 'witness', 'sudoku'], tiers: ['gentle', 'steady', 'tricky'] }), 'alibi'), true);
  assert.equal(validateSurvey(rating({ answers: { difficulty: 'too-easy' } }), 'alibi'), true, 'the heart is optional');
});

test('survey comments get the same cleaning and redaction as feedback', () => {
  const stored = parseSurvey(taste({ comment: '  Love it!\u0000 Mail me at a.b@example.com or call 07700 900123 \n' }), 'alibi');
  assert.equal(stored.comment, 'Love it!  Mail me at [email] or call [phone]');
  assert.equal(stored.redacted, 2);
});

test('the stored respondent is SHA-256 of project and key, and differs per project', async () => {
  const expected = createHash('sha256').update('alibi:' + KEY).digest('hex');
  assert.equal(await respondentHash('alibi', KEY), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.notEqual(await respondentHash('mdviewer', KEY), expected);
  assert.ok(!expected.includes(KEY.replaceAll('-', '').slice(0, 12)));
});

test('the voice switch is an exact list of registered public projects that have a voice registry', () => {
  assert.deepEqual(voiceAdmission({ COLLECT_VOICE_PROJECTS: 'alibi' }), ['alibi']);
  for (const value of [undefined, '', ' alibi', 'alibi ', 'Alibi', 'alibi,alibi', 'alibi,', ',alibi', 'alibi,mdviewer', 'mdviewer', 'taskdeck', 'nope', 'a'.repeat(4097)]) {
    assert.deepEqual(voiceAdmission({ COLLECT_VOICE_PROJECTS: value }), [], String(value).slice(0, 40));
  }
  // The same exact-list parser as the other channels, over the registry narrowed to projects with a voice vocabulary.
  assert.deepEqual(exactProjectList('alibi,mdviewer'), ['alibi', 'mdviewer']);
  assert.deepEqual(voiceAdmission({ COLLECT_VOICE_PROJECTS: 'alibi,mdviewer' }, projects, { alibi: {}, mdviewer: {} }), ['alibi', 'mdviewer']);
  // A registry entry alone is not enough: the project must be registered with a public origin.
  assert.deepEqual(voiceAdmission({ COLLECT_VOICE_PROJECTS: 'taskdeck' }, projects, { taskdeck: {} }), []);
});
