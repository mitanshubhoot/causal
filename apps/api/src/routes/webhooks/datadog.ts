import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";
import { config } from "../../config.js";

const datadogWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/datadog", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // Verify Datadog webhook signature if configured
    const datadogSecret = process.env["DATADOG_WEBHOOK_SECRET"];
    if (datadogSecret) {
      const signature = request.headers["x-datadog-signature"] as string;
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
      const expected = createHmac("sha256", datadogSecret)
        .update(rawBody)
        .digest("hex");

      if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.code(401).send({ error: "Invalid Datadog signature" });
      }
    }

    const body = request.body as Record<string, unknown>;

    // Datadog monitor alert payload
    const alertTitle = (body["title"] as string) ?? "";
    const alertId = (body["id"] as string) ?? String(Date.now());
    const alertType = (body["alert_type"] as string) ?? "error";
    const tags = (body["tags"] as string) ?? "";
    const spanId = (body["span_id"] as string) ?? alertId;
    const traceId = (body["trace_id"] as string) ?? "";
    const service = (body["service"] as string) ?? tags.split(",").find((t) => t.startsWith("service:"))?.split(":")[1] ?? "unknown";
    const latencyMs = Number(body["value"]) || undefined;

    if (alertType === "recovered") {
      return reply.code(200).send({ ok: true, skipped: true });
    }

    // Resolve orgId from X-Causal-Org-Id header, fallback to "default"
    const orgId = (request.headers["x-causal-org-id"] as string) || "default";

    const executionNode = await createNode(fastify, {
      layer: "EXECUTION",
      kind: "datadog_span",
      timestamp: Date.now(),
      agentId: null,
      modelVersion: null,
      sessionId: null,
      contextSnapId: null,
      payload: {
        spanId,
        traceId,
        service,
        operation: alertTitle,
        latencyMs,
        error: alertType === "error" ? alertTitle : undefined,
        source: "datadog",
      },
      orgId,
      repoId: service,
    });

    await runAutoLinkPipeline(fastify, executionNode);

    fastify.log.info({ alertId, service, alertType }, "Datadog alert processed");

    return reply.code(200).send({ ok: true, nodeId: executionNode.id });
  });
};

export default datadogWebhookPlugin;
