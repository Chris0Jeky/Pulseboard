-- 0004-product-events.sql: idempotent v3 -> v4 migration (USAGE_PLAN.md slice 3, collector v4, #104).
-- Adds product events (diagnostics and journeys). Additive only: no existing table, row or index is changed.
-- `session` is a per-tab random id or NULL; `props` is bounded JSON after server-side redaction and `redacted`
-- counts the personal keys removed. No IP, User-Agent string, page URL or cross-visit identifier is stored.
-- product_events_day serves 90-day retention. Re-running this file is a no-op, and an older marker never wins.
CREATE TABLE IF NOT EXISTS product_events (
  project TEXT NOT NULL, received INTEGER NOT NULL, day TEXT NOT NULL, session TEXT, seq INTEGER NOT NULL,
  name TEXT NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL, ms INTEGER NOT NULL, props TEXT NOT NULL,
  redacted INTEGER NOT NULL, country TEXT NOT NULL, region TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL,
  device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_events_name ON product_events(project, day, name);
CREATE INDEX IF NOT EXISTS product_events_session ON product_events(project, session, seq);
CREATE INDEX IF NOT EXISTS product_events_day ON product_events(day);
INSERT INTO schema_version(id, version) VALUES (1, 4)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
