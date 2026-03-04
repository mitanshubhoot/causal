import { uuidv7 } from "uuidv7";
import type { FastifyInstance } from "fastify";
import type { CausalNode, CreateNode } from "@causal/types";

// ── Neo4j Cypher helpers ─────────────────────────────────────────

function nodeToProps(node: CausalNode) {
  return {
    id: node.id,
    layer: node.layer,
    kind: node.kind,
    timestamp: node.timestamp,
    agentId: node.agentId,
    modelVersion: node.modelVersion,
    sessionId: node.sessionId,
    contextSnapId: node.contextSnapId,
    orgId: node.orgId,
    repoId: node.repoId,
    payloadJson: JSON.stringify(node.payload),
    payloadText: flattenPayload(node.payload),
    commitHash: (node.payload as Record<string, unknown>)["commitHash"] as string | undefined ?? null,
  };
}

function flattenPayload(payload: Record<string, unknown>): string {
  const strings: string[] = [];
  function walk(obj: unknown) {
    if (typeof obj === "string") strings.push(obj);
    else if (Array.isArray(obj)) obj.forEach(walk);
    else if (obj && typeof obj === "object") Object.values(obj).forEach(walk);
  }
  walk(payload);
  return strings.join(" ").slice(0, 5000);
}

// ── createNode ────────────────────────────────────────────────────
export async function createNode(
  fastify: FastifyInstance,
  input: CreateNode
): Promise<CausalNode> {
  const node: CausalNode = {
    ...input,
    id: input.id ?? uuidv7(),
    embedding: null,
  };

  const props = nodeToProps(node);

  await fastify.neo4j.run(
    `MERGE (n:CausalNode {id: $id})
     ON CREATE SET
       n.layer        = $layer,
       n.kind         = $kind,
       n.timestamp    = $timestamp,
       n.agentId      = $agentId,
       n.modelVersion = $modelVersion,
       n.sessionId    = $sessionId,
       n.contextSnapId = $contextSnapId,
       n.orgId        = $orgId,
       n.repoId       = $repoId,
       n.payloadJson  = $payloadJson,
       n.payloadText  = $payloadText,
       n.commitHash   = $commitHash
     RETURN n`,
    props
  );

  // Mirror to Postgres for time-window queries and embeddings
  await fastify.pg`
    INSERT INTO causal_nodes (
      id, org_id, repo_id, layer, kind, timestamp,
      agent_id, model_version, session_id, context_snap_id, payload_text
    ) VALUES (
      ${node.id}, ${node.orgId}, ${node.repoId ?? null},
      ${node.layer}, ${node.kind},
      to_timestamp(${node.timestamp / 1000}),
      ${node.agentId ?? null}, ${node.modelVersion ?? null},
      ${node.sessionId ?? null}, ${node.contextSnapId ?? null},
      ${props.payloadText}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  return node;
}

// ── createNodes (batch) ───────────────────────────────────────────
export async function createNodes(
  fastify: FastifyInstance,
  inputs: CreateNode[]
): Promise<CausalNode[]> {
  const nodes = inputs.map((input) => ({
    ...input,
    id: input.id ?? uuidv7(),
    embedding: null,
  })) as CausalNode[];

  // Neo4j batch UNWIND
  await fastify.neo4j.run(
    `UNWIND $nodes AS n
     MERGE (node:CausalNode {id: n.id})
     ON CREATE SET
       node.layer        = n.layer,
       node.kind         = n.kind,
       node.timestamp    = n.timestamp,
       node.agentId      = n.agentId,
       node.modelVersion = n.modelVersion,
       node.sessionId    = n.sessionId,
       node.contextSnapId = n.contextSnapId,
       node.orgId        = n.orgId,
       node.repoId       = n.repoId,
       node.payloadJson  = n.payloadJson,
       node.payloadText  = n.payloadText,
       node.commitHash   = n.commitHash`,
    { nodes: nodes.map(nodeToProps) }
  );

  // Postgres batch insert
  if (nodes.length > 0) {
    const values = nodes.map((n) => ({
      id: n.id,
      org_id: n.orgId,
      repo_id: n.repoId ?? null,
      layer: n.layer,
      kind: n.kind,
      timestamp: new Date(n.timestamp),
      agent_id: n.agentId ?? null,
      model_version: n.modelVersion ?? null,
      session_id: n.sessionId ?? null,
      context_snap_id: n.contextSnapId ?? null,
      payload_text: flattenPayload(n.payload),
    }));

    await fastify.pg`
      INSERT INTO causal_nodes ${fastify.pg(values)}
      ON CONFLICT (id) DO NOTHING
    `;
  }

  return nodes;
}

// ── getNode ───────────────────────────────────────────────────────
export async function getNode(
  fastify: FastifyInstance,
  id: string,
  orgId: string
): Promise<CausalNode | null> {
  const rows = await fastify.neo4j.run<{ n: Record<string, unknown> }>(
    `MATCH (n:CausalNode {id: $id, orgId: $orgId}) RETURN n`,
    { id, orgId }
  );

  if (!rows.length) return null;
  return neo4jNodeToCausalNode(rows[0]!.n);
}

// ── getAncestors ──────────────────────────────────────────────────
export async function getAncestors(
  fastify: FastifyInstance,
  nodeId: string,
  orgId: string,
  maxDepth = 6
): Promise<{ nodes: CausalNode[]; edges: unknown[] }> {
  const rows = await fastify.neo4j.run<{
    path: unknown;
    nodes: Record<string, unknown>[];
    rels: Record<string, unknown>[];
  }>(
    `MATCH path = (ancestor:CausalNode {orgId: $orgId})-[rels*1..${maxDepth}]->(target:CausalNode {id: $nodeId, orgId: $orgId})
     WITH path, nodes(path) AS ns, relationships(path) AS rs
     RETURN ns AS nodes, rs AS rels
     ORDER BY size(rs) ASC
     LIMIT 200`,
    { nodeId, orgId }
  );

  const nodeMap = new Map<string, CausalNode>();
  const edges: unknown[] = [];

  for (const row of rows) {
    for (const n of row.nodes) {
      const node = neo4jNodeToCausalNode(n);
      nodeMap.set(node.id, node);
    }
    edges.push(...row.rels);
  }

  return { nodes: [...nodeMap.values()], edges };
}

function neo4jNodeToCausalNode(props: Record<string, unknown>): CausalNode {
  return {
    id: props["id"] as string,
    layer: props["layer"] as CausalNode["layer"],
    kind: props["kind"] as string,
    timestamp: Number(props["timestamp"]),
    agentId: (props["agentId"] as string | null) ?? null,
    modelVersion: (props["modelVersion"] as string | null) ?? null,
    sessionId: (props["sessionId"] as string | null) ?? null,
    contextSnapId: (props["contextSnapId"] as string | null) ?? null,
    payload: JSON.parse((props["payloadJson"] as string) ?? "{}"),
    embedding: null,
    orgId: props["orgId"] as string,
    repoId: props["repoId"] as string,
  };
}
