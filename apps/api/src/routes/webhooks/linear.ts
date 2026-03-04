import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { populateNodeEmbedding } from "../../services/embeddings.js";

const linearWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/linear", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const action = (body["action"] as string) ?? "";
    const type = (body["type"] as string) ?? "";

    // Only handle Issue create/update
    if (type !== "Issue" || !["create", "update"].includes(action)) {
      return reply.code(200).send({ ok: true, skipped: true });
    }

    const data = body["data"] as Record<string, unknown>;
    const issueId = (data["id"] as string) ?? "";
    const identifier = (data["identifier"] as string) ?? issueId; // e.g. LIN-447
    const title = (data["title"] as string) ?? "";
    const description = (data["description"] as string) ?? "";
    const url = (data["url"] as string) ?? "";
    const state = (data["state"] as Record<string, unknown>)?.["name"] as string ?? "";
    const teamId = (data["team"] as Record<string, unknown>)?.["id"] as string ?? "";
    const priority = Number(data["priority"] ?? 0);

    const orgId = "default"; // TODO: resolve from Linear team → Causal org mapping

    const specNode = await createNode(fastify, {
      layer: "SPEC",
      kind: "linear_issue",
      timestamp: Date.now(),
      agentId: null,
      modelVersion: null,
      sessionId: null,
      contextSnapId: null,
      payload: {
        title,
        url,
        externalId: identifier,
        acceptanceCriteria: description,
        description,
        status: state,
        source: "linear",
      },
      orgId,
      repoId: teamId,
    });

    // Populate embedding async for Strategy 4 auto-linking
    setImmediate(() => populateNodeEmbedding(fastify, specNode.id).catch(() => {}));

    fastify.log.info({ identifier, action, title }, "Linear issue processed");

    return reply.code(200).send({ ok: true, nodeId: specNode.id });
  });
};

export default linearWebhookPlugin;
