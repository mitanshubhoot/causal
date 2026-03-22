import type { FastifyPluginAsync } from "fastify";
import { CreateEdgeSchema, ConfirmEdgeSchema } from "@causal/types";
import { createEdge, confirmEdge } from "../services/edges.js";
import { z } from "zod";

const edgesPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/edges?nodeId=<id> — list edges for a node (as source or target)
  fastify.get<{ Querystring: { nodeId: string } }>("/", async (request, reply) => {
    const { nodeId } = z.object({ nodeId: z.string().uuid() }).parse(request.query);
    const { orgId } = request.authUser;

    const rows = await fastify.pg`
      SELECT * FROM causal_edges
      WHERE org_id = ${orgId}
        AND (source_id = ${nodeId} OR target_id = ${nodeId})
      ORDER BY created_at DESC
      LIMIT 100
    ` as Array<Record<string, unknown>>;

    const edges = rows.map((r) => ({
      id: r["id"],
      sourceId: r["source_id"],
      targetId: r["target_id"],
      type: r["type"],
      weight: r["weight"],
      linkStrategy: r["link_strategy"],
      confirmedBy: r["confirmed_by"],
      isSuggested: r["is_suggested"],
      orgId: r["org_id"],
      createdAt: Number(r["created_at"]),
    }));

    return { edges, count: edges.length };
  });

  // POST /api/v1/edges — create a causal edge
  fastify.post("/", async (request, reply) => {
    const body = CreateEdgeSchema.parse(request.body);
    const edge = await createEdge(fastify, {
      ...body,
      orgId: request.authUser.orgId,
    });
    return reply.code(201).send(edge);
  });

  // POST /api/v1/edges/:id/confirm — human confirms or rejects an auto-generated edge
  fastify.post<{ Params: { id: string } }>("/:id/confirm", async (request, reply) => {
    const body = ConfirmEdgeSchema.parse(request.body);
    await confirmEdge(
      fastify,
      request.params.id,
      request.authUser.orgId,
      body.userId,
      body.confirmed
    );
    return { ok: true };
  });
};

export default edgesPlugin;
