/**
 * Cascading Failure Detector
 *
 * When an agentic system has multiple architectural layers (e.g., telephony → ASR →
 * LLM → tool_calling → scheduling → response), a single root cause can create a
 * chain of cascading failures across those layers.
 *
 * This module does 3 things:
 *   1. Detects cascade chains — walks backwards from INCIDENT to find the deepest
 *      common ancestor across all failure branches.
 *   2. Computes blast radius — for a given root cause, how many downstream nodes
 *      were affected.
 *   3. Identifies the ultimate failure point — even if cascading through 6 layers,
 *      find the ONE decision/event that started the cascade.
 *
 * Example: Healthcare Voice Chatbot
 *   INCIDENT: "Wrong appointment day"
 *     ← EXECUTION: "Scheduler booked Thursday" (CAUSED, 0.92)
 *       ← REASONING: "LLM received 'Thursday' from ASR" (PRODUCED, 0.97)
 *         ← EXECUTION: "ASR fallback to low-accuracy model" (DEPLOYED_AS, 0.8)
 *           ← CODE: "Removed ASR confirmation step" (PRODUCED, 0.95)
 *             ← SPEC: "Latency SLA requires < 500ms" (REASONED_FROM, 0.85)
 *
 *   Cascade detected: 5 layers deep
 *   Ultimate failure point: CODE node "Removed ASR confirmation step"
 *   Contributing factor: SPEC node "Latency SLA" pushed ASR to use faster/worse model
 *   Blast radius: 1 INCIDENT, 2 EXECUTION failures, 1 REASONING error
 */

import type { FastifyInstance } from "fastify";
import type { CausalNode, CausalEdge } from "@causal/types";
import { LAYER_ORDER } from "@causal/types";

// ── Types ────────────────────────────────────────────────────────

export interface CascadeChain {
    /** Ordered list of node IDs from deepest ancestor to incident */
    chain: string[];
    /** The deepest ancestor node — the "ultimate failure point" */
    ultimateFailureNodeId: string;
    /** Layer of the ultimate failure point */
    ultimateFailureLayer: string;
    /** Number of layers the cascade spans */
    depth: number;
    /** All layers involved in the cascade */
    layersInvolved: string[];
    /** Cumulative probability along the cascade path */
    cascadeProbability: number;
}

export interface BlastRadius {
    /** Total downstream nodes affected by this root cause */
    totalAffected: number;
    /** Breakdown by layer */
    byLayer: Record<string, number>;
    /** All INCIDENT nodes caused by this root cause */
    incidentNodeIds: string[];
    /** All EXECUTION nodes that failed */
    failedExecutionNodeIds: string[];
}

export interface CascadeAnalysis {
    /** Primary cascade chain (highest-weight path) */
    primaryCascade: CascadeChain;
    /** Secondary cascades (branching failure paths) */
    secondaryCascades: CascadeChain[];
    /** Blast radius of the ultimate failure point */
    blastRadius: BlastRadius;
    /** Whether this is a true cascading failure (spans 3+ layers) */
    isCascading: boolean;
    /** Contributing factors — nodes that amplified but didn't cause the failure */
    contributingFactors: Array<{
        nodeId: string;
        layer: string;
        contribution: string;
        weight: number;
    }>;
}

// ── Core Detection ───────────────────────────────────────────────

/**
 * Analyze an incident for cascading failures.
 * Walks the graph backwards from the incident node and:
 * 1. Finds the primary cascade chain (highest-probability path)
 * 2. Detects secondary cascades (parallel failure branches)
 * 3. Computes blast radius of the ultimate failure point
 */
export function detectCascade(
    rootNodeId: string,
    nodes: CausalNode[],
    edges: CausalEdge[]
): CascadeAnalysis {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Build reverse adjacency (target → sources) for backward traversal
    const incoming = new Map<string, Array<{ edge: CausalEdge; sourceId: string }>>();
    // Build forward adjacency (source → targets) for blast radius
    const outgoing = new Map<string, Array<{ edge: CausalEdge; targetId: string }>>();

    for (const edge of edges) {
        if (!incoming.has(edge.targetId)) incoming.set(edge.targetId, []);
        incoming.get(edge.targetId)!.push({ edge, sourceId: edge.sourceId });

        if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
        outgoing.get(edge.sourceId)!.push({ edge, targetId: edge.targetId });
    }

    // ── Step 1: Find all paths from incident backwards ──────────
    const allPaths = findAllCascadePaths(rootNodeId, incoming, nodeMap);

    if (allPaths.length === 0) {
        return {
            primaryCascade: {
                chain: [rootNodeId],
                ultimateFailureNodeId: rootNodeId,
                ultimateFailureLayer: nodeMap.get(rootNodeId)?.layer ?? "INCIDENT",
                depth: 1,
                layersInvolved: [nodeMap.get(rootNodeId)?.layer ?? "INCIDENT"],
                cascadeProbability: 1.0,
            },
            secondaryCascades: [],
            blastRadius: { totalAffected: 1, byLayer: { INCIDENT: 1 }, incidentNodeIds: [rootNodeId], failedExecutionNodeIds: [] },
            isCascading: false,
            contributingFactors: [],
        };
    }

    // Sort paths by cumulative weight (descending)
    allPaths.sort((a, b) => b.cumulativeWeight - a.cumulativeWeight);

    const primaryPath = allPaths[0]!;
    const primaryCascade = pathToCascadeChain(primaryPath, nodeMap);

    // Secondary cascades: paths that diverge from the primary
    const secondaryCascades = allPaths.slice(1, 4).map((p) => pathToCascadeChain(p, nodeMap));

    // ── Step 2: Blast radius from the ultimate failure point ────
    const blastRadius = computeBlastRadius(
        primaryCascade.ultimateFailureNodeId,
        outgoing,
        nodeMap
    );

    // ── Step 3: Find contributing factors ──────────────────────
    const contributingFactors = findContributingFactors(
        primaryPath.nodeIds,
        incoming,
        edges,
        nodeMap
    );

    // A cascade spans 3+ distinct layers AND has meaningful probability.
    // Previously only checked layer count, causing single-layer multi-hop
    // paths to be incorrectly flagged as cascading failures.
    const isCascading =
        primaryCascade.layersInvolved.length >= 3 &&
        primaryCascade.cascadeProbability >= 0.25;

    return {
        primaryCascade,
        secondaryCascades,
        blastRadius,
        isCascading,
        contributingFactors,
    };
}

// ── Path finding ─────────────────────────────────────────────────

interface CascadePath {
    nodeIds: string[];
    edgeIds: string[];
    cumulativeWeight: number;
}

/**
 * DFS backward from the root incident node to find all ancestor paths.
 * Stops when a node has no incoming edges (leaf ancestor) or depth limit hit.
 */
function findAllCascadePaths(
    startNodeId: string,
    incoming: Map<string, Array<{ edge: CausalEdge; sourceId: string }>>,
    nodeMap: Map<string, CausalNode>,
    maxDepth = 10
): CascadePath[] {
    const results: CascadePath[] = [];

    function dfs(
        current: string,
        path: string[],
        edgePath: string[],
        weight: number,
        depth: number,
        visited: Set<string>
    ) {
        if (depth > maxDepth) return;

        const sources = incoming.get(current) ?? [];

        // Filter to unvisited sources above minimum confidence threshold.
        // Previously used 0.1 which allowed near-zero-weight noise edges to
        // create spurious cascade paths. Raised to 0.25 to match the global
        // MIN_CONFIDENCE_THRESHOLD default and reduce false positives.
        const validSources = sources.filter(
            (s) => !visited.has(s.sourceId) && s.edge.weight >= 0.25
        );

        if (validSources.length === 0 && path.length > 1) {
            // Leaf ancestor — record this path (reversed to go ancestor → incident)
            results.push({
                nodeIds: [...path].reverse(),
                edgeIds: [...edgePath].reverse(),
                cumulativeWeight: weight,
            });
            return;
        }

        for (const { edge, sourceId } of validSources) {
            visited.add(sourceId);
            dfs(
                sourceId,
                [...path, sourceId],
                [...edgePath, edge.id],
                weight * edge.weight,
                depth + 1,
                visited
            );
            visited.delete(sourceId);
        }
    }

    dfs(startNodeId, [startNodeId], [], 1.0, 0, new Set([startNodeId]));
    return results;
}

function pathToCascadeChain(
    path: CascadePath,
    nodeMap: Map<string, CausalNode>
): CascadeChain {
    const layers = path.nodeIds
        .map((id) => nodeMap.get(id)?.layer ?? "UNKNOWN")
        .filter((l, i, arr) => arr.indexOf(l) === i); // unique, preserving order

    const ultimateNodeId = path.nodeIds[0]!;
    const ultimateNode = nodeMap.get(ultimateNodeId);

    return {
        chain: path.nodeIds,
        ultimateFailureNodeId: ultimateNodeId,
        ultimateFailureLayer: ultimateNode?.layer ?? "UNKNOWN",
        depth: path.nodeIds.length,
        layersInvolved: layers,
        cascadeProbability: path.cumulativeWeight,
    };
}

// ── Blast radius ─────────────────────────────────────────────────

function computeBlastRadius(
    rootCauseNodeId: string,
    outgoing: Map<string, Array<{ edge: CausalEdge; targetId: string }>>,
    nodeMap: Map<string, CausalNode>
): BlastRadius {
    const visited = new Set<string>();
    const byLayer: Record<string, number> = {};
    const incidentNodeIds: string[] = [];
    const failedExecutionNodeIds: string[] = [];

    function bfs(startId: string) {
        const queue = [startId];
        visited.add(startId);

        while (queue.length > 0) {
            const current = queue.shift()!;
            const node = nodeMap.get(current);

            if (node) {
                byLayer[node.layer] = (byLayer[node.layer] ?? 0) + 1;

                if (node.layer === "INCIDENT") incidentNodeIds.push(node.id);
                if (node.layer === "EXECUTION" && node.payload?.["error"]) {
                    failedExecutionNodeIds.push(node.id);
                }
            }

            const targets = outgoing.get(current) ?? [];
            for (const { targetId } of targets) {
                if (!visited.has(targetId)) {
                    visited.add(targetId);
                    queue.push(targetId);
                }
            }
        }
    }

    bfs(rootCauseNodeId);

    return {
        totalAffected: visited.size,
        byLayer,
        incidentNodeIds,
        failedExecutionNodeIds,
    };
}

// ── Contributing factors ─────────────────────────────────────────

function findContributingFactors(
    primaryPathNodeIds: string[],
    incoming: Map<string, Array<{ edge: CausalEdge; sourceId: string }>>,
    allEdges: CausalEdge[],
    nodeMap: Map<string, CausalNode>
): Array<{ nodeId: string; layer: string; contribution: string; weight: number }> {
    const primarySet = new Set(primaryPathNodeIds);
    const factors: Array<{ nodeId: string; layer: string; contribution: string; weight: number }> = [];

    // Find CONTRIBUTED_TO edges that point to nodes in the primary path
    // but whose source is NOT in the primary path
    for (const edge of allEdges) {
        if (
            edge.type === "CONTRIBUTED_TO" &&
            primarySet.has(edge.targetId) &&
            !primarySet.has(edge.sourceId)
        ) {
            const sourceNode = nodeMap.get(edge.sourceId);
            if (sourceNode) {
                const targetNode = nodeMap.get(edge.targetId);
                factors.push({
                    nodeId: sourceNode.id,
                    layer: sourceNode.layer,
                    contribution: `Contributed to ${targetNode?.layer ?? "unknown"} layer failure`,
                    weight: edge.weight,
                });
            }
        }
    }

    // Also find nodes that are adjacent to the primary path via any weak edge
    for (const nodeId of primaryPathNodeIds) {
        const sources = incoming.get(nodeId) ?? [];
        for (const { edge, sourceId } of sources) {
            if (
                !primarySet.has(sourceId) &&
                edge.weight >= 0.3 &&
                edge.weight < 0.7 &&
                !factors.some((f) => f.nodeId === sourceId)
            ) {
                const sourceNode = nodeMap.get(sourceId);
                if (sourceNode) {
                    factors.push({
                        nodeId: sourceNode.id,
                        layer: sourceNode.layer,
                        contribution: `Weak causal link to ${nodeMap.get(nodeId)?.layer ?? "unknown"} layer (weight: ${edge.weight.toFixed(2)})`,
                        weight: edge.weight,
                    });
                }
            }
        }
    }

    // Sort by weight descending
    factors.sort((a, b) => b.weight - a.weight);
    return factors.slice(0, 5); // Top 5 contributing factors
}

// ── Temporal Cascade Detection ───────────────────────────────────

/**
 * Detect temporally correlated failures:
 * Multiple EXECUTION nodes failing within a short time window
 * that share a common ancestor.
 */
export async function detectTemporalCascade(
    fastify: FastifyInstance,
    orgId: string,
    windowMs = 5 * 60 * 1000 // 5-minute window
): Promise<Array<{
    commonAncestorId: string;
    commonAncestorLayer: string;
    failedNodes: string[];
    timeSpanMs: number;
}>> {
    // Find clusters of EXECUTION/INCIDENT nodes that failed within the window
    const rows = await fastify.pg`
    SELECT id, layer, timestamp, payload_text
    FROM causal_nodes
    WHERE org_id = ${orgId}
      AND layer IN ('EXECUTION', 'INCIDENT')
      AND timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC
    LIMIT 100
  ` as Array<{ id: string; layer: string; timestamp: Date; payload_text: string }>;

    if (rows.length < 2) return [];

    // Group by time window
    const clusters: Array<{ nodes: typeof rows; startTime: Date; endTime: Date }> = [];
    let currentCluster: typeof rows = [rows[0]!];

    for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1]!;
        const curr = rows[i]!;
        const gap = Math.abs(prev.timestamp.getTime() - curr.timestamp.getTime());

        if (gap <= windowMs) {
            currentCluster.push(curr);
        } else {
            if (currentCluster.length >= 2) {
                clusters.push({
                    nodes: [...currentCluster],
                    startTime: currentCluster[currentCluster.length - 1]!.timestamp,
                    endTime: currentCluster[0]!.timestamp,
                });
            }
            currentCluster = [curr];
        }
    }

    if (currentCluster.length >= 2) {
        clusters.push({
            nodes: [...currentCluster],
            startTime: currentCluster[currentCluster.length - 1]!.timestamp,
            endTime: currentCluster[0]!.timestamp,
        });
    }

    // For each cluster, find common ancestors via Neo4j
    const results: Array<{
        commonAncestorId: string;
        commonAncestorLayer: string;
        failedNodes: string[];
        timeSpanMs: number;
    }> = [];

    for (const cluster of clusters) {
        const nodeIds = cluster.nodes.map((n) => n.id);

        // Find common ancestors of all nodes in the cluster
        const ancestorRows = await fastify.neo4j.run<{
            ancestorId: string;
            ancestorLayer: string;
            sharedCount: number;
        }>(
            `UNWIND $nodeIds AS nid
       MATCH (ancestor:CausalNode {orgId: $orgId})-[*1..6]->(target:CausalNode {id: nid, orgId: $orgId})
       WITH ancestor, count(DISTINCT nid) AS sharedCount
       WHERE sharedCount >= 2
       RETURN ancestor.id AS ancestorId, ancestor.layer AS ancestorLayer, sharedCount
       ORDER BY sharedCount DESC, ancestor.timestamp ASC
       LIMIT 5`,
            { nodeIds, orgId }
        );

        for (const row of ancestorRows) {
            results.push({
                commonAncestorId: row.ancestorId,
                commonAncestorLayer: row.ancestorLayer,
                failedNodes: nodeIds,
                timeSpanMs: cluster.endTime.getTime() - cluster.startTime.getTime(),
            });
        }
    }

    return results;
}
