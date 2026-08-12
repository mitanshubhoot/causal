-- ── Causal v2.2: golden datasets + offline evals ─────────────────────
-- Closes the loop between "we found a bug in production" and "we can prove
-- the fix works, forever":
--
--   1. FINDING        a detector fires on a production trace (trace_findings)
--   2. GOLDEN ITEM    one click promotes that finding into a dataset_items row:
--                     the input that broke us, the behaviour we expected
--                     (derived from the RCA counterfactual), and a stable
--                     span_signature that identifies the failure mode
--   3. EVAL RUN       an eval_runs row replays every item in the dataset and
--                     judges current behaviour against the expectation
--   4. VERIFIED FIX   the run's score is the regression gate: an item whose
--                     span_signature no longer appears in production traffic
--                     (and whose expectation the judge accepts) is fixed
--
-- Two properties this schema deliberately keeps:
--   * a golden item OUTLIVES its source trace. trace_id is stored as plain
--     TEXT with no FK, so trace retention/purge can drop the production row
--     without destroying the golden case that came out of it. finding_id is a
--     real FK but ON DELETE SET NULL for the same reason.
--   * every table is org-scoped and indexed by (org_id, created_at DESC), the
--     access pattern every list endpoint uses.

-- 1. Datasets — a named collection of golden cases ---------------------
CREATE TABLE IF NOT EXISTS datasets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_datasets_org_created ON datasets (org_id, created_at DESC);

-- 2. Dataset items — one golden case, usually promoted from a finding --
CREATE TABLE IF NOT EXISTS dataset_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id     UUID NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  org_id         TEXT NOT NULL,
  -- provenance. Intentionally NOT a foreign key: the golden case must survive
  -- the purge of the production trace it was distilled from.
  trace_id       TEXT,
  finding_id     UUID REFERENCES trace_findings (id) ON DELETE SET NULL,
  -- {request, service, failingSpan:{...}, context:[...]} — what to replay
  input          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {behaviour, counterfactual, mustNotRecur, detector, source} — what "correct" means
  expected       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- stable id of the failure mode: "<kind>:<span-name>#<error-class>".
  -- An eval recognises a regression by seeing this signature again.
  span_signature TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_org_created ON dataset_items (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items (dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataset_items_signature ON dataset_items (org_id, span_signature);
-- One finding produces at most one golden item per dataset, so the one-click
-- promote button is idempotent instead of stuttering duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_items_finding
  ON dataset_items (dataset_id, finding_id) WHERE finding_id IS NOT NULL;

-- 3. Eval runs — one offline execution of a dataset --------------------
CREATE TABLE IF NOT EXISTS eval_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      TEXT NOT NULL,
  dataset_id  UUID NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  model       TEXT,                          -- judge model, or 'deterministic'
  total       INTEGER NOT NULL DEFAULT 0 CHECK (total  >= 0),
  passed      INTEGER NOT NULL DEFAULT 0 CHECK (passed >= 0),
  failed      INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  score       NUMERIC(4, 3) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT eval_runs_tally_check CHECK (passed + failed <= total),
  CONSTRAINT eval_runs_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_org_started ON eval_runs (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs (dataset_id, started_at DESC);

-- 4. Eval results — one judged item within a run -----------------------
CREATE TABLE IF NOT EXISTS eval_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eval_run_id     UUID NOT NULL REFERENCES eval_runs (id) ON DELETE CASCADE,
  org_id          TEXT NOT NULL,
  dataset_item_id UUID REFERENCES dataset_items (id) ON DELETE SET NULL,
  passed          BOOLEAN NOT NULL DEFAULT false,
  score           NUMERIC(4, 3) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  -- what the system actually did: {recurred, occurrences, traceId, seenAt, ...}
  actual          JSONB,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_org_created ON eval_results (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results (eval_run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_eval_results_item ON eval_results (dataset_item_id, created_at DESC);
