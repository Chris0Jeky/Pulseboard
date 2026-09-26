// SPDX-License-Identifier: GPL-3.0-only
import { sourcesFrom, authorized, validBatch, boundedBody } from './contracts.mjs';
import { ingest, snapshot, ready, maintain } from './store.mjs';
export const WATCH_HEADERS = Object.freeze({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value),
  { status, headers: { ...WATCH_HEADERS, ...extra } });
export async function handleWatch(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/watch/')) return null;
  try {
    if (url.pathname === '/v1/watch/snapshot' || url.pathname === '/v1/watch/readyz') {
      if (!await authorized(request, env.WATCH_READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
      if (request.method !== 'GET') return json({ error: 'method' }, 405, { Allow: 'GET' });
      if (url.search) return json({ error: 'query' }, 400);
      const sources = sourcesFrom(env);
      if (url.pathname.endsWith('/readyz')) return json({ ready: true, schema: await ready(env.DB),
        enabled: env.WATCH_ENABLED === 'true', configuredSources: sources.length });
      return json(await snapshot(env.DB, sources, env.WATCH_ENABLED === 'true', now));
    }
    const match = /^\/v1\/watch\/events\/([a-z][a-z0-9-]{0,47})$/.exec(url.pathname);
    if (!match) return json({ error: 'not_found' }, 404);
    const source = sourcesFrom(env).find(s => s.id === match[1]);
    if (!source || !await authorized(request, source.token)) return json({ error: 'unauthorized' }, 401);
    if (request.method !== 'POST') return json({ error: 'method' }, 405, { Allow: 'POST' });
    if (url.search || request.headers.has('origin')) return json({ error: 'server_only' }, 403);
    if (env.WATCH_ENABLED !== 'true' || !source.enabled) return json({ error: 'disabled' }, 503);
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) return json({ error: 'media_type' }, 415);
    let body;
    try { body = await boundedBody(request); } catch { return json({ error: 'invalid_body' }, 400); }
    if (!validBatch(body, source, now)) return json({ error: 'contract' }, 400);
    await ready(env.DB);
    const receipt = await ingest(env.DB, source, body.events, now);
    if (!receipt) return json({ error: 'daily_budget' }, 429, { 'Retry-After': '3600' });
    return json({ accepted: true, ...receipt }, 202);
  } catch { return json({ error: 'unavailable' }, 503); }
}
// This factory lets the legacy Observatory retain every route and scheduling behaviour.
export function withWatch(base) {
  return {
    async fetch(request, env, ctx) { return await handleWatch(request, env) ?? base.fetch(request, env, ctx); },
    async scheduled(controller, env, ctx, ...args) {
      // Retention does not depend on the collection switch; disabling ingestion must not retain old data forever.
      try { await maintain(env.DB); } catch { console.error('Watch retention unavailable. Check the migration and protected Watch readiness endpoint.'); }
      return base.scheduled(controller, env, ctx, ...args);
    },
  };
}
