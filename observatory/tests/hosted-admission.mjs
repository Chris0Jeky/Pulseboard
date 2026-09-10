// Hosted admission gate (docs/ROLLOUT.md): posts one contract-valid batch to a deployed collector and asserts the
// status the operator expects. Dependency-free; run it from observatory/ with Node 22+.
//   node tests/hosted-admission.mjs --origin https://<preview>.workers.dev --project mdviewer --events 1 --expect 202
//   node tests/hosted-admission.mjs --origin ... --project mdviewer --events 1 --expect 202 --repeat   # identical batch twice
//   node tests/hosted-admission.mjs --origin ... --project commitatlas --events 2 --expect 429         # only after the preview was deployed with dailyLimit 1 (ROLLOUT.md step 4)
// It never prints response bodies beyond the collector's fixed error keys, and it sends no token: admission needs none.
import { projects } from '../src/projects.mjs';

const KNOWN = ['origin', 'project', 'events', 'expect', 'repeat', 'allow-production'];
const args = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--') || !KNOWN.includes(argv[i].slice(2))) { console.error('Unknown argument: ' + argv[i]); process.exit(2); }
  const next = argv[i + 1]; args[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? 'true' : (i++, next);
}
const origin = args.origin, id = args.project, count = Number(args.events ?? 1), expect = Number(args.expect ?? 202);
if (!origin || !Object.hasOwn(projects, id) || !projects[id].origin || !(count >= 1 && count <= 20) || !expect) {
  console.error('Usage: --origin <collector origin> --project <registered id> [--events 1..20] [--expect 202] [--repeat] [--allow-production]');
  process.exit(2);
}
// Synthetic events must never reach the production collector: refuse its hostname unless the operator says so explicitly.
if (/^pulseboard-observatory\./.test(new URL(origin).hostname) && args['allow-production'] !== 'true') {
  console.error('Refusing the production collector; this script writes synthetic events. Use a preview origin, or pass --allow-production deliberately.');
  process.exit(2);
}
const project = projects[id], session = crypto.randomUUID();
const batch = { events: Array.from({ length: count }, (_, i) => ({ v: 1, id: crypto.randomUUID(), session, seq: i + 1, event: 'page.view', route: 'home', release: 'unattributed' })) };
const post = () => fetch(origin + '/v1/collect/' + id, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
  headers: { Origin: project.origin, 'Content-Type': 'application/json', 'User-Agent': 'Pulseboard-Observatory-gate/0.1' }, body: JSON.stringify(batch) });
let failed = false;
for (const round of args.repeat === 'true' ? [1, 2] : [1]) {
  const r = await post();
  let key = ''; try { const body = await r.json(); key = body.error ?? (body.accepted ? 'accepted' : ''); } catch { key = 'unparseable'; }
  const ok = r.status === expect;
  failed ||= !ok;
  console.log(`${ok ? 'ok ' : 'FAIL'} round ${round}: ${id} x${count} -> ${r.status} ${key}` +
    (r.headers.get('retry-after') ? ` retry-after=${r.headers.get('retry-after')}` : '') +
    ` cors=${r.headers.get('access-control-allow-origin') === project.origin ? 'origin' : 'missing'} (expected ${expect})`);
}
const ready = await fetch(origin + '/readyz', { headers: { 'User-Agent': 'Pulseboard-Observatory-gate/0.1' }, signal: AbortSignal.timeout(15000) });
console.log(`readyz ${ready.status} ${(await ready.text()).replace(/\s+/g, ' ').slice(0, 80)}`);
process.exit(failed || ready.status !== 200 ? 1 : 0);
