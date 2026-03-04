import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";

const datadogWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/datadog", async (request, reply) => {
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

    const orgId = "default"; // TODO: resolve from Datadog team config

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
