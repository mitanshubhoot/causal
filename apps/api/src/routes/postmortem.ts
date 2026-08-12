import { uuidv7 } from "uuidv7";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { CausalNode, TraceGraph } from "@causal/types";
import { assembleTraceGraph } from "../services/tracegraph.js";
import { complete } from "../services/llm.js";

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

      const written = await generatePostMortemMarkdown(fastify, orgId, traceGraph);
      const linearTicket = generateLinearTicket(traceGraph);
      const claudeMdRule = generateClaudeMdRule(traceGraph);

      const id = uuidv7();
      await fastify.pg`
        INSERT INTO post_mortems (id, org_id, trace_graph_id, markdown, linear_ticket, claude_md_rule, created_at)
        VALUES (${id}, ${orgId}, ${traceGraph.id}, ${written.markdown}, ${JSON.stringify(linearTicket)}, ${claudeMdRule}, NOW())
      `;

      return reply.code(201).send({
        id,
        traceGraphId: traceGraph.id,
        markdown: written.markdown,
        linearTicket,
        claudeMdRule,
        // `grounded` means a model wrote this from the trace. The structural
        // summary is real data too, but it is the graph restated, not analysis —
        // and the export is a document someone will circulate, so the caller
        // (and the banner inside the markdown) has to say which one it is.
        grounded: written.grounded,
        model: written.model,
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

  // GET /api/v1/postmortem/:id/export?format=markdown|json
  fastify.get<{
    Params: { id: string };
    Querystring: { format?: "markdown" | "json" };
  }>("/:id/export", async (request, reply) => {
    const { id } = request.params;
    const format = request.query.format ?? "markdown";
    const { orgId } = request.authUser;

    const rows = await fastify.pg`
      SELECT * FROM post_mortems WHERE id = ${id} AND org_id = ${orgId}
    ` as Array<Record<string, unknown>>;

    if (!rows.length) return reply.notFound();
    const pm = rows[0]!;

    if (format === "json") {
      reply.header("Content-Disposition", `attachment; filename="postmortem-${id}.json"`);
      reply.header("Content-Type", "application/json");
      return reply.send(JSON.stringify(pm, null, 2));
    }

    const markdown = pm["markdown"] as string;
    reply.header("Content-Disposition", `attachment; filename="postmortem-${id}.md"`);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(markdown);
  });
};

// ── Generate post-mortem Markdown ─────────────────────────────────
interface WrittenPostMortem {
  markdown: string;
  /** True only when a model wrote the document from the trace evidence. */
  grounded: boolean;
  model: string | null;
}

async function generatePostMortemMarkdown(
  fastify: FastifyInstance,
  orgId: string,
  traceGraph: TraceGraph
): Promise<WrittenPostMortem> {
  const topCause = traceGraph.rootCauses[0];
  const heading = `# Post-Mortem — Incident ${new Date().toISOString().split("T")[0]}`;

  const prompt = `You are a senior engineering manager writing a post-mortem for an engineering team.

WHAT CAUSAL RECORDED — this is the only evidence you have:
- Root cause confidence: ${topCause ? `${Math.round(topCause.probability * 100)}%` : "no root cause was ranked"}
- Causal chain length: ${traceGraph.criticalPath.length} nodes
- Layers involved: ${[...new Set(traceGraph.nodes.map((n) => n.layer))].join(", ")}

CAUSAL CHAIN (recorded order, real timestamps):
${chainLines(traceGraph).join("\n")}

ROOT CAUSE ANALYSIS:
${topCause?.explanation ?? "No root cause analysis is available for this trace."}

COUNTERFACTUAL:
${topCause?.counterfactual ?? "Not available"}
${topCause?.interventionPoint ? `\nINTERVENTION POINT:\n${topCause.interventionPoint}` : ""}

Write the document in Markdown with these sections:
1. ## Summary (2-3 sentences)
2. ## Timeline (only events listed in the causal chain above, with their real timestamps)
3. ## Root Cause
4. ## Causal Chain (spec/intent through reasoning to code to incident)
5. ## What Went Wrong (only what the evidence shows)
6. ## Open Questions (what the trace does NOT tell us)
7. ## Proposed Remediation (proposals — nothing here has been done yet)
8. ## Action Items (numbered, specific, owners as [Owner TBD])

Rules: state nothing the evidence above does not support. Do not invent times, durations,
detection latency, deploys, or fixes. If a section has no evidence behind it, write
"Not established by the trace" and move on. Write clearly, for engineers and PMs.`;

  // Routed through the BYOK layer so the workspace's own provider writes the
  // document — this route used to demand an Anthropic server key and fall back
  // to a fabricated one for everybody else.
  const res = await complete({
    fastify,
    orgId,
    purpose: "rca",
    maxTokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  if (res?.text.trim()) {
    return { markdown: `${heading}\n\n${res.text}`, grounded: true, model: res.model };
  }

  return { markdown: `${heading}\n\n${structuralSummary(traceGraph)}`, grounded: false, model: null };
}

/**
 * No-provider fallback: the TraceGraph restated, and nothing else.
 *
 * This document is downloadable as an incident record, so every line here has to
 * come from a node, an edge or a ranked root cause. The version this replaced
 * invented a T-6h→T-0 timeline, contributing factors, a detection latency and a
 * "deployed fix to production" resolution for incidents nobody had touched.
 */
function structuralSummary(traceGraph: TraceGraph): string {
  const topCause = traceGraph.rootCauses[0];
  const layers = [...new Set(traceGraph.nodes.map((n) => n.layer))];

  const causes = traceGraph.rootCauses.length
    ? traceGraph.rootCauses
        .map(
          (c) =>
            `- **[${c.layer}]** node \`${c.nodeId}\` — ranked ${Math.round(c.probability * 100)}% by the graph\n` +
            `  - ${c.explanation}\n` +
            `  - Counterfactual: ${c.counterfactual}` +
            (c.interventionPoint ? `\n  - Intervention point: ${c.interventionPoint}` : "")
        )
        .join("\n")
    : "_No root cause has been ranked for this trace._";

  return `> **No post-mortem was written — no LLM provider is configured for this workspace.**
> What follows is a structural summary of the TraceGraph: the nodes, edges and ranked
> root causes Causal actually recorded. It contains no narrative timeline, contributing
> factors, detection latency or resolution, because nothing in the graph establishes them.
> Add a provider key under Settings to have a post-mortem written from this evidence.

## Ranked root causes
${causes}

## Causal chain
${chainLines(traceGraph).join("\n")}

## Graph
- ${traceGraph.nodes.length} nodes across ${layers.length} layer(s): ${layers.join(", ")}
- ${traceGraph.edges.length} edges
- Critical path: ${traceGraph.criticalPath.length} node(s)
- Top root-cause confidence: ${topCause ? `${Math.round(topCause.probability * 100)}%` : "not ranked"}
- TraceGraph ${traceGraph.id}, status \`${traceGraph.status}\``;
}

/**
 * The critical path in recorded order, falling back to every node by timestamp
 * when no path was ranked. Timestamps are the node's own — never a relative
 * "T-6h" the graph cannot support.
 */
function chainLines(traceGraph: TraceGraph): string[] {
  const byId = new Map(traceGraph.nodes.map((n) => [n.id, n]));
  const path = traceGraph.criticalPath
    .map((id) => byId.get(id))
    .filter((n): n is CausalNode => n !== undefined);
  const ordered = path.length ? path : [...traceGraph.nodes].sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length) return ["_The trace has no nodes._"];
  return ordered.map(
    (n) => `- ${new Date(n.timestamp).toISOString()} — **[${n.layer}]** ${nodeLabel(n)}`
  );
}

function nodeLabel(node: CausalNode): string {
  const payload = node.payload as Record<string, unknown>;
  for (const key of ["title", "commitMessage", "summary", "name"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return node.kind;
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

  // Only claim the rule applies to a model when the reasoning node recorded one —
  // the default here used to name a model that never touched the incident.
  const appliesTo = reasoningNode?.modelVersion ? `\n# Applies to: ${reasoningNode.modelVersion}` : "";

  return `# Causal Rule — auto-generated from incident post-mortem${appliesTo}
# Source: Causal TraceGraph ${traceGraph.id}

## Incident Prevention Rule
${topCause.counterfactual}

## Guidance
- Before implementing logic that affects critical flows, always confirm the exact scope with the spec
- When a spec is ambiguous about error handling, failure modes, or boundary conditions, ask for clarification
- Use causal_link() to declare which spec you are implementing at the start of each task`;
}

export default postmortemPlugin;
