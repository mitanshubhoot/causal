import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";
import { assembleTraceGraph } from "../../services/tracegraph.js";
import { notifyIncidentTraced } from "../../services/slack.js";

const pagerdutyWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/pagerduty", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // PagerDuty sends an array of messages
    const messages = (body["messages"] as unknown[]) ?? [];

    for (const msg of messages) {
      const message = msg as Record<string, unknown>;
      const event = message["event"] as string;
      const incident = message["incident"] as Record<string, unknown>;

      if (!incident) continue;

      // Only process new triggers (not resolved/acknowledged)
      if (event !== "incident.trigger") continue;

      const incidentId = (incident["id"] as string) ?? "";
      const title = (incident["title"] as string) ?? "";
      const summary = (incident["summary"] as string) ?? "";
      const htmlUrl = (incident["html_url"] as string) ?? "";
      const urgency = (incident["urgency"] as string) ?? "low";
      const service = (incident["service"] as Record<string, unknown>)?.["summary"] as string ?? "";

      // Resolve orgId from service metadata
      // In production, PagerDuty services are configured with org metadata
      const orgId = "default"; // TODO: resolve from PagerDuty service config

      const incidentNode = await createNode(fastify, {
        layer: "INCIDENT",
        kind: "pagerduty_alert",
        timestamp: Date.now(),
        agentId: null,
        modelVersion: null,
        sessionId: null,
        contextSnapId: null,
        payload: {
          externalId: incidentId,
          title,
          description: summary,
          severity: urgency === "high" ? "P1" : "P2",
          service,
          url: htmlUrl,
          source: "pagerduty",
        },
        orgId,
        repoId: service,
      });

      // Run auto-link pipeline
      const { edgesCreated } = await runAutoLinkPipeline(fastify, incidentNode);

      fastify.log.info(
        { incidentId, edgesCreated: edgesCreated.length },
        "PagerDuty incident processed"
      );

      // Assemble TraceGraph and notify Slack (async)
      setImmediate(async () => {
        try {
          const traceGraph = await assembleTraceGraph(
            fastify,
            incidentNode.id,
            orgId
          );

          // Notify Slack if configured
          if (process.env["SLACK_INCIDENT_CHANNEL"]) {
            await notifyIncidentTraced(
              process.env["SLACK_INCIDENT_CHANNEL"],
              traceGraph,
              title,
              incidentId
            );
          }
        } catch (err) {
          fastify.log.error({ err, incidentId }, "Post-incident pipeline failed");
        }
      });
    }

    return reply.code(200).send({ ok: true });
  });
};

export default pagerdutyWebhookPlugin;
