/** Test/tool instrumentation: timings are local SQLite measurements, never D1 rows_read. */
export function profileDatabase(db) {
  const statements = [];
  function prepare(query, args = []) {
    return {
      bind: (...values) => prepare(query, values),
      _execute() {
        const before = performance.now();
        const result = db.prepare(query).bind(...args)._execute();
        statements.push({ query, args, durationMs: performance.now() - before, resultRows: result.results.length });
        return result;
      },
    };
  }
  return { db: { prepare, batch: entries => db.batch(entries) }, statements };
}
