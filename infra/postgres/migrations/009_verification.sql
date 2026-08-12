-- ── Fix verification, recorded rather than inferred ──────────────────
-- "Verified" must mean the repo's own test suite RAN against the patch and
-- passed. Previously nothing recorded that, so the UI inferred verification
-- from the existence of a PR — which is not evidence of anything.

ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS verified      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS verification  JSONB;   -- {ran,passed,exitCode,command,durationMs,reason}
ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS base_branch   TEXT;
ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS files_changed INTEGER;
ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS commit_message TEXT;
ALTER TABLE rca_runs ADD COLUMN IF NOT EXISTS commit_author  TEXT;

COMMENT ON COLUMN rca_runs.verified IS
  'True ONLY when the test suite was executed against the patch and passed. Opening a PR does not set this.';
