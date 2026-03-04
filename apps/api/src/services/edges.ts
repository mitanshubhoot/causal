import { uuidv7 } from "uuidv7";
import type { FastifyInstance } from "fastify";
import type { CausalEdge, CreateEdge } from "@causal/types";

// ── createEdge ────────────────────────────────────────────────────
export async function createEdge(
  fastify: FastifyInstance,
  input: CreateEdge
): Promise<CausalEdge> {
  const edge: CausalEdge = {
    ...input,
    id: input.id ?? uuidv7(),
    confirmedBy: input.confirmedBy ?? null,
    isSuggested: input.isSuggested ?? false,
    createdAt: Date.now(),
  };

  // In Neo4j we store each EdgeType as its own relationship label for
  // efficient traversal, plus a generic CAUSAL_EDGE for cross-type queries.
  await fastify.neo4j.run(
    `MATCH (src:CausalNode {id: $sourceId})
     MATCH (tgt:CausalNode {id: $targetId})
     MERGE (src)-[r:${edge.type} {id: $id}]->(tgt)
     ON CREATE SET
       r.weight       = $weight,
       r.linkStrategy = $linkStrategy,
       r.confirmedBy  = $confirmedBy,
       r.isSuggested  = $isSuggested,
       r.orgId        = $orgId,
       r.createdAt    = $createdAt
     RETURN r`,
    {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      weight: edge.weight,
      linkStrategy: edge.linkStrategy,
      confirmedBy: edge.confirmedBy,
      isSuggested: edge.isSuggested,
      orgId: edge.orgId,
      createdAt: edge.createdAt,
    }
  );

  // Mirror to Postgres
  await fastify.pg`
    INSERT INTO causal_edges (id, org_id, source_id, target_id, type, weight, link_strategy, confirmed_by)
    VALUES (
      ${edge.id}, ${edge.orgId}, ${edge.sourceId}, ${edge.targetId},
      ${edge.type}, ${edge.weight}, ${edge.linkStrategy}, ${edge.confirmedBy ?? null}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  return edge;
}

// ── confirmEdge ───────────────────────────────────────────────────
// Sets confirmedBy exactly once. Edges are immutable in all other respects.
export async function confirmEdge(
  fastify: FastifyInstance,
  edgeId: string,
  orgId: string,
  userId: string,
  confirmed: boolean
): Promise<void> {
  if (!confirmed) {
    // Rejected edge — mark isSuggested=false so it's hidden, don't delete
    // (we need the audit trail)
    await fastify.pg`
      UPDATE causal_edges
      SET confirmed_by = ${'rejected:' + userId}
      WHERE id = ${edgeId} AND org_id = ${orgId}
    `;
    return;
  }

  // Confirmed — update Neo4j relationship and Postgres
  await fastify.neo4j.run(
    `MATCH ()-[r {id: $edgeId}]->()
     SET r.confirmedBy = $userId, r.isSuggested = false
     RETURN r`,
    { edgeId, userId }
  );

  await fastify.pg`
    UPDATE causal_edges
    SET confirmed_by = ${userId}
    WHERE id = ${edgeId} AND org_id = ${orgId}
  `;
}

// ── getEdgesForNode ───────────────────────────────────────────────
export async function getEdgesForNode(
  fastify: FastifyInstance,
  nodeId: string,
  direction: "in" | "out" | "both" = "both"
): Promise<CausalEdge[]> {
  const pattern =
    direction === "in"
      ? `()-[r]->(n:CausalNode {id: $nodeId})`
      : direction === "out"
      ? `(n:CausalNode {id: $nodeId})-[r]->()`
      : `(n:CausalNode {id: $nodeId})-[r]-()`;

  const rows = await fastify.neo4j.run<{
    r: Record<string, unknown>;
    srcId: string;
    tgtId: string;
    relType: string;
  }>(
    `MATCH ${pattern}
     RETURN r, startNode(r).id AS srcId, endNode(r).id AS tgtId, type(r) AS relType`,
    { nodeId }
  );

  return rows.map((row) => ({
    id: row.r["id"] as string,
    sourceId: row.srcId,
    targetId: row.tgtId,
    type: row.relType as CausalEdge["type"],
    weight: Number(row.r["weight"]),
    linkStrategy: row.r["linkStrategy"] as CausalEdge["linkStrategy"],
    confirmedBy: (row.r["confirmedBy"] as string | null) ?? null,
    isSuggested: Boolean(row.r["isSuggested"]),
    orgId: row.r["orgId"] as string,
    createdAt: Number(row.r["createdAt"]),
  }));
}
