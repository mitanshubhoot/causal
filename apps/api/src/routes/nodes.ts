import type { FastifyPluginAsync } from "fastify";
import { CreateNodeSchema } from "@causal/types";
import { createNode, createNodes, getNode, getAncestors } from "../services/nodes.js";
import { runAutoLinkPipeline } from "../services/autolink.js";
import { populateNodeEmbedding } from "../services/embeddings.js";
import { z } from "zod";

const nodesPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/nodes?layer=INCIDENT — list nodes by layer
  fastify.get<{ Querystring: { layer?: string } }>("/", async (request, reply) => {
    const { orgId } = request.authUser;
    const layer = (request.query as Record<string, string>).layer;

    if (layer) {
      const rows = await fastify.pg`
        SELECT id, layer, kind, timestamp, agent_id, model_version, session_id, payload_text
        FROM causal_nodes
        WHERE org_id = ${orgId} AND layer = ${layer}
        ORDER BY timestamp DESC
        LIMIT 50
      ` as Array<Record<string, unknown>>;
      return { nodes: rows, count: rows.length };
    }

    const rows = await fastify.pg`
      SELECT id, layer, kind, timestamp, agent_id, model_version, session_id, payload_text
      FROM causal_nodes
      WHERE org_id = ${orgId}
      ORDER BY timestamp DESC
      LIMIT 100
    ` as Array<Record<string, unknown>>;
    return { nodes: rows, count: rows.length };
  });

  // POST /api/v1/nodes — create a single node
  fastify.post("/", async (request, reply) => {
    const { authUser } = request;
    const body = CreateNodeSchema.parse(request.body);

    const node = await createNode(fastify, {
      ...body,
      orgId: authUser.orgId,
    });

    // Auto-link async (non-blocking — returns 201 immediately)
    setImmediate(async () => {
      try {
        if (node.layer === "CODE" || node.layer === "INCIDENT") {
          await runAutoLinkPipeline(fastify, node);
        }
        await populateNodeEmbedding(fastify, node.id);
      } catch (err) {
        fastify.log.error({ err, nodeId: node.id }, "Post-create pipeline failed");
      }
    });

    return reply.code(201).send(node);
  });

  // POST /api/v1/nodes/batch — create up to 100 nodes
  fastify.post("/batch", async (request, reply) => {
    const { authUser } = request;
    const body = z.array(CreateNodeSchema).max(100).parse(request.body);

    const nodes = await createNodes(
      fastify,
      body.map((n) => ({ ...n, orgId: authUser.orgId }))
    );

    // Auto-link and embed async
    setImmediate(async () => {
      for (const node of nodes) {
        try {
          if (node.layer === "CODE" || node.layer === "INCIDENT") {
            await runAutoLinkPipeline(fastify, node);
          }
          await populateNodeEmbedding(fastify, node.id);
        } catch (err) {
          fastify.log.error({ err, nodeId: node.id }, "Post-create pipeline failed");
        }
      }
    });

    return reply.code(201).send({ created: nodes.length, nodes });
  });

  // GET /api/v1/nodes/:id — get a single node
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const node = await getNode(fastify, request.params.id, request.authUser.orgId);
    if (!node) return reply.notFound(`Node ${request.params.id} not found`);
    return node;
  });

  // GET /api/v1/nodes/:id/ancestors
  fastify.get<{
    Params: { id: string };
    Querystring: { maxDepth?: string };
  }>("/:id/ancestors", async (request, reply) => {
    const maxDepth = Math.min(10, parseInt(request.query.maxDepth ?? "6", 10));
    const result = await getAncestors(
      fastify,
      request.params.id,
      request.authUser.orgId,
      maxDepth
    );
    return result;
  });
};

export default nodesPlugin;
