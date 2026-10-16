-- EXPERIMENTAL: scratch databases only. Not a production migration or core schema change.
-- Apply after observatory/schema.sql. All active survey writers must use the experiment
-- handler before v2 intake is enabled; an older Worker does not enforce the revision guard.
CREATE TABLE IF NOT EXISTS voice_survey_revisions (
  project TEXT NOT NULL, survey TEXT NOT NULL, subject TEXT NOT NULL, respondent TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (project, survey, subject, respondent),
  FOREIGN KEY (project, survey, subject, respondent)
    REFERENCES voice_survey(project, survey, subject, respondent) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS survey_revision_schema (
  id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1)
);
INSERT INTO survey_revision_schema(id,version) VALUES(1,1) ON CONFLICT(id) DO NOTHING;
