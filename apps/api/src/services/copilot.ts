import type { FastifyInstance } from "fastify";
import { Anthropic } from "@anthropic-ai/sdk";
import { getTrace } from "./traces.js";
import { getRca } from "./rca.js";
import { config } from "../config.js";

const IS_DEMO = !config.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY.startsWith("sk-ant-...");
let anthropic: Anthropic | null = null;
if (!IS_DEMO) anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

interface SpanView {
  id: string; parentId: string | null; name: string; kind: string; status: string;
  durationMs: number; tokensIn?: number; tokensOut?: number; cost?: number;
  error?: string | null; git?: { file: string; line: number; commit: string } | null;
  io?: { input?: string; output?: string } | null;
}

/**
 * Build the grounding context the Copilot answers from: the span tree, the
 * detector finding, the RCA, and git context. Everything the model says should
 * be traceable to one of these.
 */
function buildContext(trace: Record<string, unknown>, rca: Record<string, unknown> | null): string {
  const spans = (trace["spans"] as SpanView[]) ?? [];
  const finding = trace["finding"] as Record<string, unknown> | null;

  const lines = spans.map((s) => {
    const econ = s.cost !== undefined ? ` tokens=${s.tokensIn ?? 0}->${s.tokensOut ?? 0} cost=$${Number(s.cost).toFixed(4)}` : "";
    const git = s.git ? ` @${s.git.file}:${s.git.line} (${s.git.commit})` : "";
    const err = s.error ? ` ERROR="${s.error}"` : "";
    const io = s.io?.output ? `\n      output: ${String(s.io.output).slice(0, 400)}` : "";
    return `  [${s.id}] ${s.name} (${s.kind}) ${s.status} ${s.durationMs}ms${econ}${git}${err}${io}`;
  });

  return `TRACE ${trace["traceId"]} — service ${trace["service"]}, env ${trace["environment"]}
tokens ${trace["tokensIn"]} -> ${trace["tokensOut"]}, cost $${Number(trace["cost"] ?? 0).toFixed(4)}
repo ${trace["repo"] ?? "-"} ref ${trace["gitRef"] ?? "-"} user ${trace["user"] ?? "-"} session ${trace["sessionId"] ?? "-"}

SPANS (${spans.length}):
${lines.join("\n")}

DETECTOR FINDING: ${finding ? `${finding["detector"]} — ${finding["title"]} (confidence ${finding["confidence"]}, span ${finding["triggeredSpanId"]})\n${finding["summary"]}` : "none — no detector flagged this trace"}

ROOT CAUSE ANALYSIS: ${rca ? `${rca["summary"]}\ncommit ${rca["commit"]} ${rca["file"]}:${rca["line"]}\n${rca["explanation"]}\nCounterfactual: ${rca["counterfactual"]}\nProposed fix: ${rca["fixTitle"]} — ${rca["fixDescription"]} (PR status ${rca["prStatus"]})` : "not run for this trace"}`;
}

const SYSTEM = `You are Causal Copilot, embedded in an AI-agent observability product. You answer questions about ONE trace.

Rules:
- Ground every claim in the provided trace context. If the context doesn't support an answer, say so plainly.
- Never invent span names, commits, files, numbers, or costs.
- Be concise and technical. Use markdown: short section headers, bullets, and \`code\` for span names, files, and commits.
- When asked "why did this fail", identify the EARLIEST failing span (the origin), not the loudest downstream symptom, and explain the causal chain.
- When asked about cost, cite the most expensive spans by name with their actual numbers.`;

/** Answer a question about a trace, grounded in its spans/finding/RCA. */
export async function askCopilot(
  fastify: FastifyInstance,
  orgId: string,
  traceId: string,
  question: string
): Promise<{ answer: string; model: string; grounded: boolean } | null> {
  const trace = await getTrace(fastify, orgId, traceId);
  if (!trace) return null;
  const rca = await getRca(fastify, orgId, traceId);
  const context = buildContext(trace, rca);

  // Persist the question so a conversation has history.
  await fastify.pg`
    INSERT INTO copilot_messages (org_id, trace_id, role, content) VALUES (${orgId}, ${traceId}, 'user', ${question})
  `;

  let answer: string;
  let model = "deterministic";
  if (anthropic) {
    // Take the most RECENT 20 and restore chronological order. Taking the
    // oldest 20 meant that past message 20 the question just asked fell outside
    // the window entirely and the model was re-sent stale history.
    const recent = (await fastify.pg`
      SELECT role, content FROM copilot_messages
      WHERE org_id = ${orgId} AND trace_id = ${traceId}
      ORDER BY created_at DESC LIMIT 20
    `) as Array<{ role: "user" | "assistant"; content: string }>;
    const prior = recent.slice().reverse();

    const res = await anthropic.messages.create({
      model: config.COPILOT_MODEL,
      max_tokens: 1200,
      system: `${SYSTEM}\n\n--- TRACE CONTEXT ---\n${context}`,
      messages: prior.length
        ? prior.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: "user", content: question }],
    });
    const text = res.content.find((c) => c.type === "text");
    answer = text && text.type === "text" ? text.text : "I couldn't produce an answer for that.";
    model = config.COPILOT_MODEL;
  } else {
    answer = deterministicAnswer(question, trace, rca);
  }

  await fastify.pg`
    INSERT INTO copilot_messages (org_id, trace_id, role, content, model)
    VALUES (${orgId}, ${traceId}, 'assistant', ${answer}, ${model})
  `;

  // `grounded` means an LLM reasoned over the trace context. The deterministic
  // fallback still reads real trace data, but it is templated, not reasoned —
  // reporting it as grounded overstated what happened.
  return { answer, model, grounded: anthropic !== null };
}

/** No-API-key fallback: still answers from real trace data, just without an LLM. */
function deterministicAnswer(q: string, trace: Record<string, unknown>, rca: Record<string, unknown> | null): string {
  const spans = (trace["spans"] as SpanView[]) ?? [];
  const ql = q.toLowerCase();
  const finding = trace["finding"] as Record<string, unknown> | null;

  if (ql.includes("cost") || ql.includes("token") || ql.includes("spend")) {
    const top = spans.filter((s) => s.cost !== undefined).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 5);
    const rows = top.map((s) => `- \`${s.name}\` — ${(s.tokensIn ?? 0) + (s.tokensOut ?? 0)} tokens, **$${Number(s.cost).toFixed(4)}**`).join("\n");
    return `## Cost breakdown\nThis trace used **${trace["tokensIn"]}** in + **${trace["tokensOut"]}** out (~**$${Number(trace["cost"] ?? 0).toFixed(4)}**) across ${spans.length} spans.\n\n${rows || "_No per-span cost recorded._"}`;
  }
  if (ql.includes("fix")) {
    return rca
      ? `## The fix\n${rca["fixDescription"]}\n\nRoot cause: ${rca["summary"]} — commit \`${rca["commit"]}\` (\`${rca["file"]}:${rca["line"]}\`). PR status: _${rca["prStatus"]}_.`
      : "No root-cause analysis has been run for this trace yet.";
  }
  const firstErr = spans.find((s) => s.status === "error");
  if (!firstErr && !finding) {
    return `## Result\nNo detector flagged this trace and every span returned \`ok\`. ${spans.length} spans, ${trace["tokensIn"]} → ${trace["tokensOut"]} tokens.`;
  }
  return `## What happened\nThe earliest failing span is \`${firstErr?.name ?? "unknown"}\`${firstErr?.git ? ` (\`${firstErr.git.file}:${firstErr.git.line}\`)` : ""}${firstErr?.error ? `: ${firstErr.error}` : ""}.\n\n${finding ? `The **${finding["detector"]}** detector fired: ${finding["summary"]}` : ""}${rca ? `\n\n## Root cause\n${rca["explanation"]}\n\n**Counterfactual:** ${rca["counterfactual"]}` : ""}`;
}

/** Conversation history for a trace. */
export async function getCopilotHistory(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Array<Record<string, unknown>>> {
  const rows = (await fastify.pg`
    SELECT role, content, model, created_at FROM copilot_messages
    WHERE org_id = ${orgId} AND trace_id = ${traceId}
    ORDER BY created_at ASC LIMIT 100
  `) as Array<Record<string, unknown>>;
  return rows;
}
