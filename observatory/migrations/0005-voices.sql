-- 0005-voices.sql: idempotent v4 -> v5 migration (docs/VOICES.md, Voices contract v1).
-- Adds the player-initiated Voices channel. Additive only: no existing table, row or index is changed.
-- voice_feedback holds written feedback a player pressed Send on: one row per (project, id), where id is the
-- device's idempotency key, so a resend stores nothing. No identifier, IP address, User-Agent string or page URL.
-- voice_survey holds survey answers and puzzle ratings: one row per (project, survey, subject, respondent), where
-- respondent is SHA-256(project + ':' + survey key), never the raw key; a resubmission replaces the row in place and
-- increments submissions. The day indexes serve the window reads and the 365-day (feedback) and 400-day (survey)
-- retention sweep. Re-running this file is a no-op, and an older marker never wins.
CREATE TABLE IF NOT EXISTS voice_feedback (
  project TEXT NOT NULL, id TEXT NOT NULL, received INTEGER NOT NULL, day TEXT NOT NULL, written TEXT NOT NULL,
  release TEXT NOT NULL, kind TEXT NOT NULL, route TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL,
  redacted INTEGER NOT NULL, device TEXT NOT NULL, country TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL,
  PRIMARY KEY (project, id)
);
CREATE INDEX IF NOT EXISTS voice_feedback_day ON voice_feedback(day);
CREATE TABLE IF NOT EXISTS voice_survey (
  project TEXT NOT NULL, survey TEXT NOT NULL, subject TEXT NOT NULL, respondent TEXT NOT NULL,
  first_received INTEGER NOT NULL, received INTEGER NOT NULL, day TEXT NOT NULL, release TEXT NOT NULL,
  answers TEXT NOT NULL, meta TEXT NOT NULL, comment TEXT NOT NULL, redacted INTEGER NOT NULL,
  device TEXT NOT NULL, country TEXT NOT NULL, submissions INTEGER NOT NULL,
  PRIMARY KEY (project, survey, subject, respondent)
);
CREATE INDEX IF NOT EXISTS voice_survey_day ON voice_survey(day);
INSERT INTO schema_version(id, version) VALUES (1, 5)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
