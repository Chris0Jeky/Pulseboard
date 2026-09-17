import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const sourceUrl = new URL('../src/local.mjs', import.meta.url);

test('local runner exposes a bounded HTTP and process-lifecycle contract', async () => {
  const source = readFileSync(sourceUrl, 'utf8');
  // Fail before importing the old side-effectful module: importing it currently starts port 8788 and never returns.
  for (const seam of ['parsePort', 'resolveReadToken', 'runnerBanner', 'startLocalRunner', 'installShutdownHooks']) {
    assert.match(source, new RegExp(`export (?:async )?function ${seam}\\b`), `missing ${seam} test seam`);
  }

  const { parsePort, resolveReadToken, runnerBanner, startLocalRunner, installShutdownHooks } = await import(sourceUrl.href + '?contract=1');
  assert.equal(parsePort('8788'), 8788);
  for (const invalid of ['0', '65536', '-1', '8.5', 'not-a-port', '']) assert.throws(() => parsePort(invalid), /1\.\.65535/);

  const suppliedToken = 's'.repeat(32);
  const supplied = resolveReadToken({ READ_TOKEN: suppliedToken }, () => { throw new Error('randomness must not run'); });
  assert.deepEqual(supplied, { token: suppliedToken, supplied: true });
  const suppliedBanner = runnerBanner({ origin: 'http://127.0.0.1:8788', ...supplied, collectEnabled: false, collectProjects: '' });
  assert.equal(suppliedBanner.join('\n').includes(suppliedToken), false);
  assert.match(suppliedBanner.join('\n'), /not printed/i);

  const generated = resolveReadToken({}, size => Buffer.alloc(size, 7));
  assert.equal(generated.supplied, false);
  assert.equal(generated.token, '07'.repeat(32));
  assert.match(runnerBanner({ origin: 'http://127.0.0.1:8788', ...generated, collectEnabled: false, collectProjects: '' }).join('\n'), new RegExp(generated.token));

  let observed;
  const runner = await startLocalRunner({
    port: 0,
    host: '127.0.0.1',
    DB: { marker: 'db' },
    READ_TOKEN: suppliedToken,
    COLLECT_ENABLED: 'false',
    COLLECT_PROJECTS: '',
    requestHandler: async (request, env) => {
      observed = {
        url: request.url,
        method: request.method,
        contentLength: request.headers.get('content-length'),
        contentType: request.headers.get('content-type'),
        body: await request.text(),
        token: env.READ_TOKEN,
      };
      return new Response('translated', { status: 201, headers: { 'X-Runner-Test': 'yes' } });
    },
  });
  try {
    assert.match(runner.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(new URL(runner.origin).port, '0');
    const body = JSON.stringify({ event: 'translation' });
    const response = await fetch(runner.origin + '/echo?sample=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-runner-test'), 'yes');
    assert.equal(await response.text(), 'translated');
    assert.deepEqual(observed, {
      url: runner.origin + '/echo?sample=1',
      method: 'POST',
      contentLength: String(Buffer.byteLength(body)),
      contentType: 'application/json',
      body,
      token: suppliedToken,
    });
  } finally {
    await runner.close();
  }

  const processLike = new EventEmitter();
  let closes = 0, exitCode = null;
  processLike.exit = code => { exitCode = code; };
  const removeHooks = installShutdownHooks({ processLike, close: async () => { closes += 1; } });
  processLike.emit('SIGINT');
  processLike.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(exitCode, 0);
  removeHooks();
  assert.equal(processLike.listenerCount('SIGINT'), 0);
  assert.equal(processLike.listenerCount('SIGTERM'), 0);
});
