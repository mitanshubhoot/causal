import type { FastifyInstance } from "fastify";
import { getTrace } from "./traces.js";

interface SpanView {
  id: string;
  status: string;
  git?: { file: string; line: number; commit: string } | null;
}
interface TraceView {
  traceId: string;
  service: string;
  status: string;
  spans: SpanView[];
  finding: { detector: string; title: string } | null;
}

/**
 * Phase 4 — the authoring→outcome link. Given a runtime trace, tie its failing
 * commit back to the six-layer causal nodes (REASONING/CODE/SPEC/INTENT) that
 * produced that code, if the SDK/MCP captured them. Bridges the new
 * observability data to the original causal graph.
 */
export async function getProvenance(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const trace = (await getTrace(fastify, orgId, traceId)) as unknown as TraceView | null;
  if (!trace) return null;

  const failing = trace.spans.find((s) => s.git) ?? trace.spans.find((s) => s.status === "error");
  const commit = failing?.git?.commit ?? null;

  let linkedNodes: Array<Record<string, unknown>> = [];
  if (commit) {
    const rows = (await fastify.pg`
      SELECT id, layer, kind, session_id, timestamp, LEFT(payload_text, 240) AS excerpt
      FROM causal_nodes
      WHERE org_id = ${orgId} AND payload_text ILIKE ${"%" + commit + "%"}
      ORDER BY timestamp ASC
      LIMIT 20
    `) as Array<Record<string, unknown>>;
    linkedNodes = rows.map((r) => ({
      id: r["id"],
      layer: r["layer"],
      kind: r["kind"],
      sessionId: r["session_id"],
      timestamp: r["timestamp"],
      excerpt: r["excerpt"],
    }));
  }

  return {
    traceId: trace.traceId,
    // the observability half we captured directly
    execution: { traceId: trace.traceId, service: trace.service, status: trace.status },
    incident: trace.finding ? { detector: trace.finding.detector, title: trace.finding.title } : null,
    code: commit && failing?.git ? { commit, file: failing.git.file, line: failing.git.line } : null,
    // the authoring half — six-layer causal nodes that reference this commit
    linkedNodes,
    linked: linkedNodes.length > 0,
  };
}
