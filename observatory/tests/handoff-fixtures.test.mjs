// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildHandoffFixtures } from '../adapters/handoff-fixtures.mjs';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
test('the shared corpus uses actual v1/v2 producers for every window and both project scopes', async () => {
  const corpus = await buildHandoffFixtures();
  assert.equal(corpus.schema, 'pulseboard.handoff-fixtures/1');
  assert.equal(corpus.synthetic, true);
  assert.equal(corpus.cases.length, 12);
  const ids = new Set();
  for (const entry of corpus.cases) {
    assert.ok(!ids.has(entry.id)); ids.add(entry.id);
    const packet = JSON.parse(entry.text);
    assert.equal(packet.mode, 'demo');
    assert.equal(packet.stale, entry.id.startsWith('portfolio-'));
    assert.equal(packet.project === null, entry.id.startsWith('portfolio-'));
    assert.equal(typeof packet.generatedAt, 'number');
    assert.equal(typeof packet.evidence, 'object');
    assert.equal(packet.window.end - packet.window.start, packet.window.days * 86400000);
    assert.equal(entry.fileSha256, sha(entry.text));
    const full = sha(JSON.stringify([packet.project, packet.rule.id, packet.rule.version]));
    assert.equal(entry.signalSha256, full);
    assert.equal(entry.fingerprint, full.slice(0, 12));
    if (packet.schema === 'pulseboard.handoff/2') assert.equal(packet.fingerprint, entry.fingerprint);
  }
  for (const days of [1, 7, 14]) for (const scope of ['project', 'portfolio']) {
    const entries = corpus.cases.filter(entry => entry.id.startsWith(`${scope}-${days}d-`));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].signalSha256, entries[1].signalSha256);
    assert.notEqual(entries[0].fileSha256, entries[1].fileSha256);
  }
});

test('committed fixture bytes are reproduced deterministically, without wall-clock input', async () => {
  const first = JSON.stringify(await buildHandoffFixtures(), null, 2) + '\n';
  const second = JSON.stringify(await buildHandoffFixtures(), null, 2) + '\n';
  assert.equal(first, second);
  assert.equal(await readFile(new URL('../examples/handoff-fixtures.synthetic.json', import.meta.url), 'utf8'), first);
});

test('the corpus keeps identical bytes in a CRLF-configured fresh checkout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'handoff-corpus-checkout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await readFile(new URL('../examples/handoff-fixtures.synthetic.json', import.meta.url));
  const attributes = await readFile(new URL('../examples/.gitattributes', import.meta.url));
  await writeFile(join(directory, 'handoff-fixtures.synthetic.json'), bytes);
  await writeFile(join(directory, '.gitattributes'), attributes);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false',
    '-c', 'core.hooksPath=' + join(directory, 'no-hooks'), '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture test', '-c', 'user.email=fixture@invalid.test', ...args],
    { cwd: directory, stdio: 'pipe' });
  git('init'); git('add', '.'); git('commit', '-m', 'Synthetic corpus');
  await unlink(join(directory, 'handoff-fixtures.synthetic.json'));
  git('checkout', '--', 'handoff-fixtures.synthetic.json');
  assert.deepEqual(await readFile(join(directory, 'handoff-fixtures.synthetic.json')), bytes);
});
