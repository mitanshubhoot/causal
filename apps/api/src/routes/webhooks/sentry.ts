import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline, parseStackTrace } from "../../services/autolink.js";
import { assembleTraceGraph } from "../../services/tracegraph.js";
import { notifyIncidentTraced } from "../../services/slack.js";
import { config } from "../../config.js";

const sentryWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/sentry", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // Verify Sentry webhook signature
    if (config.SENTRY_WEBHOOK_SECRET) {
      const signature = request.headers["sentry-hook-signature"] as string;
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
      const expected = createHmac("sha256", config.SENTRY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.code(401).send({ error: "Invalid Sentry signature" });
      }
    }

    const body = request.body as Record<string, unknown>;
    const action = body["action"] as string;

    // Only process new issues (not resolved/commented)
    if (action !== "created") {
      return reply.code(200).send({ ok: true, skipped: true });
    }

    const data = body["data"] as Record<string, unknown>;
    const issue = data?.["issue"] as Record<string, unknown>;

    if (!issue) return reply.code(200).send({ ok: true });

    const issueId = (issue["id"] as string) ?? "";
    const title = (issue["title"] as string) ?? "";
    const culprit = (issue["culprit"] as string) ?? "";
    const permalink = (issue["permalink"] as string) ?? "";
    const level = (issue["level"] as string) ?? "error";

    // Extract stack trace from first event
    const event = (issue["firstSeen"] as string) ?? "";
    const exception = (issue["metadata"] as Record<string, unknown>)?.["value"] as string ?? "";

    // Parse stack trace frames from the raw stack trace
    const rawStackTrace = culprit || exception;
    const frames = parseStackTrace(rawStackTrace);

    // Determine project → orgId mapping
    const project = (body["project_slug"] as string) ?? "default";
    const orgId = "default"; // TODO: resolve from Sentry DSN / org config

    const incidentNode = await createNode(fastify, {
      layer: "INCIDENT",
      kind: "sentry_error",
      timestamp: Date.now(),
      agentId: null,
      modelVersion: null,
      sessionId: null,
      contextSnapId: null,
      payload: {
        externalId: issueId,
        title,
        description: exception,
        severity: level === "fatal" ? "P1" : level === "error" ? "P2" : "P3",
        service: project,
        url: permalink,
        stackTrace: rawStackTrace,
        stackTraceFrames: frames,
        source: "sentry",
      },
      orgId,
      repoId: project,
    });

    const { edgesCreated } = await runAutoLinkPipeline(fastify, incidentNode);

    fastify.log.info(
      { issueId, frames: frames.length, edgesCreated: edgesCreated.length },
      "Sentry issue processed"
    );

    setImmediate(async () => {
      try {
        const traceGraph = await assembleTraceGraph(fastify, incidentNode.id, orgId);

        if (process.env["SLACK_INCIDENT_CHANNEL"]) {
          await notifyIncidentTraced(
            process.env["SLACK_INCIDENT_CHANNEL"],
            traceGraph,
            title,
            issueId
          );
        }
      } catch (err) {
        fastify.log.error({ err, issueId }, "Post-Sentry pipeline failed");
      }
    });

    return reply.code(200).send({ ok: true, nodeId: incidentNode.id });
  });
};

export default sentryWebhookPlugin;
