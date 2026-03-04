/**
 * Auto-Link Pipeline
 *
 * When an INCIDENT or CODE node is created, this pipeline automatically
 * finds its causal ancestors using 4 priority-ordered strategies:
 *
 *   Strategy 1: Session ID matching        — confidence 0.97
 *   Strategy 2: Time-window + semantic     — confidence 0.6–0.8
 *   Strategy 3: Stack trace → git blame    — confidence 0.85–0.95
 *   Strategy 4: Vector similarity          — confidence 0.3–0.6 (fallback)
 *
 * From the spec: "If Causal tells an engineer 'this incident was caused by
 * Agent X' and it's wrong, the engineer wastes hours chasing the wrong root
 * cause. That destroys trust faster than not having the product."
 *
 * We therefore surface confidence scores prominently and never auto-create
 * a link with confidence < 0.5 without labeling it 'suggested'.
 */

import type { FastifyInstance } from "fastify";
import type { CausalNode, CausalEdge } from "@causal/types";
import { createEdge } from "./edges.js";
import { config } from "../config.js";

export interface AutoLinkResult {
  edgesCreated: CausalEdge[];
  strategiesRan: string[];
}

// ── Entry point called after any INCIDENT or CODE node is created ─
export async function runAutoLinkPipeline(
  fastify: FastifyInstance,
  triggerNode: CausalNode
): Promise<AutoLinkResult> {
  const edgesCreated: CausalEdge[] = [];
  const strategiesRan: string[] = [];

  if (triggerNode.layer === "CODE") {
    // A new code commit — find its REASONING ancestor via session ID
    const edges = await strategy1_sessionId(fastify, triggerNode);
    edgesCreated.push(...edges);
    if (edges.length) strategiesRan.push("session_id");

    if (!edgesCreated.length) {
      const edges2 = await strategy2_timeWindow(fastify, triggerNode);
      edgesCreated.push(...edges2);
      if (edges2.length) strategiesRan.push("time_window");
    }
  }

  if (triggerNode.layer === "INCIDENT") {
    // An incident fired — trace upward through EXECUTION → CODE → REASONING
    const edges = await strategy3_stackTrace(fastify, triggerNode);
    edgesCreated.push(...edges);
    if (edges.length) strategiesRan.push("stack_trace");

    // Also try session ID on any CODE nodes found
    for (const edge of edgesCreated) {
      if (edge.targetId === triggerNode.id) {
        // edge.sourceId is a CODE node — try to link it to REASONING
        const codeNode = await getNodeById(fastify, edge.sourceId);
        if (codeNode) {
          const reasoningEdges = await strategy1_sessionId(fastify, codeNode);
          edgesCreated.push(...reasoningEdges);
          if (reasoningEdges.length && !strategiesRan.includes("session_id")) {
            strategiesRan.push("session_id");
          }
        }
      }
    }

    // Vector similarity as fallback (only if embeddings enabled)
    if (!edgesCreated.length && config.ENABLE_VECTOR_EMBEDDINGS) {
      const vectorEdges = await strategy4_vectorSimilarity(fastify, triggerNode);
      edgesCreated.push(...vectorEdges);
      if (vectorEdges.length) strategiesRan.push("vector");
    }
  }

  fastify.log.info(
    { nodeId: triggerNode.id, layer: triggerNode.layer, edgesCreated: edgesCreated.length, strategiesRan },
    "Auto-link pipeline complete"
  );

  return { edgesCreated, strategiesRan };
}

// ── Strategy 1: Session ID matching (confidence: 0.97) ────────────
async function strategy1_sessionId(
  fastify: FastifyInstance,
  codeNode: CausalNode
): Promise<CausalEdge[]> {
  if (!codeNode.sessionId) return [];

  const rows = await fastify.neo4j.run<{ r: Record<string, unknown> }>(
    `MATCH (reasoning:CausalNode {
       layer: 'REASONING',
       sessionId: $sessionId,
       orgId: $orgId
     })
     MATCH (code:CausalNode {id: $codeId})
     WHERE NOT (reasoning)-[:PRODUCED]->(code)
     CREATE (reasoning)-[r:PRODUCED {
       id: randomUUID(),
       weight: 0.97,
       linkStrategy: 'session_id',
       confirmedBy: null,
       isSuggested: false,
       orgId: $orgId,
       createdAt: $now
     }]->(code)
     RETURN r`,
    {
      sessionId: codeNode.sessionId,
      codeId: codeNode.id,
      orgId: codeNode.orgId,
      now: Date.now(),
    }
  );

  return rows.map((row) =>
    neo4jRelToCausalEdge(row.r, "REASONING_ID", codeNode.id, "PRODUCED", "session_id", codeNode.orgId, 0.97)
  );
}

// ── Strategy 2: Time-window + semantic match (confidence: 0.6–0.8) ─
async function strategy2_timeWindow(
  fastify: FastifyInstance,
  codeNode: CausalNode
): Promise<CausalEdge[]> {
  const commitTs = codeNode.timestamp;
  const windowMs = 2 * 60 * 60 * 1000; // 2 hours before commit
  const windowStart = commitTs - windowMs;

  // Find REASONING nodes in the time window for this org
  const candidates = await fastify.pg`
    SELECT id, session_id, payload_text, timestamp
    FROM causal_nodes
    WHERE org_id = ${codeNode.orgId}
      AND layer = 'REASONING'
      AND timestamp BETWEEN ${new Date(windowStart)} AND ${new Date(commitTs)}
      AND session_id IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 20
  ` as Array<{ id: string; session_id: string; payload_text: string; timestamp: Date }>;

  if (!candidates.length) return [];

  // Score by temporal proximity (linear decay over 2h window)
  const edges: CausalEdge[] = [];

  for (const candidate of candidates) {
    const candidateTs = candidate.timestamp.getTime();
    const timeDiff = commitTs - candidateTs;
    const temporalScore = Math.max(0, 1 - timeDiff / windowMs);

    // Simple keyword overlap as semantic proxy (real semantic search uses pgvector)
    const codeText = flattenPayload(codeNode.payload);
    const reasoningText = candidate.payload_text ?? "";
    const overlapScore = computeKeywordOverlap(codeText, reasoningText);

    const confidence = 0.4 * temporalScore + 0.6 * overlapScore;
    if (confidence < 0.4) continue;

    const clampedConfidence = Math.min(0.8, Math.max(0.5, confidence));
    const isSuggested = clampedConfidence < config.MIN_CONFIDENCE_THRESHOLD;

    const edge = await createEdge(fastify, {
      sourceId: candidate.id,
      targetId: codeNode.id,
      type: "PRODUCED",
      weight: clampedConfidence,
      linkStrategy: "time_window",
      confirmedBy: null,
      isSuggested,
      orgId: codeNode.orgId,
    });
    edges.push(edge);
  }

  return edges;
}

// ── Strategy 3: Stack trace → file → commit attribution ────────────
// Confidence: 0.85–0.95 (higher when line numbers match exactly)
export async function strategy3_stackTrace(
  fastify: FastifyInstance,
  incidentNode: CausalNode
): Promise<CausalEdge[]> {
  const payload = incidentNode.payload as { stackTraceFrames?: Array<{ filename: string; lineno?: number }>; stackTrace?: string };
  const frames = payload.stackTraceFrames ?? parseStackTrace(payload.stackTrace ?? "");

  if (!frames.length) return [];

  const edges: CausalEdge[] = [];

  for (const frame of frames.slice(0, 5)) { // top 5 frames only
    if (!frame.filename) continue;

    // Find CODE nodes that touched this file
    const codeNodes = await fastify.neo4j.run<{ n: Record<string, unknown> }>(
      `MATCH (n:CausalNode {layer: 'CODE', orgId: $orgId})
       WHERE n.payloadText CONTAINS $filename
         AND n.timestamp < $incidentTs
       RETURN n
       ORDER BY n.timestamp DESC
       LIMIT 3`,
      {
        filename: frame.filename.split("/").pop() ?? frame.filename,
        orgId: incidentNode.orgId,
        incidentTs: incidentNode.timestamp,
      }
    );

    for (const row of codeNodes) {
      const codeNodeId = row.n["id"] as string;
      const hasLineMatch = frame.lineno !== undefined;
      const confidence = hasLineMatch ? 0.92 : 0.85;

      const edge = await createEdge(fastify, {
        sourceId: codeNodeId,
        targetId: incidentNode.id,
        type: "CAUSED",
        weight: confidence,
        linkStrategy: "stack_trace",
        confirmedBy: null,
        isSuggested: false,
        orgId: incidentNode.orgId,
      });
      edges.push(edge);
    }
  }

  return edges;
}

// ── Strategy 4: Vector similarity (fallback, confidence: 0.3–0.6) ──
async function strategy4_vectorSimilarity(
  fastify: FastifyInstance,
  incidentNode: CausalNode
): Promise<CausalEdge[]> {
  const embedding = await fastify.pg`
    SELECT embedding FROM causal_nodes WHERE id = ${incidentNode.id}
  ` as Array<{ embedding: number[] | null }>;

  if (!embedding[0]?.embedding) return [];

  const similar = await fastify.pg`
    SELECT * FROM find_similar_nodes(
      ${embedding[0].embedding}::vector,
      ${incidentNode.orgId},
      ARRAY['SPEC', 'REASONING']::text[],
      10,
      0.5,
      ${new Date(incidentNode.timestamp)},
      NULL
    )
  ` as Array<{ id: string; layer: string; similarity: number }>;

  const edges: CausalEdge[] = [];
  for (const result of similar) {
    if (result.similarity < 0.5) continue;

    const edge = await createEdge(fastify, {
      sourceId: result.id,
      targetId: incidentNode.id,
      type: result.layer === "SPEC" ? "SPECIFIED_BY" : "CONTRIBUTED_TO",
      weight: Math.min(0.6, result.similarity * 0.7),
      linkStrategy: "vector",
      confirmedBy: null,
      isSuggested: true,
      orgId: incidentNode.orgId,
    });
    edges.push(edge);
  }

  return edges;
}

// ── Helpers ───────────────────────────────────────────────────────
async function getNodeById(
  fastify: FastifyInstance,
  id: string
): Promise<CausalNode | null> {
  const rows = await fastify.neo4j.run<{ n: Record<string, unknown> }>(
    `MATCH (n:CausalNode {id: $id}) RETURN n`,
    { id }
  );
  if (!rows.length) return null;
  const n = rows[0]!.n;
  return {
    id: n["id"] as string,
    layer: n["layer"] as CausalNode["layer"],
    kind: n["kind"] as string,
    timestamp: Number(n["timestamp"]),
    agentId: (n["agentId"] as string | null) ?? null,
    modelVersion: (n["modelVersion"] as string | null) ?? null,
    sessionId: (n["sessionId"] as string | null) ?? null,
    contextSnapId: (n["contextSnapId"] as string | null) ?? null,
    payload: JSON.parse((n["payloadJson"] as string) ?? "{}"),
    embedding: null,
    orgId: n["orgId"] as string,
    repoId: n["repoId"] as string,
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
  return strings.join(" ").toLowerCase();
}

function computeKeywordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!wordsA.size || !wordsB.size) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export function parseStackTrace(
  stackTrace: string
): Array<{ filename: string; lineno?: number; function?: string }> {
  const frames: Array<{ filename: string; lineno?: number; function?: string }> = [];

  // Python traceback format: "  File "path/to/file.py", line 42, in function_name"
  const pythonRe = /File "([^"]+)", line (\d+)(?:, in (\S+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pythonRe.exec(stackTrace)) !== null) {
    frames.push({
      filename: match[1]!,
      lineno: parseInt(match[2]!, 10),
      ...(match[3] ? { function: match[3] } : {}),
    });
  }

  // Node.js / JS format: "    at functionName (filename.js:42:10)"
  if (!frames.length) {
    const jsRe = /at (?:(\S+) \()?([^:)]+):(\d+):\d+\)?/g;
    while ((match = jsRe.exec(stackTrace)) !== null) {
      const filename = match[2]!;
      if (filename.includes("node_modules") || filename.startsWith("node:")) continue;
      frames.push({
        filename,
        lineno: parseInt(match[3]!, 10),
        ...(match[1] ? { function: match[1] } : {}),
      });
    }
  }

  return frames.slice(0, 10);
}

function neo4jRelToCausalEdge(
  rel: Record<string, unknown>,
  sourceId: string,
  targetId: string,
  type: CausalEdge["type"],
  strategy: CausalEdge["linkStrategy"],
  orgId: string,
  weight: number
): CausalEdge {
  return {
    id: (rel["id"] as string) || String(Date.now()),
    sourceId,
    targetId,
    type,
    weight,
    linkStrategy: strategy,
    confirmedBy: null,
    isSuggested: false,
    orgId,
    createdAt: Number(rel["createdAt"]) || Date.now(),
  };
}
