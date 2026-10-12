import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { voiceAdmission } from '../src/admission.mjs';
import { VOICE_DEFAULT_LIMIT, VOICE_GLOBAL_LIMIT, VOICE_GLOBAL_KEY } from '../src/voice-contract.mjs';
import { startLocalRunner } from '../src/local.mjs';

const ORIGIN = projects.alibi.origin, TOKEN = 't'.repeat(32);
const KEY = '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2', OTHER_KEY = '9c1d7e2a-4b3f-4a5e-8d6c-1f2e3d4c5b6a';
const today = () => new Date().toISOString().slice(0, 10);
function database(t) {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  return DB;
}
const env = (DB, extra = {}) => ({ DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: 'alibi', COLLECT_VOICE_PROJECTS: 'alibi', READ_TOKEN: TOKEN, ...extra });
let counter = 0;
const uuid = () => `0b8f6c7e-3f1a-4d8e-9c55-${String(++counter).padStart(12, '0')}`;
const feedback = (extra = {}) => ({ v: 1, id: uuid(), release: '0.15.0', kind: 'bug', route: 'puzzle', subject: 'vault-binary-04',
  text: "The last row won't accept a moon even though the row has room.", written: today(), context: { device: 'mobile' }, ...extra });
const taste = (extra = {}) => ({ v: 1, survey: 'alibi-taste-1', subject: '', respondent: KEY, release: '0.15.0',
  answers: { often: 'weekly', more: ['sudoku', 'scene'], difficulty: 'mostly-right' }, meta: {}, comment: '', context: { device: 'mobile' }, ...extra });
const rating = (extra = {}) => ({ v: 1, survey: 'puzzle-rating', subject: 'vault-binary-04', respondent: KEY, release: '0.15.0',
  answers: { difficulty: 'just-right', more: 'yes' }, meta: { family: 'binary', tier: 'tricky' }, comment: '', context: { device: 'desktop' }, ...extra });
function send(kind, body, { id = 'alibi', origin = ORIGIN, headers = {}, cf, method, query = '' } = {}) {
  const verb = method ?? (kind === 'feedback' ? 'POST' : 'PUT');
  const request = new Request(`https://collector.example/v1/${kind}/${id}${query}`, { method: verb,
    headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json', ...headers },
    ...(['POST', 'PUT'].includes(verb) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  if (cf) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}
const all = async (DB, table) => (await DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results.map(r => ({ ...r }));
const used = async (DB, key) => (await DB.prepare('SELECT used FROM budget WHERE project=? AND day=?').bind(key, today()).first())?.used ?? null;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

test('feedback is stored with server-derived country, browser and OS, and no request strings', async t => {
  const DB = database(t), body = feedback({ text: '  Row 3 is broken.\nMail me: jane@example.com  ' });
  const response = await handle(send('feedback', body, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB' }, cf: { country: 'GB', regionCode: 'ENG' } }), env(DB));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, duplicate: false });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN); assert.equal(response.headers.get('Vary'), 'Origin');
  const [row] = await all(DB, 'voice_feedback');
  const { received, ...rest } = row;
  assert.ok(Math.abs(received - Date.now()) < 60000);
  assert.deepEqual(rest, { project: 'alibi', id: body.id, day: today(), written: today(), release: '0.15.0', kind: 'bug', route: 'puzzle',
    subject: 'vault-binary-04', text: 'Row 3 is broken.\nMail me: [email]', redacted: 1, device: 'mobile', country: 'GB', browser: 'chrome', os: 'android' });
  const everything = JSON.stringify(await all(DB, 'voice_feedback'));
  for (const secret of ['Mozilla', 'jane@example.com', 'en-GB', 'GB-ENG']) assert.ok(!everything.includes(secret), secret);
  assert.equal(await used(DB, 'alibi:voice'), 1); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 1);
  for (const table of ['events', 'product_events', 'statistics', 'statistics_dimensions', 'voice_survey']) {
    assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, table);
  }
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM budget WHERE project IN ('alibi','alibi:product')").first()).n, 0, 'other budgets untouched');
});

test('a resent feedback id is accepted as a duplicate, stores nothing and charges no budget, even with the budget full', async t => {
  const DB = database(t), body = feedback();
  assert.deepEqual(await (await handle(send('feedback', body), env(DB))).json(), { accepted: true, duplicate: false });
  const again = await handle(send('feedback', { ...body, text: 'A different text under the same id', kind: 'idea' }), env(DB));
  assert.equal(again.status, 202);
  assert.deepEqual(await again.json(), { accepted: true, duplicate: true });
  assert.equal((await all(DB, 'voice_feedback')).length, 1);
  assert.equal((await all(DB, 'voice_feedback'))[0].kind, 'bug', 'the first stored copy wins');
  assert.equal(await used(DB, 'alibi:voice'), 1); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 1);
  // Full project budget: a new id is refused, the stored id still answers duplicate and nothing is charged.
  await DB.prepare('UPDATE budget SET used=? WHERE project=?').bind(VOICE_DEFAULT_LIMIT, 'alibi:voice').run();
  const refused = await handle(send('feedback', feedback()), env(DB));
  assert.equal(refused.status, 429); assert.equal(refused.headers.get('Retry-After'), '3600');
  assert.equal(refused.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await (await handle(send('feedback', body), env(DB))).json(), { accepted: true, duplicate: true });
  assert.equal(await used(DB, 'alibi:voice'), VOICE_DEFAULT_LIMIT); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 1);
  assert.equal((await all(DB, 'voice_feedback')).length, 1);
});

test('a survey is stored once per installation, survey and subject, replaced in place on resubmission', async t => {
  const DB = database(t);
  const first = await handle(send('survey', taste({ comment: 'More castles, please' }), { cf: { country: 'FR' } }), env(DB));
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { accepted: true, updated: false });
  const [row] = await all(DB, 'voice_survey');
  assert.equal(row.respondent, createHash('sha256').update('alibi:' + KEY).digest('hex'));
  assert.equal(row.first_received, row.received); assert.equal(row.submissions, 1); assert.equal(row.subject, '');
  assert.equal(row.answers, '{"often":"weekly","more":["scene","sudoku"],"difficulty":"mostly-right"}');
  assert.equal(row.comment, 'More castles, please'); assert.equal(row.country, 'FR'); assert.equal(row.device, 'mobile');
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await handle(send('survey', taste({ release: '0.15.1', answers: { often: 'daily', difficulty: 'too-hard' }, comment: '', context: { device: 'tablet' } }),
    { cf: { country: 'DE' } }), env(DB));
  assert.deepEqual(await second.json(), { accepted: true, updated: true });
  const rows = await all(DB, 'voice_survey');
  assert.equal(rows.length, 1, 'one respondent counts once however often they resubmit');
  assert.deepEqual({ ...rows[0], received: 0 }, { ...row, received: 0, release: '0.15.1', answers: '{"often":"daily","difficulty":"too-hard"}', comment: '',
    device: 'tablet', country: 'DE', submissions: 2 });
  assert.ok(rows[0].received > row.received); assert.equal(rows[0].first_received, row.first_received);
  // Every accepted write is charged, updates included.
  assert.equal(await used(DB, 'alibi:voice'), 2); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 2);
  // A different installation or a different survey is a different row.
  assert.deepEqual(await (await handle(send('survey', taste({ respondent: OTHER_KEY })), env(DB))).json(), { accepted: true, updated: false });
  assert.deepEqual(await (await handle(send('survey', rating()), env(DB))).json(), { accepted: true, updated: false });
  assert.equal((await all(DB, 'voice_survey')).length, 3);
  // The raw survey key is never stored anywhere.
  for (const table of ['voice_survey', 'voice_feedback', 'budget', 'product_events', 'events']) {
    const text = JSON.stringify(await all(DB, table));
    assert.ok(!text.includes(KEY) && !text.includes(OTHER_KEY), table);
  }
});

test('ratings are one row per installation and puzzle, and changing a rating replaces it', async t => {
  const DB = database(t);
  assert.deepEqual(await (await handle(send('survey', rating()), env(DB))).json(), { accepted: true, updated: false });
  assert.deepEqual(await (await handle(send('survey', rating({ answers: { difficulty: 'too-hard' } })), env(DB))).json(), { accepted: true, updated: true });
  assert.deepEqual(await (await handle(send('survey', rating({ subject: 'castle-3', meta: { family: 'bridges', tier: 'gentle' } })), env(DB))).json(), { accepted: true, updated: false });
  const rows = await all(DB, 'voice_survey');
  assert.deepEqual(rows.map(r => [r.subject, r.answers, r.meta, r.submissions]), [
    ['vault-binary-04', '{"difficulty":"too-hard"}', '{"family":"binary","tier":"tricky"}', 2],
    ['castle-3', '{"difficulty":"just-right","more":"yes"}', '{"family":"bridges","tier":"gentle"}', 1]]);
});

test('origin, project, method, admission, media type, body and contract are checked in order with CORS after the origin', async t => {
  const DB = database(t);
  for (const kind of ['feedback', 'survey']) {
    const body = kind === 'feedback' ? feedback() : taste(), write = kind === 'feedback' ? 'POST' : 'PUT';
    for (const id of ['taskdeck', 'nope', 'ALIBI']) assert.equal((await handle(send(kind, body, { id }), env(DB))).status, 404, `${kind} ${id}`);
    assert.equal((await handle(send(kind, body, { query: '?x=1' }), env(DB))).status, 404);
    const unknown = await handle(send(kind, body, { id: 'nope' }), env(DB));
    assert.deepEqual(await unknown.json(), { error: 'not_found' }); assert.equal(unknown.headers.get('Access-Control-Allow-Origin'), null);
    for (const origin of ['https://evil.test', null, projects.mdviewer.origin]) {
      const r = await handle(send(kind, body, { origin }), env(DB));
      assert.equal(r.status, 403, `${kind} ${origin}`); assert.deepEqual(await r.json(), { error: 'origin' });
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
    }
    assert.equal((await handle(send(kind, body, { id: 'mdviewer' }), env(DB))).status, 403, 'another project answers only its own origin');
    const preflight = await handle(send(kind, null, { method: 'OPTIONS' }), env(DB));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, PUT');
    assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN); assert.equal(preflight.headers.get('Vary'), 'Origin');
    for (const method of ['GET', 'DELETE', kind === 'feedback' ? 'PUT' : 'POST']) {
      const r = await handle(send(kind, body, { method }), env(DB));
      assert.equal(r.status, 405, `${kind} ${method}`); assert.deepEqual(await r.json(), { error: 'method' });
      assert.equal(r.headers.get('Allow'), write); assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    }
    for (const extra of [{ COLLECT_ENABLED: 'false' }, { COLLECT_ENABLED: undefined }, { COLLECT_PROJECTS: 'alibi,Alibi' }, { COLLECT_PROJECTS: 'nope' },
      { COLLECT_VOICE_PROJECTS: '' }, { COLLECT_VOICE_PROJECTS: undefined }, { COLLECT_VOICE_PROJECTS: 'alibi ' }, { COLLECT_VOICE_PROJECTS: 'alibi,alibi' },
      { COLLECT_VOICE_PROJECTS: 'Alibi' }, { COLLECT_VOICE_PROJECTS: 'alibi,mdviewer' }, { COLLECT_VOICE_PROJECTS: 'alibi,taskdeck' }]) {
      const r = await handle(send(kind, body), env(DB, extra));
      assert.equal(r.status, 503, `${kind} ${JSON.stringify(extra)}`); assert.deepEqual(await r.json(), { error: 'disabled' });
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    }
    // Product or counts admission never opens Voices, and Voices need no session admission.
    assert.equal((await handle(send(kind, body), env(DB, { COLLECT_VOICE_PROJECTS: '', COLLECT_PRODUCT_PROJECTS: 'alibi', COLLECT_STAT_PROJECTS: 'alibi' }))).status, 503);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const r = await handle(send(kind, body, { headers: { 'Content-Type': type } }), env(DB));
      assert.equal(r.status, 415, `${kind} ${type}`); assert.deepEqual(await r.json(), { error: 'media_type' });
    }
    assert.equal((await handle(send(kind, body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }), env(DB, { COLLECT_VOICE_PROJECTS: 'alibi' }))).status, 202);
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(17000)); c.close(); } });
    const big = await handle(new Request(`https://collector.example/v1/${kind}/alibi`, { method: write, body: stream, duplex: 'half',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }), env(DB));
    assert.equal(big.status, 400); assert.deepEqual(await big.json(), { error: 'contract' });
    for (const raw of ['{not json', '', 'null', '[]', '"text"', JSON.stringify({ ...body, extra: 1 })]) {
      const r = await handle(send(kind, raw), env(DB));
      assert.equal(r.status, 400, `${kind} ${raw.slice(0, 40)}`); assert.deepEqual(await r.json(), { error: 'contract' });
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    }
  }
  // Only the two admitted writes above reached storage.
  assert.equal((await all(DB, 'voice_feedback')).length, 1); assert.equal((await all(DB, 'voice_survey')).length, 1);
  assert.equal(await used(DB, 'alibi:voice'), 2);
});

test('a feedback body within 16 KiB is accepted and one byte more is refused', async t => {
  const DB = database(t);
  // JSON escapes make each newline two bytes on the wire; the 2,000-character bound is measured after parsing.
  const body = feedback({ text: 'é'.repeat(2000) });
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength <= 16384);
  assert.equal((await handle(send('feedback', body), env(DB))).status, 202);
  const padded = JSON.stringify(feedback()) + ' '.repeat(16384);
  assert.equal((await handle(send('feedback', padded), env(DB))).status, 400);
});

test('the voice budget is per project with voiceLimit, plus one global key, and a refused write stores and charges nothing', async t => {
  const DB = database(t);
  assert.equal(VOICE_DEFAULT_LIMIT, 300);
  for (const [id, p] of Object.entries(projects)) assert.equal(p.voiceLimit, undefined, `${id} uses the default until the owner overrides it`);
  // The project reservation: exactly the limit is admitted, one more is refused.
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind('alibi:voice', today(), VOICE_DEFAULT_LIMIT - 1, 'old').run();
  assert.equal((await handle(send('survey', taste()), env(DB))).status, 202);
  const refused = await handle(send('survey', taste({ respondent: OTHER_KEY })), env(DB));
  assert.equal(refused.status, 429); assert.equal(refused.headers.get('Retry-After'), '3600');
  assert.deepEqual(await refused.json(), { error: 'daily_budget' });
  assert.equal((await all(DB, 'voice_survey')).length, 1);
  assert.equal(await used(DB, 'alibi:voice'), VOICE_DEFAULT_LIMIT); assert.equal(await used(DB, VOICE_GLOBAL_KEY), 1);
  // voiceLimit overrides the default, including for the first write of a day.
  const original = projects.alibi.voiceLimit;
  try {
    projects.alibi.voiceLimit = 0;
    await DB.prepare('DELETE FROM budget').run();
    assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 429);
    assert.equal(await used(DB, 'alibi:voice'), null, 'a refused first write of the day creates no row');
    projects.alibi.voiceLimit = 2;
    assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 202);
    assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 202);
    assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 429);
  } finally { if (original === undefined) delete projects.alibi.voiceLimit; else projects.alibi.voiceLimit = original; }
  // The global key refuses a write the project budget would allow, and charges neither.
  await DB.prepare('DELETE FROM budget').run();
  await DB.prepare('INSERT INTO budget VALUES(?,?,?,?)').bind(VOICE_GLOBAL_KEY, today(), VOICE_GLOBAL_LIMIT, 'full').run();
  const before = (await all(DB, 'voice_feedback')).length;
  assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 429);
  assert.equal((await handle(send('survey', rating({ subject: 'castle-9' })), env(DB))).status, 429);
  assert.equal(await used(DB, 'alibi:voice'), null); assert.equal(await used(DB, VOICE_GLOBAL_KEY), VOICE_GLOBAL_LIMIT);
  assert.equal((await all(DB, 'voice_feedback')).length, before);
  // Exactly filling the global key is admitted.
  await DB.prepare('UPDATE budget SET used=? WHERE project=?').bind(VOICE_GLOBAL_LIMIT - 1, VOICE_GLOBAL_KEY).run();
  assert.equal((await handle(send('feedback', feedback()), env(DB))).status, 202);
  assert.equal(await used(DB, VOICE_GLOBAL_KEY), VOICE_GLOBAL_LIMIT); assert.equal(await used(DB, 'alibi:voice'), 1);
  // Voices never draw on the product, counts or session budgets, and those never on Voices.
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM budget WHERE project NOT LIKE '%:voice'").first()).n, 0);
});

test('readiness reports the voice switch', async t => {
  const DB = database(t);
  const body = await (await handle(new Request('https://desk.test/readyz'), env(DB))).json();
  assert.equal(body.schema, 5);
  assert.deepEqual(body.voices, { configured: true, admitted: ['alibi'] });
  assert.deepEqual((await (await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_VOICE_PROJECTS: 'alibi,mdviewer' }))).json()).voices,
    { configured: true, admitted: [] });
  assert.deepEqual((await (await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_ENABLED: 'false' }))).json()).voices,
    { configured: true, admitted: [] });
  assert.deepEqual((await (await handle(new Request('https://desk.test/readyz'), env(DB, { COLLECT_VOICE_PROJECTS: undefined }))).json()).voices,
    { configured: false, admitted: [] });
});

test('the committed voice allowlists admit Alibi in production and nothing in the preview', () => {
  const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const lists = [...source.matchAll(/"COLLECT_VOICE_PROJECTS"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(lists, ['alibi', ''], 'production admits Alibi (owner decision 2026-09-27); preview admits none');
  for (const value of lists.filter(Boolean)) assert.deepEqual(voiceAdmission({ COLLECT_VOICE_PROJECTS: value }), value.split(','), value);
});

test('the local runner admits feedback and surveys against real SQLite with the same rules', async t => {
  const DB = database(t);
  const runner = await startLocalRunner({ port: 0, DB, READ_TOKEN: TOKEN, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: '',
    COLLECT_VOICE_PROJECTS: 'alibi', ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  t.after(() => runner.close());
  const call = (kind, method, body, origin = ORIGIN) => fetch(`${runner.origin}/v1/${kind}/alibi`, { method,
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = feedback();
  assert.deepEqual(await (await call('feedback', 'POST', body)).json(), { accepted: true, duplicate: false });
  assert.deepEqual(await (await call('feedback', 'POST', body)).json(), { accepted: true, duplicate: true });
  assert.deepEqual(await (await call('survey', 'PUT', taste())).json(), { accepted: true, updated: false });
  assert.deepEqual(await (await call('survey', 'PUT', taste())).json(), { accepted: true, updated: true });
  assert.equal((await call('survey', 'PUT', taste(), 'https://evil.test')).status, 403);
  assert.equal((await call('feedback', 'PUT', body)).status, 405);
  const ready = await (await fetch(runner.origin + '/readyz')).json();
  assert.deepEqual(ready.voices, { configured: true, admitted: ['alibi'] });
  assert.equal((await all(DB, 'voice_feedback')).length, 1); assert.equal((await all(DB, 'voice_survey'))[0].submissions, 2);
  // Off by default: a runner without the switch refuses.
  const closed = await startLocalRunner({ port: 0, DB, READ_TOKEN: TOKEN, COLLECT_ENABLED: 'true', ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  t.after(() => closed.close());
  assert.equal((await fetch(`${closed.origin}/v1/feedback/alibi`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback()) })).status, 503);
});
