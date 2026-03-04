-- ── pgvector: Enable vector similarity search ────────────────────
-- Requires pgvector extension (included in timescaledb-ha image)

CREATE EXTENSION IF NOT EXISTS vector;

-- ── HNSW index on node embeddings ────────────────────────────────
-- HNSW gives best query-time performance for approximate nearest neighbour.
-- m=16, ef_construction=64 is a good default for 1536-dim OpenAI embeddings.
CREATE INDEX IF NOT EXISTS causal_nodes_embedding_hnsw
  ON causal_nodes
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Helper function: find semantically similar nodes ─────────────
CREATE OR REPLACE FUNCTION find_similar_nodes(
  query_embedding  vector(1536),
  p_org_id         TEXT,
  p_layers         TEXT[]  DEFAULT NULL,
  p_top_k          INT     DEFAULT 10,
  p_threshold      FLOAT   DEFAULT 0.7,
  p_before_ts      TIMESTAMPTZ DEFAULT NULL,
  p_after_ts       TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id          TEXT,
  layer       TEXT,
  similarity  FLOAT,
  timestamp   TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    n.id,
    n.layer,
    1 - (n.embedding <=> query_embedding) AS similarity,
    n.timestamp
  FROM causal_nodes n
  WHERE n.org_id = p_org_id
    AND n.embedding IS NOT NULL
    AND (p_layers IS NULL OR n.layer = ANY(p_layers))
    AND (p_before_ts IS NULL OR n.timestamp < p_before_ts)
    AND (p_after_ts  IS NULL OR n.timestamp > p_after_ts)
    AND (1 - (n.embedding <=> query_embedding)) >= p_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT p_top_k;
$$;
