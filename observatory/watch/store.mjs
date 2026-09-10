// SPDX-License-Identifier: GPL-3.0-only
import { DAY, LIMITS } from './contracts.mjs';
export const RULE_VERSION = 'watch-rules/1';
export async function ready(db) {
  const checks = ['SELECT source,id,at,received,kind,asset,data FROM watch_events LIMIT 0',
    'SELECT source,day,used,receipt FROM watch_budget LIMIT 0',
    'SELECT source,observed,received,sampling,dropped FROM watch_sensors LIMIT 0'];
  for (const q of checks) await db.prepare(q).all();
  if ((await db.prepare('SELECT version FROM watch_schema WHERE id=1').first())?.version !== 1) throw new Error('schema');
  return 1;
}
export async function ingest(db, source, events, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10), receipt = crypto.randomUUID();
  // Attempts consume budget, including retries. IDs deduplicate evidence, not admission cost.
  const reserve = db.prepare(`INSERT INTO watch_budget(source,day,used,receipt) SELECT ?,?,?,? WHERE ?<=?
    ON CONFLICT(source,day) DO UPDATE SET used=used+excluded.used,receipt=excluded.receipt
    WHERE used+excluded.used<=? RETURNING used`)
    .bind(source.id, day, events.length, receipt, events.length, source.dailyLimit, source.dailyLimit);
  const statements = [reserve];
  for (const e of events) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO watch_events(source,id,at,received,kind,asset,data)
      SELECT ?,?,?,?,?,?,? FROM watch_budget WHERE source=? AND day=? AND receipt=? RETURNING id`)
      .bind(source.id, e.id, e.at, now, e.kind, e.asset || 'sensor', JSON.stringify(e), source.id, day, receipt));
    if (e.kind === 'sensor.heartbeat') {
      // A replay must not make a dead producer look current. Both timestamps remain on the original receipt.
      statements.push(db.prepare(`INSERT INTO watch_sensors(source,observed,received,sampling,dropped)
        SELECT ?,?,?,?,? FROM watch_budget WHERE source=? AND day=? AND receipt=?
        AND EXISTS(SELECT 1 FROM watch_events WHERE source=? AND id=? AND received=? AND data=?)
        ON CONFLICT(source) DO UPDATE SET observed=excluded.observed,received=excluded.received,
        sampling=excluded.sampling,dropped=excluded.dropped WHERE excluded.observed>watch_sensors.observed`)
        .bind(source.id, e.at, now, e.sampling, e.dropped, source.id, day, receipt,
          source.id, e.id, now, JSON.stringify(e)));
    }
  }
  const result = await db.batch(statements);
  if (!result[0].results.length) return null;
  return { inserted: result.slice(1).reduce((n, r) => n + r.results.length, 0), charged: events.length,
    used: result[0].results[0].used };
}
export function coverage(source, sensor, now) {
  if (!source.enabled) return 'disabled';
  if (!sensor) return 'missing';
  if (sensor.observed > now || sensor.received > now) return 'clock-skew';
  if (now - Math.min(sensor.observed, sensor.received) > source.heartbeatSeconds * 3000) return 'stale';
  if (sensor.dropped > 0 || sensor.sampling !== 'full') return 'partial';
  return 'reporting';
}
const ruleDefs = {
  'auth.failure': [10, 'warning', 'Authentication failures clustered', 'Check the authentication logs and rate-limit policy. Repeated failures do not prove an account was compromised.'],
  'access.denied': [10, 'warning', 'Access denials clustered', 'Check the affected route and recent permission changes before attributing intent.'],
  'rate_limited': [5, 'warning', 'Rate limits are firing', 'Check demand, quota policy and source logs. Do not automatically block users.'],
  'waf.block': [5, 'warning', 'The edge is blocking requests', 'Review the WAF rule and false positives. A blocked request is not a successful intrusion.'],
  'http.error': [3, 'warning', 'The application handler is failing', 'Check server exceptions in the restricted log backend. No exception payload is stored here.'],
  'egress.unexpected': [1, 'high', 'Unexpected outbound destination class', 'Compare the destination policy with the release. Confirm with host or provider evidence.'],
  'host.unexpected': [1, 'high', 'Unexpected listener observed', 'Inspect the host firewall, bind address and owning service locally. A listener is not proof of public reachability.'],
  'exposure.unexpected': [1, 'warning', 'Endpoint response differs from its policy', 'Check routing and authentication. A 200 response or SPA fallback alone does not prove data exposure.'],
  'check.error': [1, 'warning', 'An exposure check could not finish', 'Check DNS, TLS and the scan scope. A failed check is not a passed security test.'],
  'scan.finding': [1, 'warning', 'Scanner findings need review', 'Open the original restricted scanner report. Validate applicability and false positives before fixing.'],
};
export function findingsFor(sources, aggregates, now) {
  const findings = [];
  for (const s of sources) {
    if (s.coverage !== 'reporting') findings.push({ id: `${s.id}:coverage`, source: s.id, project: s.project,
      asset: 'sensor', rule: 'sensor.coverage', severity: 'warning', count: null, windowSeconds: null,
      title: `Sensor is ${s.coverage}`, next: 'Check enablement, heartbeat delivery, sampling and dropped events. Quiet data is not proof of safety.' });
    if (s.budgetUsed >= s.budgetLimit * .8) findings.push({ id: `${s.id}:budget`, source: s.id, project: s.project,
      asset: 'sensor', rule: 'sensor.budget', severity: 'warning', count: s.budgetUsed, windowSeconds: null,
      title: 'Receipt budget is nearly used', next: 'Inspect volume and source-side aggregation. Budget exhaustion also rejects heartbeats; raising limits needs a storage-cost review.' });
    for (const a of aggregates.filter(x => x.source === s.id)) {
      const def = ruleDefs[a.kind];
      // Scanner/check receipts are relevant for the selected day; burst rules use the last five minutes.
      const dayRule = ['exposure.unexpected', 'check.error', 'scan.finding', 'host.unexpected'].includes(a.kind);
      const n = dayRule ? a.n : a.recent;
      if (def && n >= def[0]) findings.push({ id: `${s.id}:${a.asset}:${a.kind}`, source: s.id, project: s.project,
        asset: a.asset, rule: a.kind, severity: def[1], count: n, windowSeconds: dayRule ? 86400 : 300,
        title: def[2], next: def[3] });
      if (a.kind === 'http.request' && a.recent >= 20 && a.serverErrors >= 5 && a.serverErrors / a.recent >= .2)
        findings.push({ id: `${s.id}:${a.asset}:http.errors`, source: s.id, project: s.project, asset: a.asset,
          rule: 'http.errors', severity: 'warning', count: a.serverErrors, denominator: a.recent, windowSeconds: 300,
          title: 'Server errors increased', next: 'Compare this source and route with application logs. This can be a release defect, not an attack.' });
    }
  }
  return findings.map(f => ({ ...f, ruleVersion: RULE_VERSION, evaluatedAt: now, state: 'observation',
    limitation: 'Heuristic triage, not proof of compromise or a persistent incident.' }));
}
export async function snapshot(db, config, enabled, now = Date.now()) {
  await ready(db);
  const ids = config.map(s => s.id), slots = ids.map(() => '?').join(',') || 'NULL';
  const [groups, ledger, sensors, budget, oldest] = await db.batch([
    db.prepare(`SELECT source,asset,kind,COUNT(*) AS n,MAX(at) AS last,
      SUM(CASE WHEN at>=? THEN 1 ELSE 0 END) AS recent,
      SUM(CASE WHEN at>=? AND CAST(json_extract(data,'$.status') AS INTEGER)>=500 THEN 1 ELSE 0 END) AS serverErrors
      FROM watch_events WHERE at>=? AND at<? AND source IN (${slots}) GROUP BY source,asset,kind`)
      .bind(now - 300000, now - 300000, now - DAY, now, ...ids),
    db.prepare(`SELECT source,received,data FROM watch_events WHERE at>=? AND at<? AND source IN (${slots})
      ORDER BY at DESC,source,id LIMIT ?`).bind(now - DAY, now, ...ids, LIMITS.ledger),
    db.prepare(`SELECT source,observed,received,sampling,dropped FROM watch_sensors WHERE source IN (${slots})`).bind(...ids),
    db.prepare(`SELECT source,used FROM watch_budget WHERE day=? AND source IN (${slots})`)
      .bind(new Date(now).toISOString().slice(0, 10), ...ids),
    db.prepare('SELECT MIN(received) AS oldest FROM watch_events'),
  ]);
  const sources = config.map(s => {
    const sensor = sensors.results.find(x => x.source === s.id) || null;
    return { id: s.id, project: s.project, environment: s.environment, kind: s.kind,
      assets: s.assets, enabled: enabled && s.enabled, heartbeatSeconds: s.heartbeatSeconds,
      coverage: coverage({ ...s, enabled: enabled && s.enabled }, sensor, now), sensor,
      budgetUsed: budget.results.find(x => x.source === s.id)?.used || 0, budgetLimit: s.dailyLimit };
  });
  return { schema: 'pulseboard.security-snapshot/1', mode: 'live', generated: now, enabled,
    window: { start: now - DAY, end: now }, ruleVersion: RULE_VERSION, sources,
    aggregates: groups.results, findings: findingsFor(sources, groups.results, now),
    events: ledger.results.map(x => ({ source: x.source, received: x.received, ...JSON.parse(x.data) })),
    ledgerLimit: LIMITS.ledger, retentionDays: LIMITS.retentionDays,
    retentionOverdue: oldest.results[0]?.oldest != null && oldest.results[0].oldest < now - LIMITS.retentionDays * DAY,
    limitations: ['Admitted server receipts, not verified people or total traffic.',
      'Reporting means a recent heartbeat, not complete security coverage.',
      'Edge and application events may describe the same request. Do not sum them as unique traffic.',
      'No IP addresses, bodies, URLs, credentials or free-text logs are accepted.',
      'Findings are observations. No automatic blocking, paging or remediation.'] };
}
export async function maintain(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM watch_events WHERE received<?').bind(now - LIMITS.retentionDays * DAY),
    db.prepare('DELETE FROM watch_budget WHERE day<?').bind(new Date(now - LIMITS.retentionDays * DAY).toISOString().slice(0, 10)),
    db.prepare('DELETE FROM watch_sensors WHERE received<?').bind(now - LIMITS.retentionDays * DAY),
  ]);
}
