-- 0002-alibi-statistics.sql: idempotent v1 -> v2 migration for the Alibi-only
-- aggregate admission producer slice. Adds the statistics table without
-- dropping or mutating historical events, then records schema version 2.
-- Re-running this file is a no-op.
CREATE TABLE IF NOT EXISTS statistics (
  project TEXT NOT NULL, day TEXT NOT NULL, event TEXT NOT NULL,
  route TEXT NOT NULL, release TEXT NOT NULL, n INTEGER NOT NULL,
  received INTEGER NOT NULL, PRIMARY KEY (project, day, event, route, release)
);
INSERT INTO schema_version(id, version) VALUES (1, 2)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
