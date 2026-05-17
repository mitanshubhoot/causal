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

-- find_similar_nodes function defined in 002_functions.sql (more complete version).
