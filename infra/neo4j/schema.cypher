// ── Causal Neo4j Schema ──────────────────────────────────────────
// Applied on container init via docker-compose volume mount.
// All CausalNodes and edges are immutable after creation.

// ── Constraints ──────────────────────────────────────────────────
CREATE CONSTRAINT causal_node_id IF NOT EXISTS
FOR (n:CausalNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT causal_node_org_id IF NOT EXISTS
FOR (n:CausalNode) REQUIRE (n.id, n.orgId) IS UNIQUE;

// ── Indexes ──────────────────────────────────────────────────────

// Primary lookups
CREATE INDEX causal_node_layer IF NOT EXISTS
FOR (n:CausalNode) ON (n.layer);

CREATE INDEX causal_node_org IF NOT EXISTS
FOR (n:CausalNode) ON (n.orgId);

CREATE INDEX causal_node_org_layer IF NOT EXISTS
FOR (n:CausalNode) ON (n.orgId, n.layer);

// Session-based Auto-Link (Strategy 1 — confidence 0.97)
CREATE INDEX causal_node_session IF NOT EXISTS
FOR (n:CausalNode) ON (n.sessionId);

// Time-based queries
CREATE INDEX causal_node_timestamp IF NOT EXISTS
FOR (n:CausalNode) ON (n.timestamp);

CREATE INDEX causal_node_org_timestamp IF NOT EXISTS
FOR (n:CausalNode) ON (n.orgId, n.timestamp);

// Commit hash lookups (Strategy 3 — stack trace → git blame)
CREATE INDEX causal_node_commit IF NOT EXISTS
FOR (n:CausalNode) ON (n.commitHash);

// Repo-scoped queries
CREATE INDEX causal_node_repo IF NOT EXISTS
FOR (n:CausalNode) ON (n.repoId);

// Full-text search on payload (for Strategy 2 keyword matching)
CREATE FULLTEXT INDEX causal_node_payload_text IF NOT EXISTS
FOR (n:CausalNode) ON EACH [n.payloadText];

// ── Relationship property indexes ────────────────────────────────
// Neo4j 5+ supports relationship property indexes

CREATE INDEX causal_rel_id IF NOT EXISTS
FOR ()-[r:CAUSED]-() ON (r.id);

CREATE INDEX causal_rel_produced_id IF NOT EXISTS
FOR ()-[r:PRODUCED]-() ON (r.id);

CREATE INDEX causal_rel_reasoned_id IF NOT EXISTS
FOR ()-[r:REASONED_FROM]-() ON (r.id);

CREATE INDEX causal_rel_deployed_id IF NOT EXISTS
FOR ()-[r:DEPLOYED_AS]-() ON (r.id);

CREATE INDEX causal_rel_specified_id IF NOT EXISTS
FOR ()-[r:SPECIFIED_BY]-() ON (r.id);

CREATE INDEX causal_rel_contributed_id IF NOT EXISTS
FOR ()-[r:CONTRIBUTED_TO]-() ON (r.id);

CREATE INDEX causal_rel_contradicts_id IF NOT EXISTS
FOR ()-[r:CONTRADICTS]-() ON (r.id);

CREATE INDEX causal_rel_corrected_id IF NOT EXISTS
FOR ()-[r:CORRECTED_BY]-() ON (r.id);
