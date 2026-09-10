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

-- Readiness asserts this row, so a database that predates a migration reports 503 instead of ready.
CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL
);
INSERT INTO schema_version(id, version) VALUES (1, 1)
  ON CONFLICT(id) DO UPDATE SET version = excluded.version;
