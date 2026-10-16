import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/sqlite.mjs';

const body = (revision, difficulty = 'just-right') => ({ v: 2, revision, survey: 'puzzle-rating', subject: 'castle-3',
  respondent: '5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2', release: '0.15.0', answers: { difficulty },
  meta: { family: 'binary', tier: 'tricky' }, comment: '', context: { device: 'desktop' } });
const legacy = body(1, 'too-easy'); delete legacy.revision; legacy.v = 1;

for (const [name, bodies] of [
  ['identical', [body(4), body(4)]], ['conflicting', [body(4), body(4, 'too-hard')]],
  ['different revisions', [body(1, 'too-easy'), body(2, 'too-hard')]],
  ['v1/v2 takeover', [legacy, body(2, 'too-hard')]],
]) {
  test(`parallel worker threads serialize ${name} writes on the same SQLite file`, { timeout: 15000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-survey-threads-')), file = join(dir, 'db.sqlite');
    const db = openDatabase(file), workers = [];
    t.after(async () => { await Promise.all(workers.map(w => w.terminate())); db.close(); rmSync(dir, { recursive: true, force: true }); });
    db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../experiments/survey-v2/schema.sql', import.meta.url), 'utf8'));
    const gate = new SharedArrayBuffer(4);
    const pairs = bodies.map(body => {
      const worker = new Worker(new URL('./helpers/survey-v2-worker.mjs', import.meta.url), { workerData: { file, gate, body } });
      workers.push(worker);
      let ready, readyError, result, resultError;
      const readiness = new Promise((resolve, reject) => { ready = resolve; readyError = reject; });
      const completion = new Promise((resolve, reject) => { result = resolve; resultError = reject; });
      worker.on('message', message => message.ready ? ready() : result(message));
      worker.on('error', error => { readyError(error); resultError(error); });
      worker.on('exit', code => { if (code !== 0) { const e = new Error('writer exited unsuccessfully'); readyError(e); resultError(e); } });
      return { readiness, completion };
    });
    const completions = Promise.all(pairs.map(p => p.completion)); completions.catch(() => {});
    await Promise.all(pairs.map(p => p.readiness));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    const results = await completions;
    assert.ok(results.every(r => [202, 409].includes(r.status)), JSON.stringify(results));
    if (name === 'identical') assert.deepEqual(results.map(r => r.body.outcome).sort(), ['created', 'duplicate']);
    if (name === 'conflicting') assert.deepEqual(results.map(r => r.status).sort(), [202, 409]);
    const charged = results.filter(r => r.status === 202 && !['duplicate', 'stale'].includes(r.body.outcome)).length;
    const rows = (await db.prepare('SELECT * FROM voice_survey').all()).results;
    const revision = await db.prepare('SELECT revision FROM voice_survey_revisions').first();
    assert.equal(rows.length, 1); assert.equal(rows[0].submissions, charged);
    assert.deepEqual((await db.prepare('SELECT used FROM budget').all()).results.map(r => r.used), [charged, charged]);
    assert.equal(revision.revision, Math.max(...bodies.filter(b => b.v === 2).map(b => b.revision)));
    if (name === 'different revisions' || name === 'v1/v2 takeover') assert.equal(rows[0].answers, '{"difficulty":"too-hard"}');
  });
}
