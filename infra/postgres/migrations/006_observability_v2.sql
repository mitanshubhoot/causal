-- ── Causal v2.1: make the schema actually support the product ────────
-- Closes gaps found in the backend audit:
--   * spans carried no tokens/cost, so per-span economics were unbackable
--   * span kinds were 6, the product uses 10 (skill/workflow/search/shell)
--   * traces PK was `id` alone → cross-tenant trace-id collision
--   * detectors/runs had no entities, so the Detectors view was unbackable

-- 1. Per-span economics + source snippet ------------------------------
ALTER TABLE spans ADD COLUMN IF NOT EXISTS tokens_in  INTEGER;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS tokens_out INTEGER;
ALTER TABLE spans ADD COLUMN IF NOT EXISTS cost       NUMERIC(12, 6);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS code       JSONB;

-- 2. Widen span kinds to the ten the product emits --------------------
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_kind_check;
ALTER TABLE spans ADD CONSTRAINT spans_kind_check CHECK (
  kind IN ('agent','llm','tool','http','db','function','skill','workflow','search','shell')
);

-- 3. Tenancy: a trace id must only be unique WITHIN an org ------------
-- Re-keying traces to (org_id, id) means EVERY foreign key pointing at
-- traces(id) must be dropped first — Postgres refuses to drop a primary key
-- that other constraints depend on. Three tables reference it: spans (004),
-- trace_findings (004) and rca_runs (005). Missing any one of them aborts the
-- migration, which silently blocks 007 and 008 too.
ALTER TABLE spans          DROP CONSTRAINT IF EXISTS spans_trace_id_fkey;
ALTER TABLE trace_findings DROP CONSTRAINT IF EXISTS trace_findings_trace_id_fkey;
ALTER TABLE rca_runs       DROP CONSTRAINT IF EXISTS rca_runs_trace_id_fkey;

ALTER TABLE traces DROP CONSTRAINT IF EXISTS traces_pkey;
ALTER TABLE traces ADD  CONSTRAINT traces_pkey PRIMARY KEY (org_id, id);

ALTER TABLE spans  DROP CONSTRAINT IF EXISTS spans_pkey;
ALTER TABLE spans  ADD  CONSTRAINT spans_pkey PRIMARY KEY (org_id, trace_id, id);
ALTER TABLE spans  ADD  CONSTRAINT spans_trace_fkey
  FOREIGN KEY (org_id, trace_id) REFERENCES traces (org_id, id) ON DELETE CASCADE;

-- Re-point the dependants at the composite key so cascade delete still works
-- and a finding can never attach to another tenant's trace.
ALTER TABLE trace_findings ADD CONSTRAINT trace_findings_trace_fkey
  FOREIGN KEY (org_id, trace_id) REFERENCES traces (org_id, id) ON DELETE CASCADE;
ALTER TABLE rca_runs ADD CONSTRAINT rca_runs_trace_fkey
  FOREIGN KEY (org_id, trace_id) REFERENCES traces (org_id, id) ON DELETE CASCADE;

-- 4. Detector entities ------------------------------------------------
CREATE TABLE IF NOT EXISTS detectors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL,                 -- e.g. "tool-failure-v1"
  type        TEXT NOT NULL CHECK (type IN ('hallucination','tool_failure','intent_drift','safety')),
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- 5. Every evaluation is recorded, including the clean ones -----------
CREATE TABLE IF NOT EXISTS detector_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      TEXT NOT NULL,
  detector_id UUID REFERENCES detectors (id) ON DELETE CASCADE,
  trace_id    TEXT NOT NULL,
  identified  BOOLEAN NOT NULL DEFAULT false,
  finding_id  UUID REFERENCES trace_findings (id) ON DELETE SET NULL,
  judge_model TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_detector_runs_org ON detector_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detector_runs_detector ON detector_runs (detector_id, created_at DESC);

-- 6. Findings gain a lifecycle + a link to their detector --------------
ALTER TABLE trace_findings ADD COLUMN IF NOT EXISTS detector_id UUID REFERENCES detectors (id) ON DELETE SET NULL;
ALTER TABLE trace_findings ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 7. Copilot conversations --------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     TEXT NOT NULL,
  trace_id   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_copilot_trace ON copilot_messages (org_id, trace_id, created_at ASC);

-- 8. Seed the four default detectors for the demo org -----------------
INSERT INTO detectors (org_id, name, type, description) VALUES
  ('org_demo_causal_001','tool-failure-v1','tool_failure','Flags unhandled tool/function exceptions on the critical path.'),
  ('org_demo_causal_001','hallucination-v1','hallucination','Flags responses with fabricated facts or unsupported claims.'),
  ('org_demo_causal_001','intent-drift-v1','intent_drift','Flags outputs that diverge from the user''s original request.'),
  ('org_demo_causal_001','safety-v1','safety','Flags policy or safety violations in agent output.')
ON CONFLICT (org_id, name) DO NOTHING;
