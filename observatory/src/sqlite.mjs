/** A small D1-compatible adapter for local development and real SQLite tests. */
import { DatabaseSync } from 'node:sqlite';
export function openDatabase(filename = ':memory:') {
  const sql = new DatabaseSync(filename);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  function prepare(query, args = []) {
    return {
      bind: (...values) => prepare(query, values),
      all: async () => ({ results: sql.prepare(query).all(...args) }),
      first: async () => sql.prepare(query).get(...args) ?? null,
      run: async () => ({ results: [], meta: sql.prepare(query).run(...args) }),
      _execute() {
        const statement = sql.prepare(query);
        if (statement.columns().length) return { results: statement.all(...args) };
        return { results: [], meta: statement.run(...args) };
      },
    };
  }
  return { prepare, exec: text => sql.exec(text), close: () => sql.close(),
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s._execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    } };
}
