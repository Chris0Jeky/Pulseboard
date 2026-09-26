-- 0003-statistics-dimensions.sql: idempotent v2 -> v3 migration (USAGE_PLAN.md slice 2, #103).
-- Adds per-dimension daily totals. A dimension row is never keyed by event, route, release or
-- another dimension, has no timestamp finer than the UTC day, and is stored WITHOUT ROWID so its
-- physical order is its key, not insertion order. This makes re-joining a request's rows harder;
-- it does not make tiny populations anonymous (USAGE_PLAN.md). Re-running this file is a no-op.
CREATE TABLE IF NOT EXISTS statistics_dimensions (
  project TEXT NOT NULL, day TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL,
  n INTEGER NOT NULL, PRIMARY KEY (project, day, dimension, value)
) WITHOUT ROWID;
INSERT INTO schema_version(id, version) VALUES (1, 3)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
