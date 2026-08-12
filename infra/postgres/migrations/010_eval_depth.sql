-- 010_eval_depth.sql — make a golden case checkable, and a run comparable.
--
-- 008 stored a case as prose: an `expected` blob and a free-text `reason` from
-- the judge. That is enough to render a verdict but not enough to defend one —
-- you cannot see WHICH expectation failed, whether the case moved since the
-- last release, or what the run cost.
--
-- This migration adds the three things that turn an eval from an opinion into
-- evidence:
--   1. assertions on the case      — named, machine-checkable expectations
--   2. per-assertion results       — which one failed, and with what detail
--   3. a delta against the previous run for the same case — regressions
--      surface on their own instead of being read off two lists side by side
--
-- Every column is additive with a default, so this is safe on a populated
-- database and re-runnable.

-- 1. The case: what it is, how hard it is, and what must hold ----------
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS title      TEXT;
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS assertions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS tags       TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS severity   TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE dataset_items ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'regression';

COMMENT ON COLUMN dataset_items.assertions IS
  'Array of {id, kind, description, target}. `kind` is one of must_not_raise, '
  'must_contain, must_not_contain, must_call_tool, must_confirm, '
  'latency_under_ms, cost_under_usd, no_unsourced_number. `target` is the '
  'expression the harness evaluates. A case with no assertions still runs — it '
  'just falls back to the signature-recurrence check alone.';

-- Constraints are added separately so a re-run does not fail on an existing one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dataset_items_severity_check') THEN
    ALTER TABLE dataset_items ADD CONSTRAINT dataset_items_severity_check
      CHECK (severity IN ('critical', 'high', 'medium'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dataset_items_difficulty_check') THEN
    ALTER TABLE dataset_items ADD CONSTRAINT dataset_items_difficulty_check
      CHECK (difficulty IN ('regression', 'edge-case', 'adversarial'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dataset_items_assertions_check') THEN
    ALTER TABLE dataset_items ADD CONSTRAINT dataset_items_assertions_check
      CHECK (jsonb_typeof(assertions) = 'array');
  END IF;
END $$;

-- 2. The run: what gated on it, who judged it, what it cost ------------
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS judge_model TEXT;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS release     TEXT;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS commit_sha  TEXT;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0;

COMMENT ON COLUMN eval_runs.release IS
  'The release this run gated. Two runs of the same dataset are comparable only '
  'through this — it is what a per-case history is keyed on.';

-- Comparing releases is the main read; make it an index scan.
CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset_release
  ON eval_runs (dataset_id, release, started_at DESC);

-- 3. The result: which assertion failed, and did it move ---------------
ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS assertion_results JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS cost_usd   NUMERIC(10, 6) NOT NULL DEFAULT 0;
ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS delta      TEXT NOT NULL DEFAULT 'unchanged';

COMMENT ON COLUMN eval_results.delta IS
  'Movement against this case''s result in the previous run of the same dataset: '
  'fixed | regressed | unchanged. The FIRST run of a case is `unchanged` — there '
  'is nothing to compare against, and calling a new failure a regression would '
  'be a lie.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eval_results_delta_check') THEN
    ALTER TABLE eval_results ADD CONSTRAINT eval_results_delta_check
      CHECK (delta IN ('fixed', 'regressed', 'unchanged'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eval_results_assertions_check') THEN
    ALTER TABLE eval_results ADD CONSTRAINT eval_results_assertions_check
      CHECK (jsonb_typeof(assertion_results) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eval_results_latency_check') THEN
    ALTER TABLE eval_results ADD CONSTRAINT eval_results_latency_check
      CHECK (latency_ms IS NULL OR latency_ms >= 0);
  END IF;
END $$;

-- Per-case history — every verdict this case has ever produced, newest first.
-- A view rather than a table: the history IS the results, and a second copy
-- could disagree with them.
CREATE OR REPLACE VIEW dataset_item_history AS
SELECT
  res.dataset_item_id AS item_id,
  res.org_id,
  run.dataset_id,
  run.id                AS eval_run_id,
  run.release,
  run.commit_sha,
  res.passed,
  res.score,
  res.delta,
  run.started_at
FROM eval_results res
JOIN eval_runs    run ON run.id = res.eval_run_id AND run.org_id = res.org_id
WHERE res.dataset_item_id IS NOT NULL
ORDER BY run.started_at DESC;

COMMENT ON VIEW dataset_item_history IS
  'One row per (case, run). Drives the per-case release history strip in the UI.';
