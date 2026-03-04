import type { FastifyPluginAsync } from "fastify";
import { CreateEdgeSchema, ConfirmEdgeSchema } from "@causal/types";
import { createEdge, confirmEdge } from "../services/edges.js";

const edgesPlugin: FastifyPluginAsync = async (fastify) => {
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
