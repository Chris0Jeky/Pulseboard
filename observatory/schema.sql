PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS budget (
  project TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL,
  receipt TEXT NOT NULL, PRIMARY KEY (project, day)
);
CREATE TABLE IF NOT EXISTS events (
  project TEXT NOT NULL, id TEXT NOT NULL, received INTEGER NOT NULL,
  session TEXT NOT NULL, seq INTEGER NOT NULL, event TEXT NOT NULL,
  route TEXT NOT NULL, release TEXT NOT NULL, value REAL,
  PRIMARY KEY (project, id)
);
CREATE INDEX IF NOT EXISTS events_time ON events(received);
CREATE INDEX IF NOT EXISTS events_project_time ON events(project, received);
CREATE TABLE IF NOT EXISTS probes (
  project TEXT PRIMARY KEY, state TEXT NOT NULL, failures INTEGER NOT NULL,
  successes INTEGER NOT NULL, opened INTEGER, checked INTEGER NOT NULL,
  status INTEGER NOT NULL, duration REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS probe_history (
  project TEXT NOT NULL, checked INTEGER NOT NULL, ok INTEGER NOT NULL,
  duration REAL NOT NULL, PRIMARY KEY(project, checked)
);

CREATE INDEX IF NOT EXISTS events_session_flow ON events(project,session,event,seq);
CREATE INDEX IF NOT EXISTS probe_history_time ON probe_history(checked);

-- Aggregate Alibi statistics (producer half). One row per project, UTC day,
-- event, route and release. No event IDs, session IDs, puzzle IDs, text,
-- URLs or IPs are stored here. Historical events are never dropped or mutated.
CREATE TABLE IF NOT EXISTS statistics (
  project TEXT NOT NULL, day TEXT NOT NULL, event TEXT NOT NULL,
  route TEXT NOT NULL, release TEXT NOT NULL, n INTEGER NOT NULL,
  received INTEGER NOT NULL, PRIMARY KEY (project, day, event, route, release)
);

-- Per-dimension daily totals (schema 3, USAGE_PLAN.md). Never keyed by event, route, release or another
-- dimension, no timestamp finer than the day, and WITHOUT ROWID so storage order is key order, not arrival order.
CREATE TABLE IF NOT EXISTS statistics_dimensions (
  project TEXT NOT NULL, day TEXT NOT NULL, dimension TEXT NOT NULL, value TEXT NOT NULL,
  n INTEGER NOT NULL, PRIMARY KEY (project, day, dimension, value)
) WITHOUT ROWID;

-- Product events (schema 4, USAGE_PLAN.md section 2): diagnostics and journeys. `session` is a per-tab random id
-- or NULL (Diagnostics only); `props` is bounded JSON after server-side redaction, `redacted` counts removed keys.
-- No IP, User-Agent string, page URL or cross-visit identifier is stored. Retention is 90 days.
CREATE TABLE IF NOT EXISTS product_events (
  project TEXT NOT NULL, received INTEGER NOT NULL, day TEXT NOT NULL, session TEXT, seq INTEGER NOT NULL,
  name TEXT NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL, ms INTEGER NOT NULL, props TEXT NOT NULL,
  redacted INTEGER NOT NULL, country TEXT NOT NULL, region TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL,
  device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_events_name ON product_events(project, day, name);
CREATE INDEX IF NOT EXISTS product_events_session ON product_events(project, session, seq);
CREATE INDEX IF NOT EXISTS product_events_day ON product_events(day);

-- Readiness asserts this row, so a database that predates a migration reports 503 instead of ready.
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL
);
INSERT INTO schema_version(id, version) VALUES (1, 4)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
