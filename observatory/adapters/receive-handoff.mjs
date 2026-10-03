// SPDX-License-Identifier: GPL-3.0-only
/** A local sample receiver, not a Taskdeck/agent connector. Preview is read-only; acceptance creates proposed data only. */
import { constants } from 'node:fs';
import { open, lstat, link, unlink, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { projects } from '../src/projects.mjs';
import { previewHandoff, MAX_HANDOFF_BYTES } from '../public/desk-handoff.mjs';

const refuse = reason => { throw new Error(`Handoff receiver: ${reason}`); };

/** Check type before opening (no FIFOs), then check again on the descriptor; read at most limit+1 bytes. */
export async function readBoundedFile(path, limit = MAX_HANDOFF_BYTES) {
  if (typeof path !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 2 * MAX_HANDOFF_BYTES) refuse('invalid file input');
  let metadata;
  try { metadata = await lstat(path); } catch { refuse('input must be an accessible regular file'); }
  if (!metadata.isFile() || metadata.isSymbolicLink()) refuse('input must be a regular file, not a link');
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const stats = await handle.stat();
    if (!stats.isFile()) refuse('input must be a regular file');
    if (stats.size > limit) refuse('file size exceeds limit');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) refuse('file size exceeds limit');
    try {
      // Keep a BOM visible so JSON parsing rejects it instead of changing the bytes being reviewed.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
    } catch { refuse('file is not valid UTF-8'); }
  } finally { await handle?.close(); }
}

async function outputDirectory(path) {
  if (typeof path !== 'string' || !path) refuse('an existing owner-controlled output directory is required');
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) refuse('output directory must not be a link');
    return await realpath(path);
  } catch { refuse('an existing owner-controlled output directory is required'); }
}

async function existingResult(path, proposal) {
  let existing;
  try { existing = JSON.parse(await readBoundedFile(path, 2 * MAX_HANDOFF_BYTES)); }
  catch { refuse('existing proposal is unreadable or invalid; not overwritten'); }
  if (existing?.schema !== 'pulseboard.proposal/1' || existing.status !== 'proposed'
    || existing.targetProject !== proposal.targetProject || !Array.isArray(existing.permissions) || existing.permissions.length
    || existing.source?.mode !== proposal.source.mode || existing.source?.signalSha256 !== proposal.source.signalSha256
    || existing.source?.fingerprint !== proposal.source.fingerprint || !/^[a-f0-9]{64}$/.test(existing.source?.contentSha256 || '')) {
    refuse('existing proposal identity conflicts; not overwritten');
  }
  return { status: existing.source.contentSha256 === proposal.source.contentSha256 ? 'duplicate' : 'repeat-observation',
    path, unchanged: true, message: 'Existing reviewed proposal retained. Review changed evidence separately; nothing was executed.' };
}

async function publishOnce(directory, proposal) {
  // Every filename component is a validated registry id, a closed mode, or a computed digest; never imported free text.
  const path = join(directory, `pulseboard-${proposal.source.mode}-${proposal.targetProject}-${proposal.source.fingerprint}.json`);
  const temp = join(directory, `.pulseboard-${randomUUID()}.tmp`);
  let handle, ownedTemp = false;
  try {
    handle = await open(temp, 'wx', 0o600);
    ownedTemp = true;
    await handle.writeFile(JSON.stringify(proposal, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    try { await link(temp, path); }
    catch (error) {
      if (error?.code === 'EEXIST') return await existingResult(path, proposal);
      refuse('atomic proposal publication unavailable; no existing proposal was replaced');
    }
    return { status: 'created', path, unchanged: false, message: 'Local proposal created. No Taskdeck task, network request or execution was performed.' };
  } finally {
    await handle?.close();
    if (ownedTemp) await unlink(temp).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export async function receiveHandoff({ input, targetProject, accept = false, reviewedSha256, outputDir,
  allowSynthetic = false, allowStale = false, now } = {}) {
  if (typeof targetProject !== 'string' || !Object.hasOwn(projects, targetProject)) refuse('target project must be a registered Pulseboard id');
  if (![accept, allowSynthetic, allowStale].every(value => typeof value === 'boolean')) refuse('acceptance switches must be booleans');
  const text = await readBoundedFile(input);
  const preview = await previewHandoff(text, { targetProject, now: now ?? Date.now() });
  if (!accept) return { status: 'preview', preview };
  if (typeof reviewedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reviewedSha256) || reviewedSha256 !== preview.reviewedFileSha256) refuse('reviewed file SHA-256 does not match; preview these exact bytes first');
  if (preview.source.mode === 'demo' && !allowSynthetic) refuse('synthetic evidence needs --allow-synthetic');
  if (preview.freshness === 'future') refuse('future-dated evidence is not accepted; check the source and review clocks');
  const stale = preview.freshness !== 'current';
  if (stale && !allowStale) refuse('stale evidence needs --allow-stale');
  const directory = await outputDirectory(outputDir);
  const proposal = { ...preview.proposal, review: { reviewedAt: preview.reviewedAt, freshness: preview.freshness,
    syntheticAccepted: preview.source.mode === 'demo' && allowSynthetic, staleAccepted: stale && allowStale } };
  return publishOnce(directory, proposal);
}

function optionsFrom(argv) {
  const options = {}, seen = new Set();
  const values = { '--input': 'input', '--project': 'targetProject', '--output-dir': 'outputDir', '--reviewed-sha256': 'reviewedSha256' };
  const flags = { '--accept': 'accept', '--allow-synthetic': 'allowSynthetic', '--allow-stale': 'allowStale' };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (seen.has(option)) refuse('duplicate command option');
    seen.add(option);
    if (Object.hasOwn(flags, option)) options[flags[option]] = true;
    else if (Object.hasOwn(values, option)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) refuse('missing command option value');
      options[values[option]] = value;
    } else refuse('unknown command option');
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') === '--help') {
    console.log('Preview: node adapters/receive-handoff.mjs --input handoff.json --project alibi\n'
      + 'Accept: add --accept --reviewed-sha256 <preview hash> --output-dir <existing directory>\n'
      + 'Synthetic/stale acceptance additionally requires --allow-synthetic / --allow-stale. Creates proposed data only.');
  } else {
    Promise.resolve().then(() => receiveHandoff(optionsFrom(process.argv.slice(2)))).then(result => {
      console.log(JSON.stringify(result, null, 2));
    }).catch(error => {
      // No raw payload, private field, stack or credential is included in CLI error output.
      console.error(error instanceof TypeError || /^Handoff receiver:/.test(error?.message || '') ? error.message : 'Handoff receiver: local operation unavailable');
      process.exitCode = 1;
    });
  }
}
