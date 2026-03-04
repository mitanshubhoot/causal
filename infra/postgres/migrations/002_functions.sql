-- ── Causal: Additional Functions and Indexes ─────────────────────
-- Run after 001_init.sql

-- Enable pgvector extension (required for embedding similarity search)
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── Vector similarity search function ──────────────────────────────
-- Used by Strategy 4 (vector auto-link) and POST /trace/search
CREATE OR REPLACE FUNCTION find_similar_nodes(
  query_embedding vector(1536),
  p_org_id TEXT,
  p_layers TEXT[] DEFAULT NULL,
  p_top_k INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.5,
  p_before_timestamp TIMESTAMPTZ DEFAULT NULL,
  p_after_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id TEXT,
  layer TEXT,
  kind TEXT,
  payload_text TEXT,
  timestamp TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cn.id,
    cn.layer,
    cn.kind,
    cn.payload_text,
    cn.timestamp,
    (1 - (cn.embedding <=> query_embedding))::FLOAT AS similarity
  FROM causal_nodes cn
  WHERE cn.org_id = p_org_id
    AND cn.embedding IS NOT NULL
    AND (p_layers IS NULL OR cn.layer = ANY(p_layers))
    AND (p_before_timestamp IS NULL OR cn.timestamp <= p_before_timestamp)
    AND (p_after_timestamp IS NULL OR cn.timestamp >= p_after_timestamp)
    AND (1 - (cn.embedding <=> query_embedding)) >= p_threshold
  ORDER BY cn.embedding <=> query_embedding ASC
  LIMIT p_top_k;
END;
$$;

-- ── HNSW index for fast vector search ──────────────────────────────
-- Only effective after embeddings are populated (ENABLE_VECTOR_EMBEDDINGS=true)
CREATE INDEX IF NOT EXISTS causal_nodes_embedding_hnsw
  ON causal_nodes
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Hypertable conversion for time-series queries ─────────────────
-- TimescaleDB hypertable enables efficient time-range scans
-- Note: This requires the timestamp column to be part of unique constraints
-- In our case, we use it for analytics, not as a primary lookup.
-- Uncomment if using TimescaleDB:
-- SELECT create_hypertable('causal_nodes', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);

-- ── Materialized view: Org-level metrics ──────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS org_node_metrics AS
SELECT
  org_id,
  layer,
  COUNT(*) AS node_count,
  MIN(timestamp) AS earliest,
  MAX(timestamp) AS latest,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_count
FROM causal_nodes
GROUP BY org_id, layer;

-- Refresh periodically via cron or application
CREATE UNIQUE INDEX IF NOT EXISTS org_node_metrics_unique
  ON org_node_metrics (org_id, layer);
