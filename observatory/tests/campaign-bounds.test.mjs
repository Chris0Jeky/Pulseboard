// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { handle } from '../src/worker.mjs';
import { DIMENSION_CAP } from '../src/stat-contract.mjs';
import { buildSdk } from '../adapters/build-sdk.mjs';

const DAY = 86400000;
function registerCampaigns(t, id, campaigns) {
  const original = projects[id];
  projects[id] = { ...original, campaigns };
  t.after(() => { projects[id] = original; });
}

test('registered campaigns hit the per-project UTC-day cap, not the unregistered-tag fallback', async t => {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  let now = Date.UTC(2026, 9, 1, 12);
  t.mock.method(Date, 'now', () => now);
  const tags = Array.from({ length: DIMENSION_CAP + 1 }, (_, i) => `campaign_${i}`);
  registerCampaigns(t, 'alibi', tags);
  registerCampaigns(t, 'mdviewer', tags);
  const env = { DB, COLLECT_ENABLED: 'true', COLLECT_PROJECTS: '', COLLECT_STAT_PROJECTS: 'alibi,mdviewer' };
  async function send(id, campaign) {
    const p = projects[id];
    const response = await handle(new Request(`https://collector.test/v1/collect-stat/${id}`, {
      method: 'POST', headers: { Origin: p.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 3, context: { device: 'desktop', source: 'direct', visit: 'new',
        scheme: 'light', referrer: 'none', campaign },
      counts: [{ event: 'page.view', route: 'home', release: p.releases.at(-1), n: 1 }] }),
    }), env);
    assert.equal(response.status, 202, `${id}:${campaign}`);
  }
  const values = async (id, day) => Object.fromEntries((await DB.prepare(
    "SELECT value,n FROM statistics_dimensions WHERE project=? AND day=? AND dimension='campaign'")
    .bind(id, day).all()).results.map(row => [row.value, row.n]));
  const today = new Date(now).toISOString().slice(0, 10);
  for (const tag of tags) await send('alibi', tag);
  assert.deepEqual(await values('alibi', today), { ...Object.fromEntries(tags.slice(0, DIMENSION_CAP).map(tag => [tag, 1])), other: 1 });
  await send('alibi', tags[0]);
  await send('alibi', 'none');
  await send('alibi', 'other');
  const capped = await values('alibi', today);
  assert.equal(capped[tags[0]], 2, 'an already stored registered tag keeps its own bucket');
  assert.equal(capped.none, 1, 'sentinels do not consume distinct-value slots');
  assert.equal(capped.other, 2);
  assert.equal(Object.values(capped).reduce((sum, n) => sum + n, 0), tags.length + 3);
  await send('mdviewer', tags.at(-1));
  assert.deepEqual(await values('mdviewer', today), { [tags.at(-1)]: 1 }, 'another project has an independent cap');
  now += DAY;
  await send('alibi', tags.at(-1));
  assert.deepEqual(await values('alibi', new Date(now).toISOString().slice(0, 10)), { [tags.at(-1)]: 1 }, 'the next UTC day has an independent cap');
});

test('SDK generation preserves a nonempty registered campaign list without changing the registry', t => {
  const original = [...projects.mdviewer.campaigns];
  const config = () => JSON.parse(/^const config = (\{.*\});$/m.exec(buildSdk('mdviewer'))[1]);
  assert.deepEqual(config().project.campaigns, original);
  const campaigns = ['launch_2026', 'guide-update'];
  registerCampaigns(t, 'mdviewer', campaigns);
  assert.deepEqual(config().project.campaigns, campaigns);
  assert.deepEqual(projects.mdviewer.campaigns, campaigns);
});
