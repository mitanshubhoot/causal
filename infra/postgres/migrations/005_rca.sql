-- ── Causal v2: agentic RCA + fix PRs ─────────────────────────────────
-- A finding (from the detector) triggers an RCA run: root cause tied to a
-- commit, a counterfactual, and a proposed fix — optionally opened as a PR.

CREATE TABLE IF NOT EXISTS rca_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trace_id       TEXT NOT NULL REFERENCES traces (id) ON DELETE CASCADE,
  finding_id     UUID REFERENCES trace_findings (id) ON DELETE SET NULL,
  org_id         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'complete'
                   CHECK (status IN ('running', 'complete', 'needs_review', 'failed')),
  summary        TEXT,
  commit_sha     TEXT,
  file           TEXT,
  line           INTEGER,
  explanation    TEXT,
  counterfactual TEXT,
  confidence     NUMERIC(4, 3) NOT NULL DEFAULT 0,
  hops_upstream  INTEGER NOT NULL DEFAULT 1,
  fix_title      TEXT,
  fix_description TEXT,
  fix_diff       JSONB,                         -- [{kind,text}]
  pr_status      TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (pr_status IN ('proposed', 'opened', 'skipped')),
  pr_url         TEXT,
  pr_number      INTEGER,
  model          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rca_trace ON rca_runs (trace_id);
CREATE INDEX IF NOT EXISTS idx_rca_org_created ON rca_runs (org_id, created_at DESC);
