// Test-only real parallel writer. No network calls; the parent owns the temporary database.
import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../../src/sqlite.mjs';
import { projects } from '../../src/projects.mjs';
import { createSurveyV2Experiment } from '../../experiments/survey-v2/index.mjs';
const db = openDatabase(workerData.file);
try {
  const gate = new Int32Array(workerData.gate);
  parentPort.postMessage({ ready: true });
  if (Atomics.wait(gate, 0, 0, 10000) === 'timed-out') throw new Error('parallel writer start was not released');
  const body = workerData.body;
  const response = await createSurveyV2Experiment({ acceptV2: true })(
    new Request(`http://fixture.test/v${body.v}/survey/alibi`, { method: 'PUT',
      headers: { Origin: projects.alibi.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    { DB: db, COLLECT_ENABLED: 'true', COLLECT_VOICE_PROJECTS: 'alibi' });
  parentPort.postMessage({ status: response.status, body: await response.json() });
} finally { db.close(); }
