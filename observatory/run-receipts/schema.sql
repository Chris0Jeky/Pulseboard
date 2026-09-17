CREATE TABLE IF NOT EXISTS private_run_receipts (
  receipt_key TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generated INTEGER NOT NULL,
  coverage_start INTEGER NOT NULL,
  coverage_end INTEGER NOT NULL,
  coverage_complete INTEGER NOT NULL CHECK (coverage_complete IN (0, 1)),
  coverage_limitations TEXT NOT NULL,
  started INTEGER NOT NULL,
  ended INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled', 'timed-out', 'skipped')),
  attempt INTEGER NOT NULL CHECK (attempt >= 1 AND attempt <= 100),
  retry_of TEXT,
  resources TEXT NOT NULL,
  cost_kind TEXT CHECK (cost_kind IS NULL OR cost_kind IN ('actual', 'estimated', 'subscription-allocation')),
  cost_minor INTEGER,
  cost_currency TEXT,
  cost_source_time INTEGER,
  outcome_state TEXT NOT NULL CHECK (outcome_state IN ('verified-accepted', 'verified-rejected', 'unverified', 'not-applicable')),
  verification_ref TEXT,
  imported INTEGER NOT NULL,
  UNIQUE (source_kind, source_id, run_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_private_run_receipts_project_window
  ON private_run_receipts(project_id, started, ended);

CREATE INDEX IF NOT EXISTS idx_private_run_receipts_source
  ON private_run_receipts(source_kind, source_id, generated);

-- Preflight reads cannot serialize competing importers. Enforce immutable evidence
-- at insertion so a conflict aborts the enclosing batch, while exact repeats stay idempotent.
CREATE TRIGGER IF NOT EXISTS private_run_receipts_reject_conflicting_identity
BEFORE INSERT ON private_run_receipts
WHEN EXISTS (
  SELECT 1 FROM private_run_receipts
  WHERE receipt_key = NEW.receipt_key AND content_hash <> NEW.content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'Conflicting run receipt identity');
END;
