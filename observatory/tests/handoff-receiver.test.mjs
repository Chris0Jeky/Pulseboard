// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { makeDemo } from '../public/desk-demo.mjs';
import { makeHandoff, buildSignals } from '../public/desk-model.mjs';
import { receiveHandoff, readBoundedFile } from '../adapters/receive-handoff.mjs';
import { MAX_HANDOFF_BYTES } from '../public/desk-handoff.mjs';

const NOW = Date.UTC(2026, 9, 3, 12);
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pulseboard-receiver-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const snapshot = makeDemo('release', { now: NOW });
  const signal = buildSignals(snapshot, NOW).find(row => row.project === 'alibi');
  const packet = makeHandoff(snapshot, signal);
  const input = join(dir, 'handoff.json'), outputDir = join(dir, 'proposals');
  await writeFile(input, JSON.stringify(packet));
  const options = { input, outputDir, targetProject: 'alibi', now: NOW };
  return { dir, packet, input, outputDir, options };
}
async function approve(options) {
  const { preview } = await receiveHandoff(options);
  return { ...options, accept: true, allowSynthetic: true, reviewedSha256: preview.reviewedFileSha256 };
}

test('preview is the default and creates neither a directory nor a proposal', async t => {
  const x = await setup(t);
  const result = await receiveHandoff(x.options);
  assert.equal(result.status, 'preview');
  assert.equal(result.preview.proposal.targetProject, 'alibi');
  assert.deepEqual(await readdir(x.dir), ['handoff.json']);
});

test('accept binds the exact reviewed file and requires explicit synthetic permission', async t => {
  const x = await setup(t), options = await approve(x.options);
  await mkdir(x.outputDir);
  await assert.rejects(receiveHandoff({ ...options, reviewedSha256: '0'.repeat(64) }), /reviewed file/);
  await assert.rejects(receiveHandoff({ ...options, allowSynthetic: false }), /synthetic/);
  await assert.rejects(receiveHandoff({ ...options, reviewedSha256: undefined }), /reviewed file/);
  assert.deepEqual(await readdir(x.outputDir), []);
  // A semantically identical edit is still a change to the exact reviewed file.
  await writeFile(x.input, JSON.stringify(x.packet, null, 2));
  await assert.rejects(receiveHandoff(options), /reviewed file/);
  assert.deepEqual(await readdir(x.outputDir), []);
});

test('one accepted proposal preserves the previewed fields, source and an empty permission set', async t => {
  const x = await setup(t), options = await approve(x.options);
  const { preview } = await receiveHandoff(x.options);
  await mkdir(x.outputDir);
  const result = await receiveHandoff(options);
  assert.equal(result.status, 'created');
  const card = JSON.parse(await readFile(result.path, 'utf8'));
  assert.deepEqual(card.fields, preview.proposal.fields);
  assert.deepEqual(card.source, preview.source);
  assert.deepEqual(card.permissions, []);
  assert.equal(card.review.freshness, 'current');
  assert.equal(card.source.mode, 'demo');
  assert.equal(card.status, 'proposed');
  assert.deepEqual(await readdir(x.outputDir), [basename(result.path)]);
  if (process.platform !== 'win32') assert.equal((await stat(result.path)).mode & 0o777, 0o600);
});

test('duplicates and later observations never overwrite accepted evidence', async t => {
  const x = await setup(t), options = await approve(x.options);
  await mkdir(x.outputDir);
  const first = await receiveHandoff(options), original = await readFile(first.path, 'utf8');
  assert.equal((await receiveHandoff(options)).status, 'duplicate');
  x.packet.evidence = { failures: 17 }; x.packet.title = 'Wording changed after another observation';
  await writeFile(x.input, JSON.stringify(x.packet));
  const repeated = await receiveHandoff(await approve(x.options));
  assert.equal(repeated.status, 'repeat-observation');
  assert.equal(repeated.path, first.path);
  assert.equal(await readFile(first.path, 'utf8'), original);
  assert.equal((await readdir(x.outputDir)).length, 1);
});

test('concurrent acceptance publishes a complete proposal once without partial files', async t => {
  const x = await setup(t), options = await approve(x.options);
  await mkdir(x.outputDir);
  const results = await Promise.all([receiveHandoff(options), receiveHandoff(options)]);
  assert.deepEqual(results.map(r => r.status).sort(), ['created', 'duplicate']);
  const names = await readdir(x.outputDir);
  assert.equal(names.length, 1);
  assert.equal(JSON.parse(await readFile(join(x.outputDir, names[0]), 'utf8')).schema, 'pulseboard.proposal/1');
});

test('synthetic/live and explicitly selected portfolio destinations have separate proposal keys', async t => {
  const x = await setup(t);
  await mkdir(x.outputDir);
  const synthetic = await receiveHandoff(await approve(x.options));
  x.packet.mode = 'live'; await writeFile(x.input, JSON.stringify(x.packet));
  const live = await receiveHandoff({ ...await approve(x.options), allowSynthetic: false });
  assert.notEqual(synthetic.path, live.path);
  x.packet.project = null; await writeFile(x.input, JSON.stringify(x.packet));
  const a = await receiveHandoff(await approve(x.options));
  const b = await receiveHandoff(await approve({ ...x.options, targetProject: 'mdviewer' }));
  assert.notEqual(a.path, b.path);
  assert.equal((await readdir(x.outputDir)).length, 4);
});

test('staleness is recomputed on accept and future-dated evidence cannot be accepted as stale', async t => {
  const x = await setup(t), options = await approve(x.options);
  await mkdir(x.outputDir);
  await assert.rejects(receiveHandoff({ ...options, now: NOW + 31 * 60000 }), /stale/);
  await assert.rejects(receiveHandoff({ ...options, now: NOW - 1, allowStale: true }), /future/);
  assert.deepEqual(await readdir(x.outputDir), []);
  const result = await receiveHandoff({ ...options, now: NOW + 31 * 60000, allowStale: true });
  const card = JSON.parse(await readFile(result.path, 'utf8'));
  assert.equal(card.source.generatedAt, NOW);
  assert.equal(card.review.freshness, 'expired');
  assert.equal(card.review.staleAccepted, true);
});

test('source-stale packets require acceptance even with a recent timestamp', async t => {
  const x = await setup(t);
  x.packet.stale = true; await writeFile(x.input, JSON.stringify(x.packet));
  const options = await approve(x.options);
  await mkdir(x.outputDir);
  await assert.rejects(receiveHandoff(options), /stale/);
  const result = await receiveHandoff({ ...options, allowStale: true });
  assert.equal(JSON.parse(await readFile(result.path, 'utf8')).source.stale, true);
});

test('local paths stay caller-owned: target mismatches, unknown registry targets and symlinks fail closed', async t => {
  const x = await setup(t), options = await approve(x.options);
  await assert.rejects(receiveHandoff({ ...x.options, targetProject: 'unregistered' }), /project/);
  await assert.rejects(receiveHandoff({ ...x.options, targetProject: 'mdviewer' }), /target project/);
  await assert.rejects(receiveHandoff(options), /output directory/);
  await mkdir(x.outputDir);
  const linked = join(x.dir, 'linked.json'); await symlink(x.input, linked);
  await assert.rejects(receiveHandoff({ ...x.options, input: linked }), /regular file/);
  const linkedDir = join(x.dir, 'linked-dir'); await symlink(x.outputDir, linkedDir);
  await assert.rejects(receiveHandoff({ ...options, outputDir: linkedDir }), /output directory/);
  assert.deepEqual(await readdir(x.outputDir), []);
});

test('a malformed or colliding existing proposal is refused and never replaced', async t => {
  const x = await setup(t), options = await approve(x.options);
  await mkdir(x.outputDir);
  const first = await receiveHandoff(options);
  const card = JSON.parse(await readFile(first.path, 'utf8'));
  card.source.signalSha256 = 'f'.repeat(64);
  const collision = JSON.stringify(card); await writeFile(first.path, collision);
  await assert.rejects(receiveHandoff(options), /existing proposal/);
  assert.equal(await readFile(first.path, 'utf8'), collision);
  await writeFile(first.path, 'PRIVATE_SENTINEL invalid');
  await assert.rejects(receiveHandoff(options), error => /existing proposal/.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'));
  assert.equal(await readFile(first.path, 'utf8'), 'PRIVATE_SENTINEL invalid');
});

test('file reads are byte-bounded, regular and strict UTF-8', async t => {
  const x = await setup(t);
  await writeFile(x.input, Buffer.alloc(MAX_HANDOFF_BYTES + 1, 32));
  await assert.rejects(receiveHandoff(x.options), /size/);
  await writeFile(x.input, Buffer.from([0xff, 0xfe, 0x41]));
  await assert.rejects(receiveHandoff(x.options), /UTF-8/);
  await assert.rejects(readBoundedFile(x.dir), /regular file/);
  assert.deepEqual(await readdir(x.dir), ['handoff.json']);
});

test('real CLI defaults to JSON preview and rejects incomplete/unknown options without writes', async t => {
  const x = await setup(t);
  const script = new URL('../adapters/receive-handoff.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [fileURLToPath(script), ...args], { encoding: 'utf8' });
  const result = run(['--input', x.input, '--project', 'alibi']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'preview');
  for (const args of [['--execute'], ['--input', x.input, '--input', x.input], ['--input', x.input, '--project']]) {
    assert.notEqual(run(args).status, 0);
  }
  assert.deepEqual(await readdir(x.dir), ['handoff.json']);
});
