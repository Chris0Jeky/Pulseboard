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
const READ_TOKEN = process.env.READ_TOKEN || randomBytes(32).toString('hex');
const portText = process.env.PORT || '8788';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('PORT must be 1..65535');
const port = Number(portText);
const env = { DB, READ_TOKEN, COLLECT_ENABLED: process.env.COLLECT_ENABLED || 'false',
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
  console.log('Read token (paste into the desk; not persisted): ' + READ_TOKEN);
  console.log('Collection is ' + (env.COLLECT_ENABLED === 'true' ? 'enabled.' : 'disabled.'));
  console.log('Local runner does not schedule external probes. Cloudflare cron or an explicit probe command does.');
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close(() => { DB.close(); process.exit(0); });
  server.closeIdleConnections();
});
