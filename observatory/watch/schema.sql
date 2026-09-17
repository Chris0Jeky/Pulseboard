-- Additive, separate from Observatory schema_version. Apply before enabling Watch.
CREATE TABLE IF NOT EXISTS watch_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO watch_schema VALUES(1,1);
CREATE TABLE IF NOT EXISTS watch_events (
  source TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, received INTEGER NOT NULL,
  kind TEXT NOT NULL, asset TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(source,id)
);
CREATE INDEX IF NOT EXISTS watch_events_time ON watch_events(at,source);
CREATE INDEX IF NOT EXISTS watch_events_received ON watch_events(received);
CREATE TABLE IF NOT EXISTS watch_budget (
  source TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, receipt TEXT NOT NULL,
  PRIMARY KEY(source,day)
);
CREATE TABLE IF NOT EXISTS watch_sensors (
  source TEXT PRIMARY KEY, observed INTEGER NOT NULL, received INTEGER NOT NULL,
  sampling TEXT NOT NULL, dropped INTEGER NOT NULL
);
