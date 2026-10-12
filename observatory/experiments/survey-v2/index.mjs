/** EXPERIMENTAL scratch-only consumer. Not imported by the production Worker or local entry.
 * See README.md for producer coordination, deployment/rollback holds and retention limits. */
import { handle as production } from '../../src/watch-worker.mjs';
import { projects } from '../../src/projects.mjs';
import { collectionAdmission, voiceAdmission } from '../../src/admission.mjs';
import { readBounded } from '../../src/contracts.mjs';
import { serverDimensions } from '../../src/stat-contract.mjs';
import { parseSurvey, respondentHash, VOICE_DEFAULT_LIMIT, VOICE_GLOBAL_KEY, VOICE_GLOBAL_LIMIT } from '../../src/voice-contract.mjs';

/** Proposed pulseboard.survey/2: the v1 fields plus one positive safe integer revision.
 * Reuse the closed v1 vocabulary/normalization without making its validator accept v2. */
export function parseSurveyV2(body, project) {
  if (!body || Object.getPrototypeOf(body) !== Object.prototype || body.v !== 2 ||
      !Object.hasOwn(body, 'revision') || !Number.isSafeInteger(body.revision) || body.revision < 1) return null;
  const { revision, ...original } = body;
  const record = parseSurvey({ ...original, v: 1 }, project);
  return record ? { ...record, revision } : null;
}

const IDENTITY = 'project=? AND survey=? AND subject=? AND respondent=?';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

/** Returns a separate request handler for explicit scratch-runner injection.
 * acceptV2=false stops new v2 intake, but NEVER bypasses the v1 downgrade guard.
 * Do not roll a v2 database back to the old production handler: it has no such guard. */
export function createSurveyV2Experiment({ acceptV2 = false } = {}) {
  if (typeof acceptV2 !== 'boolean') throw new TypeError('acceptV2 must be boolean');
  return async function handleSurveyExperiment(request, env) {
    const url = new URL(request.url), match = /^\/v([12])\/survey\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match) return production(request, env);
    let cors = {};
    try {
      const version = Number(match[1]), id = match[2];
      const project = Object.hasOwn(projects, id) ? projects[id] : null;
      if (url.search || !project?.origin) return json({ error: 'not_found' }, 404);
      if (request.headers.get('origin') !== project.origin) return json({ error: 'origin' }, 403);
      cors = { 'Access-Control-Allow-Origin': project.origin, Vary: 'Origin' };
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, ...cors,
        'Access-Control-Allow-Methods': version === 1 ? 'POST, PUT' : 'PUT',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      if (request.method !== 'PUT') return json({ error: 'method' }, 405, { ...cors, Allow: 'PUT' });
      const admission = collectionAdmission(env);
      if (!admission.valid || !admission.enabled || !voiceAdmission(env).includes(id) || (version === 2 && !acceptV2)) {
        return json({ error: 'disabled' }, 503, cors);
      }
      if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) return json({ error: 'media_type' }, 415, cors);
      let body;
      try { body = await readBounded(request); } catch { return json({ error: 'contract' }, 400, cors); }
      const record = version === 1 ? parseSurvey(body, id) : parseSurveyV2(body, id);
      if (!record) return json({ error: 'contract' }, 400, cors);
      const db = env.DB;
      // An installed handler never falls back to an unguarded v1 write on missing/partial schema.
      const schema = await db.prepare('SELECT version FROM survey_revision_schema WHERE id=1').first();
      if (schema?.version !== 1) return json({ error: 'unavailable' }, 503, cors);
      await db.prepare('SELECT project,survey,subject,respondent,revision FROM voice_survey_revisions LIMIT 0').all();
      const respondent = await respondentHash(id, record.respondent);
      const identity = [id, record.survey, record.subject, respondent];
      const hasRevision = `EXISTS(SELECT 1 FROM voice_survey_revisions WHERE ${IDENTITY})`;
      const orphan = `(${hasRevision} AND NOT EXISTS(SELECT 1 FROM voice_survey WHERE ${IDENTITY}))`;
      const atLeast = `EXISTS(SELECT 1 FROM voice_survey_revisions WHERE ${IDENTITY} AND revision>=?)`;
      const same = `EXISTS(SELECT 1 FROM voice_survey WHERE ${IDENTITY}
        AND release=? AND answers=? AND meta=? AND comment=? AND redacted=? AND device=?)`;
      const content = [record.release, record.answers, record.meta, record.comment, record.redacted, record.device];
      const decision = version === 1
        ? db.prepare(`SELECT CASE WHEN ${hasRevision} THEN 'version_conflict' ELSE 'write' END AS decision`).bind(...identity)
        : db.prepare(`SELECT CASE WHEN ${orphan} THEN 'unavailable'
          WHEN EXISTS(SELECT 1 FROM voice_survey_revisions WHERE ${IDENTITY} AND revision>?) THEN 'stale'
          WHEN EXISTS(SELECT 1 FROM voice_survey_revisions WHERE ${IDENTITY} AND revision=?)
            THEN CASE WHEN ${same} THEN 'duplicate' ELSE 'revision_conflict' END
          ELSE 'write' END AS decision`)
          .bind(...identity, ...identity, ...identity, record.revision, ...identity, record.revision, ...identity, ...content);
      const blocked = version === 1 ? hasRevision : `(${atLeast} OR ${orphan})`;
      const blockedBinds = version === 1 ? identity : [...identity, record.revision, ...identity, ...identity];
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), receipt = crypto.randomUUID();
      const key = id + ':voice', limit = project.voiceLimit ?? VOICE_DEFAULT_LIMIT;
      const globalRoom = '(SELECT COALESCE(MAX(used),0) FROM budget WHERE project=? AND day=?)+1<=?';
      // The guard participates in the INSERT SELECT, including the ON CONFLICT path.
      // All five statements share one transaction; no pre-transaction duplicate check authorizes a write.
      const reserve = db.prepare(`INSERT INTO budget(project,day,used,receipt) SELECT ?,?,1,?
        WHERE 1<=? AND ${globalRoom} AND NOT ${blocked}
        ON CONFLICT(project,day) DO UPDATE SET used=used+1,receipt=excluded.receipt
        WHERE used+1<=? AND ${globalRoom} RETURNING used`)
        .bind(key, day, receipt, limit, VOICE_GLOBAL_KEY, day, VOICE_GLOBAL_LIMIT, ...blockedBinds,
          limit, VOICE_GLOBAL_KEY, day, VOICE_GLOBAL_LIMIT);
      const global = db.prepare(`INSERT INTO budget(project,day,used,receipt) SELECT ?,?,1,? FROM budget
        WHERE project=? AND day=? AND receipt=?
        ON CONFLICT(project,day) DO UPDATE SET used=used+1,receipt=excluded.receipt`)
        .bind(VOICE_GLOBAL_KEY, day, receipt, key, day, receipt);
      const country = serverDimensions(request, now).country;
      const upsert = db.prepare(`INSERT INTO voice_survey(project,survey,subject,respondent,first_received,received,day,release,
        answers,meta,comment,redacted,device,country,submissions) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,1
        FROM budget WHERE project=? AND day=? AND receipt=?
        ON CONFLICT(project,survey,subject,respondent) DO UPDATE SET received=excluded.received,day=excluded.day,
          release=excluded.release,answers=excluded.answers,meta=excluded.meta,comment=excluded.comment,
          redacted=excluded.redacted,device=excluded.device,country=excluded.country,submissions=voice_survey.submissions+1
        RETURNING submissions`)
        .bind(...identity, now, now, day, record.release, record.answers, record.meta, record.comment,
          record.redacted, record.device, country, key, day, receipt);
      const statements = [decision, reserve, global, upsert];
      if (version === 2) statements.push(db.prepare(`INSERT INTO voice_survey_revisions(project,survey,subject,respondent,revision)
        SELECT ?,?,?,?,? FROM budget WHERE project=? AND day=? AND receipt=?
        ON CONFLICT(project,survey,subject,respondent) DO UPDATE SET revision=excluded.revision
        WHERE excluded.revision>voice_survey_revisions.revision`)
        .bind(...identity, record.revision, key, day, receipt));
      const results = await db.batch(statements);
      const kind = results[0].results?.[0]?.decision;
      if (kind === 'version_conflict' || kind === 'revision_conflict') return json({ error: kind }, 409, cors);
      if (kind === 'unavailable') return json({ error: 'unavailable' }, 503, cors);
      if (kind === 'stale' || kind === 'duplicate') return json({ accepted: true, updated: false, outcome: kind }, 202, cors);
      if (kind !== 'write') return json({ error: 'unavailable' }, 503, cors);
      if (!results[1].results?.length) return json({ error: 'daily_budget' }, 429, { ...cors, 'Retry-After': '3600' });
      const updated = Number(results[3].results?.[0]?.submissions) > 1;
      return json(version === 1 ? { accepted: true, updated }
        : { accepted: true, updated, outcome: updated ? 'updated' : 'created' }, 202, cors);
    } catch { return json({ error: 'unavailable' }, 503, cors); }
  };
}
