import { uuidv7 } from "uuidv7";
import type { FastifyPluginAsync } from "fastify";
import { ReplayRequestSchema } from "@causal/types";
import Anthropic from "@anthropic-ai/sdk";
import * as Diff from "diff";
import { config } from "../config.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const replayPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/replay — restore snapshot, apply mod, re-run, return diff
  fastify.post("/", async (request, reply) => {
    const body = ReplayRequestSchema.parse(request.body);
    const { orgId } = request.authUser;
    const replayId = uuidv7();

    // 1. Look up snapshot metadata
    const metaRows = await fastify.pg`
      SELECT s.*, n.org_id FROM snapshot_meta s
      JOIN causal_nodes n ON n.id = s.node_id
      WHERE s.snapshot_id = ${body.snapshotId}
        AND n.org_id = ${orgId}
    ` as Array<Record<string, unknown>>;

    if (!metaRows.length) return reply.notFound("Snapshot not found");
    const meta = metaRows[0]!;

    // 2. Fetch full snapshot from S3
    const snapshot = await fastify.s3.getSnapshot(meta["s3Key"] as string);

    // 3. Compute fidelity score
    const fidelity = computeFidelityScore(snapshot, body.modelOverride);

    if (fidelity.overallScore < 0.4) {
      return reply.code(422).send({
        error: "Replay fidelity too low to produce meaningful results",
        fidelity,
        recommendation: `Original model: ${snapshot.modelId}. Repo has diverged significantly.`,
      });
    }

    // 4. Build original output (first run — no modification)
    const originalOutput = await runAgentSession(snapshot, null);

    // 5. Build modified output
    const modifiedOutput = await runAgentSession(snapshot, body.modification);

    // 6. Compute diff
    const diffResult = Diff.diffLines(originalOutput, modifiedOutput).map((part) => ({
      type: part.added ? "added" as const : part.removed ? "removed" as const : "unchanged" as const,
      value: part.value,
    }));

    // 7. Persist replay run
    await fastify.pg`
      INSERT INTO replay_runs (
        id, org_id, snapshot_id, modification, fidelity_score,
        original_output, modified_output, output_diff,
        model_used, status, created_at, completed_at
      ) VALUES (
        ${replayId}, ${orgId}, ${body.snapshotId},
        ${JSON.stringify(body.modification)},
        ${fidelity.overallScore},
        ${originalOutput}, ${modifiedOutput},
        ${JSON.stringify(diffResult)},
        ${body.modelOverride ?? snapshot.modelId},
        'complete', NOW(), NOW()
      )
    `;

    return reply.code(200).send({
      id: replayId,
      snapshotId: body.snapshotId,
      originalOutput,
      modifiedOutput,
      diff: diffResult,
      fidelityScore: fidelity.overallScore,
      fidelityWarning: fidelity.warningLevel !== "none" ? fidelity : undefined,
      modelUsed: body.modelOverride ?? snapshot.modelId,
      completedAt: Date.now(),
    });
  });

  // GET /api/v1/snapshots/:id — retrieve a context snapshot
  fastify.get<{ Params: { id: string } }>("/snapshots/:id", async (request, reply) => {
    const metaRows = await fastify.pg`
      SELECT s.*, n.org_id FROM snapshot_meta s
      JOIN causal_nodes n ON n.id = s.node_id
      WHERE s.snapshot_id = ${request.params.id}
        AND n.org_id = ${request.authUser.orgId}
    ` as Array<Record<string, unknown>>;

    if (!metaRows.length) return reply.notFound();
    const meta = metaRows[0]!;

    const snapshot = await fastify.s3.getSnapshot(meta["s3Key"] as string);
    return snapshot;
  });

  // GET /api/v1/replay/:id/fidelity — fidelity score without running replay
  fastify.get<{ Params: { id: string } }>("/fidelity/:snapshotId", async (request, reply) => {
    const metaRows = await fastify.pg`
      SELECT s.*, n.org_id FROM snapshot_meta s
      JOIN causal_nodes n ON n.id = s.node_id
      WHERE s.snapshot_id = ${request.params.id}
        AND n.org_id = ${request.authUser.orgId}
    ` as Array<Record<string, unknown>>;

    if (!metaRows.length) return reply.notFound();
    const meta = metaRows[0]!;
    const snapshot = await fastify.s3.getSnapshot(meta["s3Key"] as string);

    return computeFidelityScore(snapshot, undefined);
  });
};

// ── Run agent session via Claude API ─────────────────────────────
async function runAgentSession(
  snapshot: import("@causal/types").ContextSnapshot,
  modification: import("@causal/types").ReplayModification | null
): Promise<string> {
  let systemPrompt = snapshot.systemPrompt;
  const messages = [...snapshot.messages];

  if (modification) {
    switch (modification.type) {
      case "system_prompt_append":
        systemPrompt += `\n\n${modification.content}`;
        break;
      case "system_prompt_replace":
        systemPrompt = modification.content;
        break;
      case "context_inject":
        if (modification.position === "start") {
          messages.unshift({ role: "user", content: modification.content });
        } else if (modification.position === "before_last_user") {
          const lastUserIdx = messages.reduceRight(
            (idx, m, i) => (idx === -1 && m.role === "user" ? i : idx),
            -1
          );
          if (lastUserIdx >= 0) {
            messages.splice(lastUserIdx, 0, { role: "user", content: modification.content });
          }
        } else {
          messages.push({ role: "user", content: modification.content });
        }
        break;
    }
  }

  // Filter to only user/assistant messages (remove system from messages array)
  const filteredMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  ) as Anthropic.MessageParam[];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: filteredMessages.length
      ? filteredMessages
      : [{ role: "user", content: "Continue the task." }],
  });

  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

// ── Fidelity score computation ────────────────────────────────────
function computeFidelityScore(
  snapshot: import("@causal/types").ContextSnapshot,
  modelOverride?: string
): import("@causal/types").ReplayFidelity {
  const targetModel = modelOverride ?? "claude-sonnet-4-6";
  const originalModel = snapshot.modelId;

  // Model version match (0–1)
  const modelVersionMatch = originalModel === targetModel ? 1.0 : 0.5;

  // Tool definition match — compare tool names
  const currentToolNames = new Set(["causal_link"]);
  const originalToolNames = new Set(snapshot.toolsAvailable.map((t) => t.name));
  const toolsChanged: string[] = [];
  for (const tool of originalToolNames) {
    if (!currentToolNames.has(tool)) toolsChanged.push(tool);
  }
  const toolDefinitionMatch = toolsChanged.length === 0 ? 1.0 : Math.max(0, 1 - toolsChanged.length / Math.max(1, originalToolNames.size));

  // Repo divergence — estimate from snapshot age
  const ageMs = Date.now() - snapshot.timestamp;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const repoDivergenceScore = Math.max(0, 1 - ageDays / 90); // 90 days = 0

  const overallScore =
    modelVersionMatch * 0.4 +
    toolDefinitionMatch * 0.3 +
    repoDivergenceScore * 0.3;

  const warningLevel =
    overallScore >= 0.7 ? "none" :
    overallScore >= 0.4 ? "low" :
    overallScore >= 0.3 ? "high" :
    "critical";

  return {
    snapshotId: snapshot.snapshotId,
    overallScore,
    modelVersionMatch,
    toolDefinitionMatch,
    repoDivergenceScore,
    daysElapsed: Math.floor(ageDays),
    warningLevel: warningLevel as import("@causal/types").ReplayFidelity["warningLevel"],
    details: {
      originalModel,
      currentModel: targetModel,
      toolsChanged,
      commitsAhead: undefined,
    },
  };
}

export default replayPlugin;
