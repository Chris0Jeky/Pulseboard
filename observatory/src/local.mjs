import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './sqlite.mjs';
import { handle } from './worker.mjs';
mkdirSync(new URL('../.data/', import.meta.url), { recursive: true });
const DB = openDatabase(fileURLToPath(new URL('../.data/observatory.sqlite', import.meta.url)));
DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const READ_TOKEN = process.env.READ_TOKEN || randomBytes(32).toString('hex');
const env = { DB, READ_TOKEN, COLLECT_ENABLED: process.env.COLLECT_ENABLED || 'false',
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!['index.html', 'dashboard.mjs', 'dashboard.css'].includes(file)) return new Response('', { status: 404 });
    return new Response(readFileSync(new URL('../public/' + file, import.meta.url)), {
      headers: { 'Content-Type': file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' } });
  } } };
const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
  try {
    const method = req.method || 'GET';
    const request = new Request('http://127.0.0.1:8788' + req.url, { method, headers: req.headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Unavailable'); }
});
server.listen(8788, '127.0.0.1', () => {
  console.log('Local dashboard: http://127.0.0.1:8788');
  console.log('Read token (paste into dashboard; not persisted): ' + READ_TOKEN);
  console.log('Local runner does not schedule external probes. Cloudflare cron or the explicit probe command does.');
});
process.on('SIGINT', () => server.close(() => { DB.close(); process.exit(0); }));
