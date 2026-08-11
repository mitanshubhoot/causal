import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { populateNodeEmbedding } from "../../services/embeddings.js";
import { config } from "../../config.js";

function verifyLinearSignature(rawBody: string | undefined, signature: string | undefined): boolean {
  if (!config.LINEAR_WEBHOOK_SECRET) return true; // dev mode: no secret configured
  if (!rawBody || !signature) return false;
  const expected = createHmac("sha256", config.LINEAR_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const sig = Buffer.from(signature);
  const exp = Buffer.from(expected);
  return sig.length === exp.length && timingSafeEqual(sig, exp);
}

const linearWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/linear", async (request, reply) => {
    // Verify the Linear HMAC signature when a secret is configured.
    const rawBody = (request as { rawBody?: string }).rawBody;
    const signature = request.headers["linear-signature"] as string | undefined;
    if (!verifyLinearSignature(rawBody, signature)) {
      return reply.code(401).send({ error: "Invalid Linear signature" });
    }

    const body = request.body as Record<string, unknown>;
    const action = (body["action"] as string) ?? "";
    const type = (body["type"] as string) ?? "";

    // Only handle Issue create/update
    if (type !== "Issue" || !["create", "update"].includes(action)) {
      return reply.code(200).send({ ok: true, skipped: true });
    }

    const data = (body["data"] as Record<string, unknown>) ?? {};
    const issueId = (data["id"] as string) ?? "";
    const identifier = (data["identifier"] as string) ?? issueId; // e.g. LIN-447
    const title = (data["title"] as string) ?? "";
    const description = (data["description"] as string) ?? "";
    const url = (data["url"] as string) ?? "";
    const state = (data["state"] as Record<string, unknown>)?.["name"] as string ?? "";
    const teamId = (data["team"] as Record<string, unknown>)?.["id"] as string ?? "";
    const priority = Number(data["priority"] ?? 0);

    // Resolve tenant from an explicit header (set on the per-integration
    // webhook URL) rather than silently co-mingling into a shared "default" org.
    const orgId = (request.headers["x-causal-org-id"] as string) || "default";

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
