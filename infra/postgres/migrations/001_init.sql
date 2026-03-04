-- ── Causal: Core Postgres Schema ────────────────────────────────
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text similarity

-- ── Organizations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,              -- UUID v7
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Repositories ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repositories (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  full_name   TEXT NOT NULL,                -- e.g. "acme/backend"
  github_id   BIGINT,
  default_branch TEXT DEFAULT 'main',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, full_name)
);

-- ── API Keys ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,          -- SHA256 of the raw key
  name        TEXT NOT NULL,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

-- ── CausalNode mirror (for time-window queries + embeddings) ──────
-- The source of truth is Neo4j. This table enables:
--   1. TimescaleDB time-window range scans (much faster than Neo4j for this)
--   2. pgvector similarity search for embedding-based auto-linking
CREATE TABLE IF NOT EXISTS causal_nodes (
  id              TEXT PRIMARY KEY,          -- same UUID as Neo4j node
  org_id          TEXT NOT NULL,
  repo_id         TEXT,
  layer           TEXT NOT NULL CHECK (layer IN (
                    'INTENT','SPEC','REASONING','CODE','EXECUTION','INCIDENT'
                  )),
  kind            TEXT NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,      -- when artifact was created
  agent_id        TEXT,
  model_version   TEXT,
  session_id      TEXT,
  context_snap_id TEXT,
  payload_text    TEXT,                      -- flattened text for full-text search
  embedding       vector(1536),              -- OpenAI text-embedding-3-small
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS causal_nodes_org_layer     ON causal_nodes (org_id, layer);
CREATE INDEX IF NOT EXISTS causal_nodes_org_ts        ON causal_nodes (org_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS causal_nodes_session_id    ON causal_nodes (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS causal_nodes_layer_ts      ON causal_nodes (layer, timestamp DESC);
CREATE INDEX IF NOT EXISTS causal_nodes_payload_trgm  ON causal_nodes USING gin (payload_text gin_trgm_ops);

-- ── CausalEdge mirror (for analytics queries) ─────────────────────
CREATE TABLE IF NOT EXISTS causal_edges (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  type            TEXT NOT NULL,
  weight          FLOAT NOT NULL CHECK (weight >= 0 AND weight <= 1),
  link_strategy   TEXT NOT NULL CHECK (link_strategy IN (
                    'session_id','stack_trace','time_window','vector','manual'
                  )),
  confirmed_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS causal_edges_source   ON causal_edges (source_id);
CREATE INDEX IF NOT EXISTS causal_edges_target   ON causal_edges (target_id);
CREATE INDEX IF NOT EXISTS causal_edges_org_type ON causal_edges (org_id, type);

-- ── TraceGraphs (cached results) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS trace_graphs (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  root_node_id    TEXT NOT NULL,
  node_ids        TEXT[] NOT NULL,
  critical_path   TEXT[] NOT NULL,
  root_causes     JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'assembling'
                    CHECK (status IN ('assembling','complete','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS trace_graphs_org       ON trace_graphs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trace_graphs_root_node ON trace_graphs (root_node_id);

-- ── Replay runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replay_runs (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  snapshot_id       TEXT NOT NULL,
  trace_graph_id    TEXT,
  modification      JSONB NOT NULL,           -- the change applied
  fidelity_score    FLOAT,
  original_output   TEXT,
  modified_output   TEXT,
  output_diff       JSONB,
  model_used        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','complete','failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  error             TEXT
);

-- ── GitHub App installations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_installations (
  id              BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL UNIQUE,
  org_id          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Snapshot metadata ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshot_meta (
  snapshot_id     TEXT PRIMARY KEY,
  node_id         TEXT NOT NULL,
  org_id          TEXT NOT NULL,
  s3_key          TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  token_count     INT,
  decision_type   TEXT NOT NULL DEFAULT 'tool_call',
  timestamp       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS snapshot_meta_node_id ON snapshot_meta (node_id);
CREATE INDEX IF NOT EXISTS snapshot_meta_org     ON snapshot_meta (org_id, created_at DESC);

-- ── Post-mortems ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_mortems (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  trace_graph_id  TEXT NOT NULL,
  markdown        TEXT NOT NULL,
  linear_ticket   JSONB,
  claude_md_rule  TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
