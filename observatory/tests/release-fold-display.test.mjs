// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { projects } from '../src/projects.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { makeStatisticsDemo, usageQuestions } from '../public/desk-usage.mjs';
import * as model from '../public/desk-model.mjs';

const NOW = Date.UTC(2026, 9, 3, 12);
test('the release comparator refuses a combined bucket as either cohort', () => {
  const cohort = release => ({ release, failed: 20, completed: 80 });
  for (const [a, b] of [['other', '1.0.0'], ['1.0.0', 'other'], ['unattributed', '1.0.0']]) {
    const result = model.compareReleases(cohort(a), cohort(b));
    assert.equal(result.supported, false, `${a}:${b}`);
    assert.equal(result.delta, null);
  }
  assert.equal(model.compareReleases(cohort('1.0.0'), cohort('2.0.0')).supported, true);
});

test('release labels distinguish the combined bucket without changing real labels', () => {
  assert.equal(model.releaseLabel('other'), 'other (smaller versions combined)');
  assert.equal(model.releaseLabel('1.2.3'), '1.2.3');
  assert.equal(model.releaseLabel('unattributed'), 'unattributed');
});

test('missing attribution is zero only in an unfolded list', () => {
  assert.equal(model.unattributedEvents([]), 0);
  assert.equal(model.unattributedEvents([{ release: '1.0.0', events: 10 }]), 0);
  assert.equal(model.unattributedEvents([{ release: 'other', events: 10 }]), null);
  assert.equal(model.unattributedEvents([{ release: 'other', events: 10 }, { release: 'unattributed', events: 2 }]), 2);
});

test('Usage reports individually shown labels, never the aggregate bucket as a version', () => {
  const stats = makeStatisticsDemo(7, NOW);
  stats.releases = [...Array.from({ length: 63 }, (_, i) => ({ release: `1.0.${i}`, n: 10 })), { release: 'other', n: 2 }];
  const copy = usageQuestions(stats).map(q => q.text).join('\n');
  assert.match(copy, /63 individually shown release labels/);
  assert.match(copy, /additional labels are combined/);
  assert.doesNotMatch(copy, /64 release labels/);
  stats.releases = [{ release: '1.0.0', n: 10 }, { release: '2.0.0', n: 10 }];
  assert.match(usageQuestions(stats).map(q => q.text).join('\n'), /2 release labels/);
});

test('a recent folded tail preserves portfolio recency, totals and explicit unknown attribution', async t => {
  const DB = openDatabase();
  DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => DB.close());
  const insert = DB.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 63; i++) for (let copy = 0; copy < 2; copy++) {
    await insert.bind('alibi', crypto.randomUUID(), NOW - 10000 - i, crypto.randomUUID(), 1, 'page.view', 'home', `1.0.${i}`, null).run();
  }
  for (const release of ['unattributed', '9.9.9']) {
    await insert.bind('alibi', crypto.randomUUID(), NOW - 1, crypto.randomUUID(), 1, 'duration.ms', 'home', release, 100).run();
  }
  const snapshot = await readPortfolio(DB, { now: NOW, collectionEnabled: true, admittedProjects: ['alibi'], projects: { alibi: projects.alibi } });
  assert.equal(assertPortfolio(snapshot), snapshot);
  const [project] = snapshot.projects;
  assert.equal(project.releases.length, 64);
  assert.equal(project.releases[0].release, 'other', 'the newest receipt belongs to the folded tail');
  assert.equal(project.releases[0].last, NOW - 1);
  assert.equal(project.releases[0].duration, null, 'no synthetic percentile');
  assert.equal(project.releases.reduce((n, row) => n + row.events, 0), project.totals.events);
  assert.equal(project.totals.events, 128);
  assert.equal(model.unattributedEvents(project.releases), null);
  const signal = model.buildSignals(snapshot, NOW).find(s => s.rule === 'release.attribution_unknown');
  assert.ok(signal, 'the folded attribution is an explicit limitation, not a zero');
  assert.deepEqual(signal.evidence, { unattributed: null, foldedEvents: 2, total: 128 });
  assert.ok(!model.buildSignals(snapshot, NOW).some(s => s.rule === 'release.unattributed'));
});
