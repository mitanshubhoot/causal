import type { FastifyPluginAsync } from "fastify";
import { TraceRequestSchema, SearchRequestSchema } from "@causal/types";
import { assembleTraceGraph } from "../services/tracegraph.js";
import { embedText } from "../services/embeddings.js";
import { config } from "../config.js";

const tracePlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/v1/trace
   *
   * Assembles a TraceGraph starting from the given root node ID.
   * Walks the causal graph backwards using BFS up to `maxDepth` hops,
   * filtering edges below `minWeight`. Returns the full graph including
   * critical path, root cause rankings, and all contributing nodes.
   *
   * @body {TraceRequestSchema} rootNodeId, maxDepth?, minWeight?, includeContributed?
   * @returns {TraceGraph}
   */
  fastify.post("/", async (request, reply) => {
    const body = TraceRequestSchema.parse(request.body);
    const { orgId } = request.authUser;

    const traceGraph = await assembleTraceGraph(fastify, body.rootNodeId, orgId, {
      maxDepth: body.maxDepth,
      minWeight: body.minWeight,
      includeContributed: body.includeContributed,
    });

    return traceGraph;
  });

  /**
   * GET /api/v1/trace/:id
   *
   * Retrieves a previously assembled and cached TraceGraph by its ID.
   * Only returns graphs belonging to the authenticated org.
   *
   * @param id - TraceGraph UUID
   * @returns {TraceGraph} or 404 if not found
   */
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const rows = await fastify.pg`
      SELECT * FROM trace_graphs
      WHERE id = ${request.params.id} AND org_id = ${request.authUser.orgId}
    ` as Array<Record<string, unknown>>;

    if (!rows.length) return reply.notFound(`TraceGraph ${request.params.id} not found`);
    const row = rows[0]!;
    return {
      id: row["id"],
      orgId: row["org_id"],
      rootNodeId: row["root_node_id"],
      nodeIds: row["node_ids"],
      criticalPath: row["critical_path"],
      rootCauses: row["root_causes"],
      status: row["status"],
      createdAt: row["created_at"],
    };
  });

  /**
   * POST /api/v1/search
   *
   * Searches causal nodes using either vector similarity (when
   * ENABLE_VECTOR_EMBEDDINGS is set and OPENAI_API_KEY is present)
   * or falls back to Postgres full-text search via tsvector.
   */
  // POST /api/v1/search — semantic/full-text node search
  fastify.post("/search", async (request, reply) => {
    const body = SearchRequestSchema.parse(request.body);
    const orgId = request.authUser.orgId;

    if (config.ENABLE_VECTOR_EMBEDDINGS && config.OPENAI_API_KEY) {
      // Vector search via pgvector
      try {
        const embedding = await embedText(body.query);
        const rows = await fastify.pg`
          SELECT * FROM find_similar_nodes(
            ${JSON.stringify(embedding)}::vector,
            ${orgId},
            ${body.layers ?? null},
            ${body.topK},
            ${body.threshold}
          )
        ` as Array<{ id: string; layer: string; similarity: number; timestamp: Date }>;

        return { results: rows, mode: "vector" };
      } catch {
        // Fall through to text search
      }
    }

    // Full-text / trigram search fallback
    const layerFilter = body.layers?.length
      ? fastify.pg`AND layer = ANY(${body.layers})`
      : fastify.pg``;

    const rows = await fastify.pg`
      SELECT id, layer, payload_text, timestamp,
             similarity(payload_text, ${body.query}) AS score
      FROM causal_nodes
      WHERE org_id = ${orgId}
        AND payload_text % ${body.query}
        ${layerFilter}
      ORDER BY score DESC
      LIMIT ${body.topK}
    ` as Array<{ id: string; layer: string; payload_text: string; score: number }>;

    return {
      results: rows.map((r) => ({ ...r, similarity: r.score })),
      mode: "text",
    };
  });

  // POST /api/v1/counterfactual — highest-leverage intervention points
  fastify.post<{ Params: { id: string } }>("/counterfactual", async (request, reply) => {
    const { rootNodeId } = (request.body as { rootNodeId?: string }) ?? {};
    if (!rootNodeId) return reply.badRequest("rootNodeId required");

    const traceGraph = await assembleTraceGraph(fastify, rootNodeId, request.authUser.orgId);

    const interventions = traceGraph.rootCauses.map((rc) => ({
      nodeId: rc.nodeId,
      layer: rc.layer,
      interventionPoint: rc.counterfactual || "Improve spec clarity for this decision",
      probability: rc.probability,
      explanation: rc.explanation,
    }));

    return { interventions, traceGraphId: traceGraph.id };
  });
};

export default tracePlugin;
