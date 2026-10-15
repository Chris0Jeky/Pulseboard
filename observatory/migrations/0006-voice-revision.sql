-- 0006-voice-revision.sql: v5 -> v6 migration (docs/VOICES.md, survey contract v2, #218).
-- Adds voice_survey.revision, the producer's edit revision from pulseboard.survey/2. Nullable: every existing row and
-- every v1 write stays unrevisioned (NULL), and a stored revision is replaced only by a higher one. Additive only: no
-- row, index or other table changes. SQLite has no ADD COLUMN IF NOT EXISTS, so unlike 0002-0005 a re-run is not a
-- silent no-op: it fails on "duplicate column name: revision" and changes nothing. An older marker never wins.
ALTER TABLE voice_survey ADD COLUMN revision INTEGER;
INSERT INTO schema_version(id, version) VALUES (1, 6)
  ON CONFLICT(id) DO UPDATE SET version = MAX(schema_version.version, excluded.version);
