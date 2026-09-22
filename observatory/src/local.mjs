import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './sqlite.mjs';
import { handle } from './worker.mjs';
import { collectionAdmission } from './admission.mjs';
import { assets } from './assets.mjs';
import { createGithubEvidence } from './github.mjs';
import { githubMap } from './github-map.mjs';

const SERVER_OPTIONS = { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 };

export function parsePort(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) throw new Error('PORT must be 1..65535');
  return Number(text);
}

export function resolveReadToken(env = process.env, random = randomBytes) {
  const supplied = typeof env.READ_TOKEN === 'string' && env.READ_TOKEN.length > 0;
  const token = supplied ? env.READ_TOKEN : Buffer.from(random(32)).toString('hex');
  return { token, supplied };
}

function admissionLines(admission) {
  return [
    ...(admission.valid ? [] : ['COLLECT_PROJECTS contains unknown or local-only ids: ' + admission.invalid.join(', ') + '. Collection fails closed and /readyz returns 503.']),
    'Collection switch is ' + (admission.enabled ? 'enabled' : 'disabled') + '; admitted projects: ' + (admission.admitted.join(', ') || '(none)') + '.',
  ];
}

export function runnerBanner({ origin, token, supplied, collectEnabled, collectProjects, githubEvidence = false }) {
  return [
    `Pulseboard Desk: ${origin}`,
    supplied ? 'Read token: using READ_TOKEN from the environment; it is not printed here.'
      : 'Read token (generated for this run; paste into the desk; not persisted): ' + token,
    ...admissionLines(collectionAdmission({ COLLECT_ENABLED: collectEnabled ? 'true' : 'false', COLLECT_PROJECTS: collectProjects })),
    githubEvidence ? `GitHub evidence: connector built from GITHUB_EVIDENCE_TOKEN (not printed); api.github.com is read only when the desk asks, for ${Object.keys(githubMap.projects).length} mapped project(s).`
      : 'GitHub evidence: off (no GITHUB_EVIDENCE_TOKEN); mapped items read unconfigured and nothing is requested.',
    'Local runner never probes the public sites: there is no local probe command, and egress stays off. Cloudflare cron does the probing in a deployment.',
  ];
}

/** Cache a complete asynchronous shutdown, including resources layered above the HTTP server. */
export function onceAsync(operation) {
  if (typeof operation !== 'function') throw new TypeError('operation is required');
  let promise = null;
  return () => promise ??= Promise.resolve().then(operation);
}

function localAssets() {
  return { async fetch(request) {
    const entry = assets.get(new URL(request.url).pathname);
    if (!entry) return new Response('', { status: 404 });
    const [file, type] = entry;
    return new Response(readFileSync(new URL('../public/' + file, import.meta.url)), { headers: { 'Content-Type': type } });
  } };
}

/** Start the HTTP bridge without touching process state. Port zero is reserved for programmatic tests. */
export async function startLocalRunner({
  port,
  host = '127.0.0.1',
  DB,
  READ_TOKEN,
  COLLECT_ENABLED = 'false',
  COLLECT_PROJECTS = '',
  ASSETS = localAssets(),
  GITHUB_EVIDENCE = null,
  requestHandler = handle,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be 0..65535');
  if (!DB) throw new TypeError('DB is required');
  if (typeof requestHandler !== 'function') throw new TypeError('requestHandler is required');

  const env = { DB, READ_TOKEN, COLLECT_ENABLED, COLLECT_PROJECTS, ASSETS, ...(GITHUB_EVIDENCE ? { GITHUB_EVIDENCE } : {}) };
  let origin = null;
  const server = createServer(SERVER_OPTIONS, async (req, res) => {
    try {
      const method = req.method || 'GET';
      const request = new Request(origin + req.url, {
        method,
        headers: req.headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
      });
      const response = await requestHandler(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Unavailable');
    }
  });

  await new Promise((accept, reject) => {
    const failed = error => { server.off('listening', listening); reject(error); };
    const listening = () => { server.off('error', failed); accept(); };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Local runner did not expose a TCP address');
  }
  const urlHost = host.includes(':') ? `[${host}]` : host;
  origin = `http://${urlHost}:${address.port}`;

  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = new Promise((accept, reject) => {
      if (!server.listening) { accept(); return; }
      server.close(error => error ? reject(error) : accept());
      server.closeIdleConnections();
    });
    return closePromise;
  };
  return { server, origin, env, close };
}

export function installShutdownHooks({ processLike = process, close }) {
  if (typeof close !== 'function') throw new TypeError('close is required');
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    Promise.resolve().then(close).then(
      () => processLike.exit(0),
      () => processLike.exit(1),
    );
  };
  for (const signal of ['SIGINT', 'SIGTERM']) processLike.on(signal, shutdown);
  return () => {
    for (const signal of ['SIGINT', 'SIGTERM']) processLike.off(signal, shutdown);
  };
}

export async function main(envVars = process.env, logger = console) {
  mkdirSync(new URL('../.data/', import.meta.url), { recursive: true });
  const DB = openDatabase(fileURLToPath(new URL('../.data/observatory.sqlite', import.meta.url)));
  try {
    DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    const { token, supplied } = resolveReadToken(envVars);
    if (supplied && token.length < 32) logger.error('READ_TOKEN is shorter than 32 characters; every authenticated read will be refused with 401.');
    const port = parsePort(envVars.PORT || '8788');
    const collectEnabled = envVars.COLLECT_ENABLED === 'true';
    const collectProjects = envVars.COLLECT_PROJECTS || '';
    // GitHub egress exists only when the operator supplies a token, and only for repositories in the reviewed mapping.
    const githubToken = envVars.GITHUB_EVIDENCE_TOKEN || '';
    const GITHUB_EVIDENCE = githubToken ? createGithubEvidence({ map: githubMap, token: githubToken }) : null;
    const runner = await startLocalRunner({
      port,
      host: '127.0.0.1',
      DB,
      READ_TOKEN: token,
      COLLECT_ENABLED: collectEnabled ? 'true' : 'false',
      COLLECT_PROJECTS: collectProjects,
      GITHUB_EVIDENCE,
    });
    for (const line of runnerBanner({ origin: runner.origin, token, supplied, collectEnabled, collectProjects, githubEvidence: !!GITHUB_EVIDENCE })) logger.log(line);
    const close = onceAsync(async () => { await runner.close(); DB.close(); });
    installShutdownHooks({ processLike: process, close });
    return { ...runner, close };
  } catch (error) {
    DB.close();
    throw error;
  }
}

const mainPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (mainPath && fileURLToPath(import.meta.url) === mainPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
