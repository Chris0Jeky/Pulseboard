/** Local, synthetic query evidence. Never opens a supplied database or contacts D1. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio, WINDOWS } from '../src/portfolio.mjs';
import { projects } from '../src/projects.mjs';
import { assertPortfolio } from '../public/desk-bridge.mjs';
import { profileDatabase } from '../tests/helpers/portfolio-profile.mjs';

const DAY = 86_400_000, NOW = Date.UTC(2026, 9, 7, 12);
const SHAPES = ['single-session', 'many-sessions', 'duration-heavy'];
const EVENTS = ['puzzle.started', 'puzzle.failed', 'puzzle.started', 'puzzle.completed', 'action.requested', 'action.completed'];
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const fingerprintFiles = ['../src/portfolio.mjs', '../src/operations.mjs', '../src/sqlite.mjs', '../schema.sql',
  './profile-portfolio.mjs', '../tests/helpers/portfolio-profile.mjs'];

export async function profilePortfolio({ eventsPerDay = projects.alibi.dailyLimit, shape = 'all' } = {}) {
  if (!Number.isSafeInteger(eventsPerDay) || eventsPerDay < 1 || eventsPerDay > projects.alibi.dailyLimit ||
    !['all', ...SHAPES].includes(shape)) throw new RangeError('Unsupported fixture size or shape');
  const profiles = [];
  let sqliteVersion;
  for (const selected of shape === 'all' ? SHAPES : [shape]) {
    const db = openDatabase();
    try {
      db.exec(schema);
      sqliteVersion = (await db.prepare('SELECT sqlite_version() AS version').first()).version;
      const count = 14 * eventsPerDay;
      // Deliberately bounded by the existing Alibi admission cap, over its longest read.
      await db.batch(Array.from({ length: count }, (_, i) => {
        const day = Math.floor(i / eventsPerDay);
        const event = selected === 'duration-heavy' && i % 2 === 0 ? 'duration.ms' : EVENTS[i % EVENTS.length];
        return db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)').bind('alibi', `synthetic-${i}`,
          NOW - 14 * DAY + Math.floor(i * DAY / eventsPerDay),
          selected === 'many-sessions' ? `synthetic-session-${Math.floor(i / 12)}` : 'synthetic-session',
          i + 1, event, day % 2 ? 'home' : 'puzzle', day % 3 ? '0.11.4' : '0.11.5',
          event === 'duration.ms' ? i % 10000 : null);
      }));
      for (const days of WINDOWS) {
        const tracked = profileDatabase(db), before = performance.now();
        const snapshot = assertPortfolio(await readPortfolio(tracked.db, { now: NOW, days }));
        const durationMs = performance.now() - before;
        const alibi = snapshot.projects.find(p => p.id === 'alibi');
        if (alibi.totals.events !== eventsPerDay * days) throw new Error('Synthetic window reconciliation failed');
        const statements = [];
        for (const [index, statement] of tracked.statements.entries()) {
          const plan = await db.prepare('EXPLAIN QUERY PLAN ' + statement.query).bind(...statement.args).all();
          statements.push({ index, durationMs: statement.durationMs, resultRows: statement.resultRows,
            plan: plan.results.map(row => row.detail) });
        }
        const { attempts, completed, failed, open, retries } = alibi.operations[0];
        profiles.push({ shape: selected, days, seededRows: count, windowEventRows: alibi.totals.events,
          durationMs, responseBytes: Buffer.byteLength(JSON.stringify(snapshot)), d1RowsRead: null,
          operationCounts: { attempts, completed, failed, open, retries }, statements });
      }
    } finally { db.close(); }
  }
  const sourceSha256 = Object.fromEntries(fingerprintFiles.map(path => [path,
    createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')]));
  return { schema: 'pulseboard.local-query-profile/1', synthetic: true, storage: 'isolated in-memory SQLite',
    node: process.version, sqlite: sqliteVersion, platform: process.platform, arch: process.arch,
    eventsPerDay, admissionCap: projects.alibi.dailyLimit, fixtureNow: NOW, sourceSha256,
    processMaxRssKiB: process.resourceUsage().maxRSS, profiles,
    limitations: [
      'Local timings and query plans are not hosted D1 latency, billing or rows-read evidence.',
      'seededRows and windowEventRows describe fixture cardinality, not database rows scanned.',
      'Process maximum RSS is a whole-process high-water mark, not isolated query peak memory.',
      'One bounded Alibi population does not certify all-project capacity or justify higher admission limits.',
      'Synthetic sequence shapes are reproducible stress cases, not production traffic measurements.',
    ] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {}, seen = new Set();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i], value = args[i + 1];
      if (!['--events-per-day', '--shape'].includes(key) || !value || seen.has(key)) throw new Error('Invalid arguments');
      seen.add(key);
      if (key === '--events-per-day') {
        if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid event count');
        options.eventsPerDay = Number(value);
      } else options.shape = value;
    }
    console.log(JSON.stringify(await profilePortfolio(options), null, 2));
  } catch {
    console.error('Usage: node tools/profile-portfolio.mjs [--events-per-day 1..1000] [--shape all|single-session|many-sessions|duration-heavy]');
    process.exitCode = 1;
  }
}
