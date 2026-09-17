import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { handle } from '../src/worker.mjs';

const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
const token = process.env.READ_TOKEN;
if (typeof token !== 'string' || token.length < 32) throw new Error('READ_TOKEN must be at least 32 characters');

const DB = openDatabase();
DB.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const env = {
  DB,
  READ_TOKEN: token,
  COLLECT_ENABLED: 'true',
  COLLECT_PROJECTS: 'alibi',
};
const origin = `http://127.0.0.1:${port}`;
const server = createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const request = new Request(origin + req.url, {
      method,
      headers: req.headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }),
    });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Unavailable');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
console.log(JSON.stringify({ origin }));

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close(() => { DB.close(); process.exit(0); });
  server.closeIdleConnections();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
