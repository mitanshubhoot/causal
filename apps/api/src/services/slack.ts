import { WebClient } from "@slack/web-api";
import type { TraceGraph } from "@causal/types";
import { config } from "../config.js";

let slackClient: WebClient | null = null;

function getSlackClient(): WebClient | null {
  if (!config.SLACK_BOT_TOKEN) return null;
  if (!slackClient) slackClient = new WebClient(config.SLACK_BOT_TOKEN);
  return slackClient;
}

export async function notifyIncidentTraced(
  channelId: string,
  traceGraph: TraceGraph,
  incidentTitle: string,
  incidentId: string
): Promise<void> {
  const slack = getSlackClient();
  if (!slack || !config.ENABLE_SLACK_NOTIFICATIONS) return;

  const topRootCause = traceGraph.rootCauses[0];
  const confidence = topRootCause?.probability ?? 0;
  const confidencePct = Math.round(confidence * 100);

  const confidenceEmoji =
    confidence >= 0.85 ? "🟢" : confidence >= 0.6 ? "🟡" : "🔴";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🔍 Causal traced incident: ${incidentTitle}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Incident ID:*\n${incidentId}`,
        },
        {
          type: "mrkdwn",
          text: `*Root Cause Confidence:*\n${confidenceEmoji} ${confidencePct}%`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: topRootCause?.explanation
          ? `*Root Cause:*\n${topRootCause.explanation}`
          : "_Root cause analysis running..._",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Causal chain:* ${traceGraph.criticalPath.length} nodes traced across ${new Set(traceGraph.nodes.map((n) => n.layer)).size} layers`,
      },
    },
    ...(traceGraph.rootCauses.length > 1
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Alternative root causes:*\n${traceGraph.rootCauses
                .slice(1, 4)
                .map((rc, i) => `${i + 2}. ${Math.round(rc.probability * 100)}% — ${rc.explanation ?? "No explanation"}`)
                .join("\n")}`,
            },
          },
        ]
      : []),
    {
      type: "divider",
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Traced at <!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${new Date().toISOString()}> · ${traceGraph.nodes.length} nodes · ${traceGraph.edges.length} edges`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Trace →" },
          style: "primary",
          url: `${config.APP_URL}/incidents/${traceGraph.rootNodeId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Replay with Fix" },
          url: `${config.APP_URL}/incidents/${traceGraph.rootNodeId}/replay`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Generate Postmortem" },
          url: `${config.APP_URL}/incidents/${traceGraph.rootNodeId}/postmortem`,
        },
      ],
    },
  ];

  await slack.chat.postMessage({
    channel: channelId,
    text: `Causal traced incident ${incidentTitle} — ${confidencePct}% confidence root cause identified`,
    blocks,
  });
}

export async function notifySlackChannel(
  channelId: string,
  message: string
): Promise<void> {
  const slack = getSlackClient();
  if (!slack) return;
  await slack.chat.postMessage({ channel: channelId, text: message });
}
