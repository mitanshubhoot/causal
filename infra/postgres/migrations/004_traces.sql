-- ── Causal v2: observability trace store ─────────────────────────────
-- Real trace ingest for the AI-agent observability product. A trace is one
-- agent run; spans are its LLM/tool/http/db steps. Detector findings attach to
-- a trace. Postgres-first (no ClickHouse required at this scale); partition /
-- move to a columnar store later if volume demands.

CREATE TABLE IF NOT EXISTS traces (
  id           TEXT PRIMARY KEY,              -- trace id (client-supplied)
  org_id       TEXT NOT NULL,
  service      TEXT NOT NULL,
  environment  TEXT NOT NULL DEFAULT 'production',
  root_name    TEXT,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error')),
  model        TEXT,
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  cost         NUMERIC(12, 6) NOT NULL DEFAULT 0,
  span_count   INTEGER NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traces_org_started ON traces (org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS spans (
  trace_id     TEXT NOT NULL REFERENCES traces (id) ON DELETE CASCADE,
  id           TEXT NOT NULL,                 -- span id, unique within a trace
  org_id       TEXT NOT NULL,
  parent_id    TEXT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'function'
                 CHECK (kind IN ('agent', 'llm', 'tool', 'http', 'db', 'function')),
  start_ms     INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error')),
  attributes   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{label,value}]
  io           JSONB,                                -- {input,output}
  git          JSONB,                                -- {file,line,commit}
  error        TEXT,
  PRIMARY KEY (trace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_org ON spans (org_id);

CREATE TABLE IF NOT EXISTS trace_findings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trace_id          TEXT NOT NULL REFERENCES traces (id) ON DELETE CASCADE,
  org_id            TEXT NOT NULL,
  detector          TEXT NOT NULL
                      CHECK (detector IN ('hallucination', 'tool_failure', 'intent_drift', 'safety')),
  title             TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
  confidence        NUMERIC(4, 3) NOT NULL DEFAULT 0,
  summary           TEXT,
  triggered_span_id TEXT,
  judge_model       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_findings_org_created ON trace_findings (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_trace ON trace_findings (trace_id);
