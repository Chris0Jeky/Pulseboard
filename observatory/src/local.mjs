import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './sqlite.mjs';
import { handle } from './worker.mjs';
import { assets } from './assets.mjs';
mkdirSync(new URL('../.data/', import.meta.url), { recursive: true });
const DB = openDatabase(fileURLToPath(new URL('../.data/observatory.sqlite', import.meta.url)));
DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const supplied = typeof process.env.READ_TOKEN === 'string' && process.env.READ_TOKEN.length > 0;
const READ_TOKEN = supplied ? process.env.READ_TOKEN : randomBytes(32).toString('hex');
if (supplied && READ_TOKEN.length < 32) console.error('READ_TOKEN is shorter than 32 characters; every authenticated read will be refused with 401.');
const portText = process.env.PORT || '8788';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('PORT must be 1..65535');
const port = Number(portText);
const env = { DB, READ_TOKEN, COLLECT_ENABLED: process.env.COLLECT_ENABLED || 'false', COLLECT_PROJECTS: process.env.COLLECT_PROJECTS || '',
  ASSETS: { async fetch(request) {
    const entry = assets.get(new URL(request.url).pathname);
    if (!entry) return new Response('', { status: 404 });
    const [file, type] = entry;
    return new Response(readFileSync(new URL('../public/' + file, import.meta.url)), { headers: { 'Content-Type': type } });
  } } };
const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
  try {
    const method = req.method || 'GET';
    const request = new Request(`http://127.0.0.1:${port}` + req.url, { method, headers: req.headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Unavailable'); }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Pulseboard Desk: http://127.0.0.1:${port}`);
  // Only a token this process generated is safe to print; one supplied by the operator stays where they put it.
  console.log(supplied ? 'Read token: using READ_TOKEN from the environment; it is not printed here.'
    : 'Read token (generated for this run; paste into the desk; not persisted): ' + READ_TOKEN);
  console.log('Collection is ' + (env.COLLECT_ENABLED === 'true' ? 'enabled for: ' + (env.COLLECT_PROJECTS || '(no project listed in COLLECT_PROJECTS)') : 'disabled.'));
  console.log('Local runner never probes the public sites: there is no local probe command, and egress stays off. Cloudflare cron does the probing in a deployment.');
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close(() => { DB.close(); process.exit(0); });
  server.closeIdleConnections();
});
