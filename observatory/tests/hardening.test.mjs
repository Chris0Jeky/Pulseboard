import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { install, buildEmbed } from '../adapters/build-embed.mjs';
import { validateEvent } from '../src/contracts.mjs';
import { projects } from '../src/projects.mjs';
test('installer rejects mismatched endpoints', () => {
  assert.throws(() => buildEmbed('mdviewer', { endpoint: 'https://collector.test/v1/collect/alibi' }), /exact HTTPS/);
});
test('installer refuses symlinked lock files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'observatory-test-')), outside = mkdtempSync(path.join(tmpdir(), 'observatory-outside-'));
  try {
    writeFileSync(path.join(outside, 'lock'), '{}'); symlinkSync(path.join(outside, 'lock'), path.join(root, 'observatory.lock.json'));
    assert.throws(() => install('mdviewer', root, 'public/observer.js'), /lock path/);
  } finally { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); }
});
test('Alibi standalone artifacts are gated even on the public origin', () => {
  const code = buildEmbed('alibi', { endpoint: 'https://collector.test/v1/collect/alibi' });
  const context = { URL, document: { readyState: 'complete' }, location: { origin: 'https://alibi-after-hours-preview.commit-atlas.workers.dev', protocol: 'https:', pathname: '/' }, navigator: {}, ALIBI_CONFIG: { standalone: true } };
  vm.runInNewContext(code, context); assert.equal(context.PulseboardUsage, null);
});
test('UUID fields cannot exploit implicit string coercion', () => {
  const event = { v: 1, id: crypto.randomUUID(), session: crypto.randomUUID(), seq: 1, event: 'page.view', route: 'home', release: 'unattributed' };
  assert.equal(validateEvent({ ...event, id: [event.id] }, projects.mdviewer), false);
  assert.equal(validateEvent({ ...event, session: [event.session] }, projects.mdviewer), false);
});
