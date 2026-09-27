import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { readVoices, FEEDBACK_ROWS, COMMENT_ROWS, RATING_SUBJECTS, VOICES_SCHEMA } from '../src/voices.mjs';
import { VOICE_REGISTRY } from '../src/surveys.mjs';
import { assets } from '../src/assets.mjs';
import { assertVoices, requestVoices, makeVoicesDemo, voiceKindCounts, VOICE_KINDS, VOICE_DEMO_TASTE, VOICE_DEMO_FAMILIES, VOICE_DEMO_TIERS,
  VOICES_SCHEMA as DESK_SCHEMA, VOICES_MAX_BYTES } from '../public/desk-voices.mjs';

const ORIGIN = projects.alibi.origin, TOKEN = 't'.repeat(32), DAY = 86400000;
function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = (DB, extra = {}) => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_VOICE_PROJECTS: 'alibi', READ_TOKEN: TOKEN, ...extra });
const key = i => `5f0a0c2e-8f7d-4b61-a3d4-${String(i).padStart(12, '0')}`, id = i => `0b8f6c7e-3f1a-4d8e-9c55-${String(i).padStart(12, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const write = (DB, kind, body) => handle(new Request(`https://collector.example/v1/${kind}/alibi`, { method: kind === 'feedback' ? 'POST' : 'PUT',
  headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env(DB));
const read = (DB, path, token = TOKEN, extra = {}) => handle(new Request('https://desk.test' + path, { headers: token ? { authorization: 'Bearer ' + token } : {} }), env(DB, extra));
const feedback = (i, extra = {}) => ({ v: 1, id: id(i), release: '0.15.0', kind: 'bug', route: 'puzzle', subject: '', text: `Message ${i}`, written: today(), context: { device: 'mobile' }, ...extra });
const taste = (i, answers, comment = '') => ({ v: 1, survey: 'alibi-taste-1', subject: '', respondent: key(i), release: '0.15.0', answers, meta: {}, comment, context: { device: 'mobile' } });
const rating = (i, subject, family, tier, answers) => ({ v: 1, survey: 'puzzle-rating', subject, respondent: key(i), release: '0.15.0', answers, meta: { family, tier }, comment: '', context: { device: 'desktop' } });
const pause = () => new Promise(resolve => setTimeout(resolve, 3));

test('the voices read returns feedback, survey bars, comments and ratings from what players sent, and no respondent', async t => {
  const DB = database(t);
  for (const [i, kind] of [[1, 'bug'], [2, 'idea'], [3, 'praise']]) { assert.equal((await write(DB, 'feedback', feedback(i, { kind, text: `Message ${i}\nsecond line` }))).status, 202); await pause(); }
  assert.equal((await write(DB, 'survey', taste(1, { often: 'weekly', more: ['sudoku', 'scene'], difficulty: 'mostly-right' }, 'First thoughts'))).status, 202);
  await pause();
  assert.equal((await write(DB, 'survey', taste(2, { often: 'daily', more: ['sudoku', 'castle', 'duel'], difficulty: 'too-hard', feel: 'love-it' }, 'More castles'))).status, 202);
  await pause();
  // Respondent 1 changes their mind: they still count once, with the latest answers and comment.
  assert.equal((await write(DB, 'survey', taste(1, { often: 'daily', difficulty: 'mostly-right', tiers: ['gentle'] }, 'Updated thoughts'))).status, 202);
  for (const [i, subject, family, tier, answers] of [[1, 'vault-binary-04', 'binary', 'tricky', { difficulty: 'too-hard', more: 'yes' }],
    [2, 'vault-binary-04', 'binary', 'tricky', { difficulty: 'just-right' }], [3, 'vault-binary-04', 'binary', 'tricky', { difficulty: 'too-hard', more: 'yes' }],
    [1, 'castle-3', 'bridges', 'gentle', { difficulty: 'too-easy' }], [1, 'castle-3', 'bridges', 'gentle', { difficulty: 'just-right', more: 'yes' }]]) {
    assert.equal((await write(DB, 'survey', rating(i, subject, family, tier, answers))).status, 202);
  }
  const response = await read(DB, '/v1/voices/alibi?days=7');
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.schema, 'pulseboard.voices/1'); assert.equal(body.project, 'alibi'); assert.equal(body.collectionAdmitted, true);
  assert.deepEqual(body.feedback.map(f => [f.kind, f.text]), [['praise', 'Message 3\nsecond line'], ['idea', 'Message 2\nsecond line'], ['bug', 'Message 1\nsecond line']]);
  assert.deepEqual(Object.keys(body.feedback[0]), ['id', 'day', 'written', 'release', 'kind', 'route', 'subject', 'text', 'redacted', 'device', 'country', 'browser', 'os']);
  assert.equal(body.feedbackTruncated, false);
  const [survey] = body.surveys;
  assert.equal(body.surveys.length, 1); assert.equal(survey.survey, 'alibi-taste-1');
  assert.equal(survey.respondents, 2, 'one installation counts once however often it resubmits');
  const q = Object.fromEntries(survey.questions.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(q), ['often', 'more', 'difficulty', 'tiers', 'next', 'feel', 'recommend'], 'registry order');
  assert.deepEqual(q.often.options.filter(o => o.n), [{ id: 'daily', n: 2 }]);
  assert.equal(q.often.options.length, 5, 'options nobody chose still read 0');
  assert.equal(q.often.answered, 2); assert.equal(q.often.required, true);
  // Respondent 1 dropped `more` in the update, so only respondent 2's three choices remain.
  assert.deepEqual(q.more.options.filter(o => o.n).map(o => o.id), ['sudoku', 'duel', 'castle']);
  assert.equal(q.more.answered, 1); assert.equal(q.more.max, 5); assert.equal(q.more.type, 'many');
  assert.deepEqual(q.difficulty.options.filter(o => o.n), [{ id: 'mostly-right', n: 1 }, { id: 'too-hard', n: 1 }]);
  assert.deepEqual(q.tiers.options.filter(o => o.n), [{ id: 'gentle', n: 1 }]);
  assert.equal(q.feel.answered, 1); assert.equal(q.recommend.answered, 0);
  assert.deepEqual(survey.comments, ['Updated thoughts', 'More castles'], 'newest first, text only');
  const r = body.ratings;
  assert.equal(r.survey, 'puzzle-rating'); assert.equal(r.n, 4, 'four installation and puzzle pairs');
  assert.deepEqual(r.subjects, [
    { subject: 'vault-binary-04', family: 'binary', tier: 'tricky', n: 3, tooEasy: 0, justRight: 1, tooHard: 2, more: 2 },
    { subject: 'castle-3', family: 'bridges', tier: 'gentle', n: 1, tooEasy: 0, justRight: 1, tooHard: 0, more: 1 }]);
  assert.deepEqual(r.families.map(f => f.family), VOICE_REGISTRY.alibi.surveys['puzzle-rating'].meta.family.values);
  assert.deepEqual(r.families.find(f => f.family === 'binary'), { family: 'binary', n: 3, tooEasy: 0, justRight: 1, tooHard: 2, more: 2 });
  assert.deepEqual(r.families.find(f => f.family === 'sudoku'), { family: 'sudoku', n: 0, tooEasy: 0, justRight: 0, tooHard: 0, more: 0 });
  assert.deepEqual(r.tiers.find(x => x.tier === 'gentle'), { tier: 'gentle', n: 1, tooEasy: 0, justRight: 1, tooHard: 0, more: 1 });
  // No survey key or respondent hash ever leaves the collector.
  const text = JSON.stringify(body);
  for (let i = 1; i <= 3; i++) {
    assert.ok(!text.includes(key(i)), 'raw key');
    assert.ok(!text.includes(createHash('sha256').update('alibi:' + key(i)).digest('hex')), 'hash');
  }
  assert.doesNotMatch(text, /"(?:respondent|submissions|first_received|received|meta|answers)":/, 'no per-respondent field is returned');
  assert.equal(assertVoices(body, 7, 'alibi'), body, 'the Desk accepts the collector read');
});

test('the window is by last update day and every list is capped with measured truncation', async t => {
  const DB = database(t), now = Date.UTC(2026, 8, 27, 12);
  const day = offset => new Date(now - offset * DAY).toISOString().slice(0, 10);
  const fb = DB.prepare(`INSERT INTO voice_feedback VALUES(?,?,?,?,?,'0.15.0',?,'home','',?,0,'mobile','GB','chrome','android')`);
  for (let i = 0; i < FEEDBACK_ROWS + 1; i++) await fb.bind('alibi', id(i), now - i * 1000, day(0), day(0), VOICE_KINDS[i % 5], `text ${i}`).run();
  await fb.bind('alibi', id(9000), now - 7 * DAY, day(7), day(7), 'bug', 'outside the 7-day window').run();
  await fb.bind('mdviewer', id(9001), now, day(0), day(0), 'bug', 'another project').run();
  const sv = DB.prepare(`INSERT INTO voice_survey VALUES('alibi',?,?,?,?,?,?,'0.15.0',?,?,?,0,'mobile','GB',1)`);
  for (let i = 0; i < COMMENT_ROWS + 1; i++) await sv.bind('alibi-taste-1', '', `r${i}`, now - 900 * DAY, now - i * 1000, day(0), '{"often":"daily","difficulty":"mixed"}', '{}', `comment ${i}`).run();
  // First answered long ago, updated inside the window: in. Updated before the window: out.
  await sv.bind('alibi-taste-1', '', 'old', now - 900 * DAY, now - 8 * DAY, day(8), '{"often":"weekly","difficulty":"mixed"}', '{}', 'stale').run();
  for (let i = 0; i < RATING_SUBJECTS + 1; i++) await sv.bind('puzzle-rating', `p-${String(i).padStart(4, '0')}`, 'x', now, now, day(1), '{"difficulty":"too-hard"}', '{"family":"trail","tier":"master"}', '').run();
  await sv.bind('puzzle-rating', 'p-0000', 'y', now, now, day(0), '{"difficulty":"too-easy","more":"yes"}', '{"family":"trail","tier":"master"}', '').run();
  const body = await readVoices(DB, { project: 'alibi', days: 7, now, admitted: true });
  assert.equal(body.feedback.length, FEEDBACK_ROWS); assert.equal(body.feedbackTruncated, true);
  assert.equal(body.feedback[0].text, 'text 0'); assert.ok(!body.feedback.some(f => /outside|another/.test(f.text)));
  const [s] = body.surveys;
  assert.equal(s.respondents, COMMENT_ROWS + 1);
  assert.equal(s.comments.length, COMMENT_ROWS); assert.equal(s.commentsTruncated, true); assert.equal(s.comments[0], 'comment 0');
  assert.ok(!s.comments.includes('stale'));
  assert.equal(s.questions[0].options.find(o => o.id === 'daily').n, COMMENT_ROWS + 1);
  assert.equal(s.questions[0].options.find(o => o.id === 'weekly').n, 0, 'the row updated before the window is not counted');
  const r = body.ratings;
  assert.equal(r.subjects.length, RATING_SUBJECTS); assert.equal(r.subjectsTruncated, true);
  assert.deepEqual(r.subjects[0], { subject: 'p-0000', family: 'trail', tier: 'master', n: 2, tooEasy: 1, justRight: 0, tooHard: 1, more: 1 }, 'most rated first');
  assert.equal(r.n, RATING_SUBJECTS + 2, 'roll-ups count every rating, not just the listed puzzles');
  assert.equal(r.families.find(f => f.family === 'trail').n, RATING_SUBJECTS + 2);
  assert.equal(r.tiers.find(x => x.tier === 'master').n, RATING_SUBJECTS + 2);
  assert.equal(assertVoices(body, 7, 'alibi'), body);
  const one = await readVoices(DB, { project: 'alibi', days: 1, now });
  assert.equal(one.ratings.n, 1, 'the one-day window holds only today');
  assert.equal(one.collectionAdmitted, false);
  // The whole read is one D1 batch, so every list shares one snapshot.
  let batches = 0; const counting = { prepare: (...a) => DB.prepare(...a), batch: statements => { batches++; return DB.batch(statements); } };
  await readVoices(counting, { project: 'alibi', days: 7, now });
  assert.equal(batches, 1);
});

test('the voices read authenticates, bounds the window and answers for any public project', async t => {
  const DB = database(t);
  assert.equal((await read(DB, '/v1/voices/alibi?days=7', null)).status, 401);
  assert.equal((await read(DB, '/v1/voices/alibi?days=7', 'x'.repeat(32))).status, 401);
  for (const project of ['taskdeck', 'nope']) assert.equal((await read(DB, `/v1/voices/${project}?days=7`)).status, 404, project);
  for (const query of ['?days=2', '?days=7&days=7', '?days=07', '?days=7&x=1', '?limit=5']) {
    const r = await read(DB, '/v1/voices/alibi' + query);
    assert.equal(r.status, 400, query); assert.deepEqual(await r.json(), { error: 'window', allowedDays: [1, 7, 14, 30, 90] });
  }
  assert.equal((await read(DB, '/v1/voices/alibi')).status, 200, 'seven days by default');
  assert.equal((await read(DB, '/v1/voices/alibi?days=7', TOKEN, { COLLECT_PROJECTS: 'nope' })).status, 503);
  const off = await (await read(DB, '/v1/voices/alibi?days=90', TOKEN, { COLLECT_VOICE_PROJECTS: '' })).json();
  assert.equal(off.collectionAdmitted, false); assert.equal(off.window.days, 90);
  // A public project with no voice registry reads empty, not an error, and the Desk accepts it.
  const md = await (await read(DB, '/v1/voices/mdviewer?days=30')).json();
  assert.deepEqual([md.feedback, md.surveys, md.ratings, md.feedbackTruncated], [[], [], null, false]);
  assert.equal(assertVoices(md, 30, 'mdviewer'), md);
  // Writes to the read path are not a route.
  assert.equal((await handle(new Request('https://desk.test/v1/voices/alibi', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN } }), env(DB))).status, 404);
  assert.equal(VOICES_SCHEMA, DESK_SCHEMA);
});

test('the Desk refuses a voices read outside its closed contract', () => {
  const good = makeVoicesDemo(7, Date.UTC(2026, 8, 27, 12), 'alibi');
  assert.equal(assertVoices(structuredClone(good), 7, 'alibi').mode, 'demo');
  const broken = [
    x => { x.extra = 1; }, x => { x.schema = 'pulseboard.voices/2'; }, x => { x.project = 'mdviewer'; }, x => { x.window.days = 14; },
    x => { x.feedback[0].respondent = 'abc'; }, x => { x.feedback[0].kind = 'rant'; }, x => { x.feedback[0].text = ''; },
    x => { x.feedback[0].text = 'bell\u0007'; }, x => { x.feedback[0].text = 'x'.repeat(2001); }, x => { x.feedback[0].id = 'not-a-uuid'; },
    x => { x.feedback[1].id = x.feedback[0].id; }, x => { x.feedback[0].day = '2020-01-01'; }, x => { x.feedback[0].device = 'watch'; },
    x => { x.feedback = Array.from({ length: 501 }, () => x.feedback[0]); },
    x => { x.surveys[0].respondent = 'abc'; }, x => { x.surveys[0].questions[0].options[0].n += 1; },
    x => { x.surveys[0].questions[0].answered -= 1; }, x => { x.surveys[0].questions[1].options[0].n = x.surveys[0].questions[1].answered + 1; },
    x => { delete x.surveys[0].questions[1].max; }, x => { x.surveys[0].comments.push('a\u0000b'); }, x => { x.surveys[0].comments.push('y'.repeat(501)); },
    x => { x.ratings.n += 1; }, x => { x.ratings.subjects[0].tooHard += 1; }, x => { x.ratings.subjects[0].more = x.ratings.subjects[0].n + 1; },
    x => { x.ratings.families[0].n += 1; x.ratings.families[0].justRight += 1; }, x => { x.ratings.subjects.push({ ...x.ratings.subjects[0] }); },
    x => { x.ratings.subjects[0].respondent = 'abc'; }, x => { x.ratings.subjectsTruncated = 'no'; },
  ];
  for (const change of broken) {
    const copy = structuredClone(good); change(copy);
    assert.throws(() => assertVoices(copy, 7, 'alibi'), TypeError, change.toString());
  }
  // Newlines and tabs are the player's own and stay; the Desk renders them as text.
  const text = structuredClone(good); text.feedback[0].text = 'one\n\ttwo';
  assert.equal(assertVoices(text, 7, 'alibi').feedback[0].text, 'one\n\ttwo');
});

test('the sandbox Voices are deterministic, pass the contract in every window and mirror the collector registry', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  for (const days of [1, 7, 14, 30, 90]) for (const project of ['alibi', 'mdviewer']) {
    const demo = makeVoicesDemo(days, now, project);
    assert.equal(assertVoices(demo, days, project), demo, `${project} ${days}`);
    assert.deepEqual(makeVoicesDemo(days, now, project), demo, 'deterministic');
  }
  const demo = makeVoicesDemo(7, now, 'alibi');
  assert.ok(demo.feedback.some(f => f.text.includes('<img src=x onerror=alert(1)>')), 'the sandbox carries a markup payload the view must render as text');
  const registry = VOICE_REGISTRY.alibi.surveys;
  assert.deepEqual(JSON.parse(JSON.stringify(VOICE_DEMO_TASTE)), JSON.parse(JSON.stringify(registry['alibi-taste-1'].questions)));
  assert.deepEqual([...VOICE_DEMO_FAMILIES], [...registry['puzzle-rating'].meta.family.values]);
  assert.deepEqual([...VOICE_DEMO_TIERS], [...registry['puzzle-rating'].meta.tier.values]);
  assert.deepEqual(voiceKindCounts(demo.feedback).map(k => k.kind), VOICE_KINDS);
  assert.equal(voiceKindCounts(demo.feedback).reduce((sum, k) => sum + k.n, 0), demo.feedback.length);
});

test('the Desk requests voices with the token in a header only, and serves its module from the asset allowlist', async () => {
  const calls = [];
  await requestVoices((url, init) => { calls.push([url, init]); return Promise.resolve(new Response('{}')); }, { project: 'alibi', token: 'secret-token', days: 30 });
  assert.equal(calls[0][0], '/v1/voices/alibi?days=30');
  assert.deepEqual(calls[0][1].headers, { authorization: 'Bearer secret-token' });
  assert.equal(calls[0][1].credentials, 'omit'); assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].cache, 'no-store');
  assert.throws(() => requestVoices(() => {}, { project: 'Alibi', token: 't', days: 7 }), TypeError);
  assert.throws(() => requestVoices(() => {}, { project: 'alibi', token: 't', days: 3 }), TypeError);
  assert.deepEqual(assets.get('/desk-voices.mjs'), ['desk-voices.mjs', 'text/javascript; charset=utf-8']);
  assert.ok(VOICES_MAX_BYTES >= 4 * 1048576);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<a href="#voices" data-view="voices">.*Voices<kbd>7<\/kbd><\/a>/);
  const dashboard = readFileSync(new URL('../public/dashboard.mjs', import.meta.url), 'utf8');
  assert.match(dashboard, /\/\^\[1-7\]\$\//, 'number keys reach the seventh view');
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf('function voicesView')), /innerHTML|insertAdjacentHTML|outerHTML/);
});
