import { uuidv7 } from "uuidv7";
import type { FastifyPluginAsync } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import type { TraceGraph, RootCause } from "@causal/types";
import { assembleTraceGraph } from "../services/tracegraph.js";
import { config } from "../config.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const postmortemPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/postmortem — generate post-mortem from a TraceGraph
  fastify.post<{ Body: { traceGraphId?: string; rootNodeId?: string } }>(
    "/",
    async (request, reply) => {
      const { traceGraphId, rootNodeId } = request.body;
      const { orgId } = request.authUser;

      let traceGraph: TraceGraph;

      if (traceGraphId) {
        // Load cached TraceGraph
        const rows = await fastify.pg`
          SELECT * FROM trace_graphs WHERE id = ${traceGraphId} AND org_id = ${orgId}
        ` as Array<Record<string, unknown>>;
        if (!rows.length) return reply.notFound("TraceGraph not found");
        const row = rows[0]!;

        // Re-assemble to get full nodes/edges
        traceGraph = await assembleTraceGraph(fastify, row["root_node_id"] as string, orgId);
      } else if (rootNodeId) {
        traceGraph = await assembleTraceGraph(fastify, rootNodeId, orgId);
      } else {
        return reply.badRequest("traceGraphId or rootNodeId required");
      }

      // Generate post-mortem via Claude
      const markdown = await generatePostMortemMarkdown(traceGraph);
      const linearTicket = generateLinearTicket(traceGraph);
      const claudeMdRule = generateClaudeMdRule(traceGraph);

      const id = uuidv7();
      await fastify.pg`
        INSERT INTO post_mortems (id, org_id, trace_graph_id, markdown, linear_ticket, claude_md_rule, created_at)
        VALUES (${id}, ${orgId}, ${traceGraph.id}, ${markdown}, ${JSON.stringify(linearTicket)}, ${claudeMdRule}, NOW())
      `;

      return reply.code(201).send({
        id,
        traceGraphId: traceGraph.id,
        markdown,
        linearTicket,
        claudeMdRule,
      });
    }
  );

  // GET /api/v1/postmortem/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const rows = await fastify.pg`
      SELECT * FROM post_mortems WHERE id = ${request.params.id} AND org_id = ${request.authUser.orgId}
    ` as Array<Record<string, unknown>>;
    if (!rows.length) return reply.notFound();
    return rows[0];
  });
};

// ── Generate post-mortem Markdown via Claude ──────────────────────
async function generatePostMortemMarkdown(traceGraph: TraceGraph): Promise<string> {
  const topCause = traceGraph.rootCauses[0];

  const prompt = `You are a senior engineering manager writing a post-mortem for an engineering team.

INCIDENT INFORMATION:
- Root cause confidence: ${topCause ? Math.round(topCause.probability * 100) : "unknown"}%
- Causal chain length: ${traceGraph.criticalPath.length} nodes
- Layers involved: ${[...new Set(traceGraph.nodes.map((n) => n.layer))].join(", ")}

ROOT CAUSE ANALYSIS:
${topCause?.explanation ?? "Root cause analysis in progress"}

COUNTERFACTUAL:
${topCause?.counterfactual ?? "Not available"}

Generate a structured post-mortem document in Markdown with these exact sections:
1. ## Summary (2-3 sentences)
2. ## Timeline (bullet points, inferred from causal chain)
3. ## Root Cause (detailed explanation)
4. ## Causal Chain (the path from spec/intent through reasoning to code to incident)
5. ## What Went Wrong (3-5 bullet points)
6. ## Contributing Factors
7. ## Detection
8. ## Resolution
9. ## Action Items (numbered, specific, with owners as [Owner TBD])
10. ## Lessons Learned

Write clearly. Avoid jargon. This document will be read by engineers and product managers.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  return `# Post-Mortem — Incident ${new Date().toISOString().split("T")[0]}\n\n${text}`;
}

// ── Generate Linear ticket for spec correction ────────────────────
function generateLinearTicket(traceGraph: TraceGraph): Record<string, unknown> {
  const topCause = traceGraph.rootCauses[0];
  const specNode = traceGraph.nodes.find((n) => n.layer === "SPEC");

  return {
    title: "Clarify spec to prevent recurrence of this incident",
    description: topCause?.counterfactual
      ? `**Counterfactual from Causal:**\n${topCause.counterfactual}\n\n**Affected spec:** ${specNode?.payload?.["title"] ?? "Unknown"}\n\n**Action:** Review and clarify the spec to include explicit constraints that would have prevented the agent from making the incorrect assumption.`
      : "Review and clarify the spec based on the post-mortem findings.",
    labels: ["spec-improvement", "incident-followup"],
    priority: "medium",
    linkedTraceGraphId: traceGraph.id,
  };
}

// ── Generate CLAUDE.md rule suggestion ───────────────────────────
function generateClaudeMdRule(traceGraph: TraceGraph): string {
  const topCause = traceGraph.rootCauses[0];
  const reasoningNode = traceGraph.nodes.find((n) => n.layer === "REASONING");

  if (!topCause) {
    return "# Causal Rule (auto-generated)\nAlways confirm ambiguous requirements in the spec before implementing.";
  }

  const modelId = reasoningNode?.modelVersion ?? "claude-sonnet-4-6";

  return `# Causal Rule — auto-generated from incident post-mortem
# Applies to: ${modelId}
# Source: Causal TraceGraph ${traceGraph.id}

## Incident Prevention Rule
${topCause.counterfactual}

## Guidance
- Before implementing logic that affects critical flows, always confirm the exact scope with the spec
- When a spec is ambiguous about error handling, failure modes, or boundary conditions, ask for clarification
- Use causal_link() to declare which spec you are implementing at the start of each task`;
}

export default postmortemPlugin;
