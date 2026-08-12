import { uuidv7 } from "uuidv7";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ReplayRequestSchema } from "@causal/types";
import * as Diff from "diff";
import { complete, resolveForPurpose } from "../services/llm.js";

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
    const snapshot = await fastify.s3.getSnapshot(meta["s3_key"] as string);

    // 3. Which model would answer — resolved before the run so the fidelity
    //    signals can compare against the model that actually replays.
    const resolved = await resolveForPurpose(fastify, orgId, "rca");
    const targetModel = body.modelOverride ?? resolved?.model ?? null;
    const fidelity = computeFidelitySignals(snapshot, targetModel);

    // A replay with no provider behind it produces no output. It used to write a
    // 'complete' row holding a placeholder string for BOTH runs — a record of a
    // model call that never happened, with a guaranteed-empty diff.
    if (!resolved) {
      await recordFailedReplay(fastify, replayId, orgId, body.snapshotId, body.modification, targetModel,
        "No LLM provider is configured for this workspace, so the session could not be re-run.");
      return reply.code(503).send({
        error: "Replay requires an LLM provider",
        detail: "Add a provider key under Settings to re-run this session.",
        fidelity,
      });
    }

    // 4. Build original output (first run — no modification)
    const original = await runAgentSession(fastify, orgId, snapshot, null, body.modelOverride, body.maxTokens);

    // 5. Build modified output
    const modified = original
      ? await runAgentSession(fastify, orgId, snapshot, body.modification, body.modelOverride, body.maxTokens)
      : null;

    if (!original || !modified) {
      await recordFailedReplay(fastify, replayId, orgId, body.snapshotId, body.modification, targetModel,
        "The provider call failed or returned nothing; see the API log for the provider's reason.");
      return reply.code(502).send({
        error: "Replay could not be completed",
        detail: "The configured LLM provider did not return a completion for this session.",
        fidelity,
      });
    }

    // 6. Compute diff
    const diffResult = Diff.diffLines(original.text, modified.text).map((part) => ({
      type: part.added ? "added" as const : part.removed ? "removed" as const : "unchanged" as const,
      value: part.value,
    }));

    // 7. Persist replay run — 'complete' now means two model calls really ran.
    await fastify.pg`
      INSERT INTO replay_runs (
        id, org_id, snapshot_id, modification, fidelity_score,
        original_output, modified_output, output_diff,
        model_used, status, created_at, completed_at
      ) VALUES (
        ${replayId}, ${orgId}, ${body.snapshotId},
        ${JSON.stringify(body.modification)},
        ${fidelity.overallScore},
        ${original.text}, ${modified.text},
        ${JSON.stringify(diffResult)},
        ${original.model},
        'complete', NOW(), NOW()
      )
    `;

    return reply.code(200).send({
      id: replayId,
      snapshotId: body.snapshotId,
      originalOutput: original.text,
      modifiedOutput: modified.text,
      diff: diffResult,
      // Null whenever the score rests on proxies rather than measurements —
      // clients must hide the bar rather than render a made-up percentage.
      fidelityScore: fidelity.overallScore,
      fidelity,
      modelUsed: original.model,
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

    const snapshot = await fastify.s3.getSnapshot(meta["s3_key"] as string);
    return snapshot;
  });

  // GET /api/v1/replay/:id/fidelity — fidelity signals without running replay
  fastify.get<{ Params: { snapshotId: string } }>("/fidelity/:snapshotId", async (request, reply) => {
    const { orgId } = request.authUser;
    const metaRows = await fastify.pg`
      SELECT s.*, n.org_id FROM snapshot_meta s
      JOIN causal_nodes n ON n.id = s.node_id
      WHERE s.snapshot_id = ${request.params.snapshotId}
        AND n.org_id = ${orgId}
    ` as Array<Record<string, unknown>>;

    if (!metaRows.length) return reply.notFound();
    const meta = metaRows[0]!;
    const snapshot = await fastify.s3.getSnapshot(meta["s3_key"] as string);

    const resolved = await resolveForPurpose(fastify, orgId, "rca");
    return computeFidelitySignals(snapshot, resolved?.model ?? null);
  });
};

/** A replay that never produced output is recorded as one, never as 'complete'. */
async function recordFailedReplay(
  fastify: FastifyInstance,
  replayId: string,
  orgId: string,
  snapshotId: string,
  modification: import("@causal/types").ReplayModification,
  modelUsed: string | null,
  error: string
): Promise<void> {
  await fastify.pg`
    INSERT INTO replay_runs (
      id, org_id, snapshot_id, modification, model_used, status, created_at, completed_at, error
    ) VALUES (
      ${replayId}, ${orgId}, ${snapshotId}, ${JSON.stringify(modification)},
      ${modelUsed}, 'failed', NOW(), NOW(), ${error}
    )
  `;
}

// ── Run agent session through the workspace's provider ────────────
async function runAgentSession(
  fastify: FastifyInstance,
  orgId: string,
  snapshot: import("@causal/types").ContextSnapshot,
  modification: import("@causal/types").ReplayModification | null,
  modelOverride: string | undefined,
  maxTokens: number
): Promise<{ text: string; model: string } | null> {
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
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  ) as Array<{ role: "user" | "assistant"; content: string }>;

  const res = await complete({
    fastify,
    orgId,
    purpose: "rca",
    maxTokens,
    system: systemPrompt,
    messages: filteredMessages.length
      ? filteredMessages
      : [{ role: "user", content: "Continue the task." }],
    ...(modelOverride ? { model: modelOverride } : {}),
  });

  return res ? { text: res.text, model: res.model } : null;
}

// ── Fidelity signals ──────────────────────────────────────────────
/**
 * What can actually be established about how faithful a replay is.
 *
 * Two of the three inputs the weighted score needs are not available to the API:
 * tool drift needs the agent's *current* tool definitions (this used to compare
 * against a hardcoded `["causal_link"]`) and repo drift needs the repo at HEAD
 * (this used to be snapshot age with no repo inspection at all). Both stay null,
 * and `overallScore` stays null with them — a guessed fidelity number is exactly
 * the kind of claim this product exists to kill, and it was gating replays with
 * a 422 that said "Repo has diverged significantly" on the strength of it.
 */
interface ReplayFidelitySignals {
  snapshotId: string;
  overallScore: number | null;
  toolDefinitionMatch: null;
  repoDivergenceScore: null;
  /** Null when no provider is configured, so there is no model to compare to. */
  modelMatches: boolean | null;
  daysElapsed: number;
  /** Why there is no score — so a client can say that instead of showing 0%. */
  unmeasured: string[];
  details: {
    originalModel: string;
    currentModel: string | null;
    /** The tools the snapshot recorded. Drift is unknown, so nothing is claimed. */
    toolsRecorded: string[];
  };
}

function computeFidelitySignals(
  snapshot: import("@causal/types").ContextSnapshot,
  targetModel: string | null
): ReplayFidelitySignals {
  const ageDays = (Date.now() - snapshot.timestamp) / (1000 * 60 * 60 * 24);

  return {
    snapshotId: snapshot.snapshotId,
    overallScore: null,
    toolDefinitionMatch: null,
    repoDivergenceScore: null,
    modelMatches: targetModel === null ? null : snapshot.modelId === targetModel,
    daysElapsed: Math.floor(ageDays),
    unmeasured: [
      "tool definition drift — the agent's current tool set is not reported to the API",
      "repo divergence — the repo at HEAD is not inspected, so commits ahead is unknown",
    ],
    details: {
      originalModel: snapshot.modelId,
      currentModel: targetModel,
      toolsRecorded: snapshot.toolsAvailable.map((t) => t.name),
    },
  };
}

export default replayPlugin;
