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

  // ── 0. Check for pre-computed trace graph (demo mode) ────────────
  try {
    const cachedRows = await fastify.pg`
      SELECT * FROM trace_graphs
      WHERE root_node_id = ${rootNodeId} AND org_id = ${orgId} AND status = 'complete'
      ORDER BY created_at DESC LIMIT 1
    ` as Array<Record<string, unknown>>;

    if (cachedRows.length) {
      const cached = cachedRows[0]!;
      const cachedRootCauses = (typeof cached["root_causes"] === "string"
        ? JSON.parse(cached["root_causes"] as string)
        : cached["root_causes"]) as RootCause[];

      // Reconstruct nodes from Neo4j or Postgres
      const nodeIds = cached["node_ids"] as string[];
      let nodes: CausalNode[] = [];
      let edges: CausalEdge[] = [];

      try {
        const result = await fetchAncestorGraph(fastify, rootNodeId, orgId, maxDepth, minWeight);
        nodes = result.nodes;
        edges = result.edges;
        // If APOC returned fewer nodes than expected (e.g. APOC not installed),
        // fall through to Postgres to fill in the missing ones
        if (nodes.length < nodeIds.length) {
          throw new Error("Incomplete APOC result — falling back to Postgres");
        }
      } catch {
        // Fetch ALL nodes from Postgres by their IDs
        nodes = [];
        edges = [];
        for (const nid of nodeIds) {
          const nRows = await fastify.pg`
            SELECT id, layer, kind, timestamp, agent_id, model_version, session_id, payload_text
            FROM causal_nodes WHERE id = ${nid}
          ` as Array<Record<string, unknown>>;
          if (nRows[0]) {
            const r = nRows[0];
            nodes.push({
              id: r["id"] as string, layer: r["layer"] as CausalNode["layer"],
              kind: r["kind"] as string, timestamp: new Date(r["timestamp"] as string).getTime(),
              agentId: r["agent_id"] as string | null, modelVersion: r["model_version"] as string | null,
              sessionId: r["session_id"] as string | null, contextSnapId: null,
              payload: {}, embedding: null, orgId, repoId: "",
            });
          }
        }
        const eRows = await fastify.pg`
          SELECT * FROM causal_edges WHERE org_id = ${orgId}
            AND source_id = ANY(${nodeIds}) AND target_id = ANY(${nodeIds})
        ` as Array<Record<string, unknown>>;
        edges = eRows.map(r => ({
          id: r["id"] as string, sourceId: r["source_id"] as string,
          targetId: r["target_id"] as string, type: r["type"] as CausalEdge["type"],
          weight: Number(r["weight"]), linkStrategy: r["link_strategy"] as CausalEdge["linkStrategy"],
          confirmedBy: null, isSuggested: false, orgId, createdAt: Date.now(),
        }));
      }

      // Enrich ALL nodes with structured payload from Neo4j (simple MATCH, no APOC needed)
      for (const n of nodes) {
        if (!n.payload || Object.keys(n.payload).length === 0) {
          try {
            const neoRows = await fastify.neo4j.run<{ n: Record<string, unknown> }>(
              `MATCH (n:CausalNode {id: $id}) RETURN n`, { id: n.id }
            );
            if (neoRows[0]) {
              // Neo4j driver returns Node objects — unwrap .properties if needed
              const rawNode = neoRows[0].n;
              const props: Record<string, unknown> = (rawNode as { properties?: Record<string, unknown> }).properties ?? rawNode;
              try { n.payload = JSON.parse((props["payloadJson"] as string) ?? "{}"); } catch { /* */ }
              // Also fill in any missing fields from Neo4j
              if (!n.kind && props["kind"]) n.kind = props["kind"] as string;
              if (!n.agentId && props["agentId"]) n.agentId = props["agentId"] as string | null;
              if (!n.modelVersion && props["modelVersion"]) n.modelVersion = props["modelVersion"] as string | null;
              if (!n.sessionId && props["sessionId"]) n.sessionId = props["sessionId"] as string | null;
            }
          } catch { /* Neo4j down — leave empty payload */ }
        }
      }

      if (cachedRootCauses.length > 0 && nodes.length > 0) {
        return {
          id: cached["id"] as string, rootNodeId, nodes, edges,
          rootCauses: cachedRootCauses,
          criticalPath: (cached["critical_path"] as string[]) ?? [],
          status: "complete", confidence: cachedRootCauses[0]?.probability,
          createdAt: new Date(cached["created_at"] as string).getTime(),
          completedAt: Date.now(),
        };
      }
    }
  } catch (err) {
    fastify.log.debug({ err }, "No cached trace graph found — assembling fresh");
  }

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
      ${nodes.map((n) => n.id).filter((id): id is string => id != null)},
      ${criticalPath.filter((id): id is string => id != null)},
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
function neo4jToNode(rawProps: Record<string, unknown>): CausalNode {
  // Neo4j driver Node objects have a .properties wrapper
  const props: Record<string, unknown> = (rawProps as { properties?: Record<string, unknown> }).properties ?? rawProps;
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
