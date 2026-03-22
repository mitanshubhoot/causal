/**
 * TraceGraph Assembly
 *
 * Given a root INCIDENT node, performs Neo4j ancestor traversal,
 * finds the critical (highest-weight) causal path, and calls the
 * RCA Python service for LLM-generated explanations.
 */

import { uuidv7 } from "uuidv7";
import type { FastifyInstance } from "fastify";
import type { CausalNode, CausalEdge, TraceGraph, RootCause } from "@causal/types";
import { config } from "../config.js";
import { detectCascade, type CascadeAnalysis } from "./cascade-detector.js";

export async function assembleTraceGraph(
  fastify: FastifyInstance,
  rootNodeId: string,
  orgId: string,
  options: {
    maxDepth?: number;
    minWeight?: number;
    includeContributed?: boolean;
  } = {}
): Promise<TraceGraph> {
  let { maxDepth = 6, minWeight = 0.3 } = options;
  const traceId = uuidv7();

  // Clamp minWeight to valid range [0.1, 0.99] to prevent degenerate graphs
  if (minWeight < 0.1 || minWeight > 0.99) {
    fastify.log.warn(
      { minWeight, clamped: Math.max(0.1, Math.min(0.99, minWeight)) },
      "minWeight out of range [0.1, 0.99], clamping"
    );
    minWeight = Math.max(0.1, Math.min(0.99, minWeight));
  }

  // ── 1. Fetch all ancestors from Neo4j ────────────────────────────
  const { nodes, edges } = await fetchAncestorGraph(
    fastify,
    rootNodeId,
    orgId,
    maxDepth,
    minWeight
  );

  // ── 2. Compute critical path (highest cumulative weight chain) ───
  const criticalPath = computeCriticalPath(rootNodeId, nodes, edges);

  // ── 2.5. Cascade analysis — find multi-layer failure chains ──────
  const cascadeAnalysis = detectCascade(rootNodeId, nodes, edges);

  // ── 3. Identify root cause candidates (end of critical path) ─────
  const rootCauseCandidates = identifyRootCauseCandidates(
    rootNodeId,
    nodes,
    edges,
    criticalPath
  );

  // ── 4. Call RCA service for LLM explanations ─────────────────────
  let rootCauses: RootCause[] = rootCauseCandidates.map((c) => ({
    nodeId: c.nodeId,
    layer: c.layer,
    probability: c.probability,
    explanation: "",
    counterfactual: "",
    evidenceEdgeIds: c.evidenceEdgeIds,
  }));

  try {
    rootCauses = await callRcaService(fastify, {
      traceId,
      rootNodeId,
      nodes,
      edges,
      candidates: rootCauseCandidates,
    });
  } catch (err) {
    fastify.log.warn({ err }, "RCA service unavailable — returning candidates without explanations");
  }

  const traceGraph: TraceGraph = {
    id: traceId,
    rootNodeId,
    nodes,
    edges,
    rootCauses,
    criticalPath,
    status: "complete",
    confidence: rootCauses[0]?.probability,
    createdAt: Date.now(),
    completedAt: Date.now(),
  };

  // Attach cascade analysis as extended metadata
  const traceGraphWithCascade = {
    ...traceGraph,
    cascadeAnalysis: cascadeAnalysis.isCascading ? cascadeAnalysis : undefined,
  };

  // ── 5. Persist to Postgres ────────────────────────────────────────
  await fastify.pg`
    INSERT INTO trace_graphs (id, org_id, root_node_id, node_ids, critical_path, root_causes, status, created_at, completed_at)
    VALUES (
      ${traceId},
      ${orgId},
      ${rootNodeId},
      ${nodes.map((n) => n.id)},
      ${criticalPath},
      ${JSON.stringify(rootCauses)},
      'complete',
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  return traceGraphWithCascade as TraceGraph & { cascadeAnalysis?: CascadeAnalysis };
}

// ── Neo4j ancestor traversal ──────────────────────────────────────
async function fetchAncestorGraph(
  fastify: FastifyInstance,
  rootNodeId: string,
  orgId: string,
  maxDepth: number,
  minWeight: number
): Promise<{ nodes: CausalNode[]; edges: CausalEdge[] }> {
  // Traverse all relationship types in reverse (ancestors of the incident)
  const rows = await fastify.neo4j.run<{
    ancestor: Record<string, unknown>;
    rel: Record<string, unknown>;
    relType: string;
    srcId: string;
    depth: number;
  }>(
    `MATCH (root:CausalNode {id: $rootNodeId, orgId: $orgId})
     CALL apoc.path.spanningTree(root, {
       relationshipFilter: '<SPECIFIED_BY,<REASONED_FROM,<PRODUCED,<DEPLOYED_AS,<CAUSED,<CONTRIBUTED_TO',
       minLevel: 0,
       maxLevel: ${maxDepth},
       labelFilter: 'CausalNode'
     })
     YIELD path
     WITH last(nodes(path)) AS ancestor,
          last(relationships(path)) AS rel,
          length(path) AS depth
     WHERE rel IS NOT NULL AND rel.weight >= ${minWeight}
     RETURN ancestor, rel, type(rel) AS relType,
            startNode(rel).id AS srcId, depth
     ORDER BY depth ASC`,
    { rootNodeId, orgId }
  );

  const nodeMap = new Map<string, CausalNode>();
  const edgeMap = new Map<string, CausalEdge>();

  // Always include root node
  const rootRows = await fastify.neo4j.run<{ n: Record<string, unknown> }>(
    `MATCH (n:CausalNode {id: $id}) RETURN n`,
    { id: rootNodeId }
  );
  if (rootRows[0]) nodeMap.set(rootNodeId, neo4jToNode(rootRows[0].n));

  for (const row of rows) {
    const node = neo4jToNode(row.ancestor);
    nodeMap.set(node.id, node);

    const rel = row.rel;
    const edgeId = rel["id"] as string;
    if (edgeId && !edgeMap.has(edgeId)) {
      edgeMap.set(edgeId, {
        id: edgeId,
        sourceId: row.srcId,
        targetId: node.id === row.srcId ? rootNodeId : node.id,
        type: row.relType as CausalEdge["type"],
        weight: Number(rel["weight"]),
        linkStrategy: rel["linkStrategy"] as CausalEdge["linkStrategy"],
        confirmedBy: (rel["confirmedBy"] as string | null) ?? null,
        isSuggested: Boolean(rel["isSuggested"]),
        orgId: rel["orgId"] as string,
        createdAt: Number(rel["createdAt"]),
      });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };
}

// ── Critical path computation ─────────────────────────────────────
// Finds the path with highest cumulative weight from root to deepest ancestor.
function computeCriticalPath(
  rootNodeId: string,
  nodes: CausalNode[],
  edges: CausalEdge[]
): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Build adjacency (reversed — from target back to sources)
  const incoming = new Map<string, CausalEdge[]>();
  for (const edge of edges) {
    if (!incoming.has(edge.targetId)) incoming.set(edge.targetId, []);
    incoming.get(edge.targetId)!.push(edge);
  }

  // Dijkstra-style traversal finding highest-weight path
  function bestPath(nodeId: string, visited = new Set<string>()): { path: string[]; weight: number } {
    if (visited.has(nodeId)) return { path: [], weight: 0 };
    visited.add(nodeId);

    const incomingEdges = incoming.get(nodeId) ?? [];
    if (!incomingEdges.length) return { path: [nodeId], weight: 1 };

    let best = { path: [nodeId], weight: 0 };
    for (const edge of incomingEdges) {
      const upstream = bestPath(edge.sourceId, new Set(visited));
      const totalWeight = edge.weight * (upstream.weight || 1);
      if (totalWeight > best.weight) {
        best = { path: [...upstream.path, nodeId], weight: totalWeight };
      }
    }
    return best;
  }

  return bestPath(rootNodeId).path;
}

// ── Root cause candidates ─────────────────────────────────────────
function identifyRootCauseCandidates(
  rootNodeId: string,
  nodes: CausalNode[],
  edges: CausalEdge[],
  criticalPath: string[]
): Array<{ nodeId: string; layer: string; probability: number; evidenceEdgeIds: string[] }> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Root cause = REASONING or SPEC nodes at the top of the critical path
  const candidates: Array<{ nodeId: string; layer: string; probability: number; evidenceEdgeIds: string[] }> = [];

  for (const nodeId of criticalPath) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.layer === "REASONING" || node.layer === "SPEC" || node.layer === "INTENT") {
      // Compute probability as product of edge weights along path to this node
      const evidenceEdges = edges.filter(
        (e) => criticalPath.includes(e.sourceId) && criticalPath.includes(e.targetId)
      );

      const probability = evidenceEdges.reduce((acc, e) => acc * e.weight, 1);

      candidates.push({
        nodeId,
        layer: node.layer,
        probability: Math.min(0.99, probability),
        evidenceEdgeIds: evidenceEdges.map((e) => e.id),
      });
    }
  }

  // If no REASONING/SPEC in critical path, use CODE node as best available
  if (!candidates.length) {
    const codeNode = nodes.find((n) => n.layer === "CODE" && criticalPath.includes(n.id));
    if (codeNode) {
      candidates.push({
        nodeId: codeNode.id,
        layer: codeNode.layer,
        probability: 0.7,
        evidenceEdgeIds: [],
      });
    }
  }

  return candidates.sort((a, b) => b.probability - a.probability);
}

// ── Call Python RCA service ───────────────────────────────────────
async function callRcaService(
  fastify: FastifyInstance,
  payload: {
    traceId: string;
    rootNodeId: string;
    nodes: CausalNode[];
    edges: CausalEdge[];
    candidates: Array<{ nodeId: string; layer: string; probability: number; evidenceEdgeIds: string[] }>;
  }
): Promise<RootCause[]> {
  const response = await fetch(`${config.RCA_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`RCA service responded ${response.status}: ${await response.text()}`);
  }

  const result = await response.json() as { rootCauses: RootCause[] };
  return result.rootCauses;
}

// ── Neo4j record → CausalNode ─────────────────────────────────────
function neo4jToNode(props: Record<string, unknown>): CausalNode {
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
    repoId: (props["repoId"] as string) ?? "",
  };
}
