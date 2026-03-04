/**
 * LangSmith webhook handler (P1 integration)
 *
 * LangSmith sends run events when LangGraph agents complete steps.
 * We convert each run into a REASONING node, capturing:
 * - The run ID as sessionId
 * - All tool calls as payload.toolsCalled
 * - The run metadata (model, tokens, etc.)
 *
 * If the run metadata contains a causal-session-id, we use that to
 * link to CODE nodes with weight 0.97 (same as MCP server).
 */

import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";

const langsmithWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/langsmith", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const event = (body["event"] as string) ?? "";

    // LangSmith fires events on run end
    if (!["on_chain_end", "on_agent_end", "on_tool_end", "on_llm_end"].includes(event)) {
      return reply.code(200).send({ ok: true, skipped: true });
    }

    const run = body["run"] as Record<string, unknown>;
    if (!run) return reply.code(200).send({ ok: true });

    const runId = (run["id"] as string) ?? "";
    const runName = (run["name"] as string) ?? "";
    const runType = (run["run_type"] as string) ?? "chain";
    const inputs = run["inputs"] as Record<string, unknown>;
    const outputs = run["outputs"] as Record<string, unknown>;
    const startTime = Number(run["start_time"]) || Date.now();
    const endTime = Number(run["end_time"]) || Date.now();
    const extra = run["extra"] as Record<string, unknown>;
    const tags = (run["tags"] as string[]) ?? [];

    // Extract model info
    const invocationParams = extra?.["invocation_params"] as Record<string, unknown> ?? {};
    const modelName = (invocationParams["model_name"] as string) ?? (invocationParams["model"] as string) ?? "unknown";
    const tokenUsage = extra?.["token_usage"] as Record<string, unknown>;
    const totalTokens = Number(tokenUsage?.["total_tokens"]) || undefined;

    // Extract causal session ID from run metadata or tags
    const metadata = run["metadata"] as Record<string, unknown> ?? {};
    const causalSessionId = (metadata["causal-session-id"] as string)
      ?? tags.find((t) => t.startsWith("causal-session:"))?.split(":")[1]
      ?? null;

    // Extract tool calls
    const toolsCalled = (run["child_runs"] as unknown[] ?? [])
      .map((cr) => (cr as Record<string, unknown>)["name"] as string)
      .filter(Boolean);

    // Resolve project → orgId
    const projectName = (run["project_name"] as string) ?? "default";
    const orgId = "default"; // TODO: resolve from LangSmith project config

    const reasoningNode = await createNode(fastify, {
      layer: "REASONING",
      kind: "langsmith_run",
      timestamp: startTime,
      agentId: runName || runId,
      modelVersion: modelName,
      sessionId: causalSessionId ?? runId,
      contextSnapId: null,
      payload: {
        sessionId: causalSessionId ?? runId,
        modelId: modelName,
        totalTokens,
        toolsCalled,
        filesModified: [],
        specIds: [],
        summary: `LangGraph run: ${runName} (${runType})`,
        snapshotIds: [],
        source: "langsmith",
        langsmithRunId: runId,
        durationMs: endTime - startTime,
      },
      orgId,
      repoId: projectName,
    });

    if (causalSessionId) {
      await runAutoLinkPipeline(fastify, reasoningNode);
    }

    fastify.log.info({ runId, runName, event }, "LangSmith run processed");

    return reply.code(200).send({ ok: true, nodeId: reasoningNode.id });
  });
};

export default langsmithWebhookPlugin;
