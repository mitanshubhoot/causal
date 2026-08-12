import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { Anthropic } from "@anthropic-ai/sdk";
import { getTrace } from "./traces.js";
import { notifySlackChannel } from "./slack.js";
import { config } from "../config.js";

const IS_DEMO = !config.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY.startsWith("sk-ant-...");
let anthropic: Anthropic | null = null;
if (!IS_DEMO) anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export type DetectorType = "hallucination" | "tool_failure" | "intent_drift" | "safety";

interface SpanView {
  id: string;
  name: string;
  kind: string;
  status: string;
  error?: string | null;
  git?: { file: string; line: number; commit: string } | null;
  io?: { input?: string; output?: string } | null;
}
interface TraceView {
  traceId: string;
  service: string;
  title: string | null;
  spans: SpanView[];
}

/**
 * The judge is an LLM, so its JSON is untrusted: an out-of-enum detector or a
 * confidence of 95 would violate the CHECK constraints and 500 the request.
 * Validate and coerce before anything reaches Postgres.
 */
const VerdictSchema = z.object({
  identified: z.boolean(),
  detector: z.enum(["hallucination", "tool_failure", "intent_drift", "safety"]).catch("tool_failure"),
  severity: z.enum(["critical", "high", "medium"]).catch("medium"),
  confidence: z.coerce.number().transform((n) => Math.max(0, Math.min(1, n > 1 ? n / 100 : n))),
  title: z.string().min(1).max(300),
  summary: z.string().max(2000).default(""),
  triggeredSpanId: z.string().default(""),
});
type Verdict = z.infer<typeof VerdictSchema>;

const LABEL: Record<DetectorType, string> = {
  hallucination: "Hallucination",
  tool_failure: "Tool failure",
  intent_drift: "Intent drift",
  safety: "Safety violation",
};

function heuristicVerdict(errSpan: SpanView | undefined, warnSpan: SpanView | undefined): Verdict | null {
  const span = errSpan ?? warnSpan;
  if (!span) return null;
  const detector: DetectorType = span.kind === "llm" ? "hallucination" : errSpan ? "tool_failure" : "intent_drift";
  const gitStr = span.git ? ` (${span.git.file}:${span.git.line})` : "";
  return {
    identified: true,
    detector,
    severity: errSpan ? "critical" : "medium",
    confidence: errSpan ? 0.92 : 0.8,
    title: `${LABEL[detector]} — ${(span.error ?? `${span.name} returned ${span.status}`).slice(0, 110)}`,
    summary: `${span.name}${gitStr} returned ${span.status}. ${span.error ?? ""}`.trim(),
    triggeredSpanId: span.id,
  };
}

async function judgeWithLlm(trace: TraceView): Promise<Verdict | null> {
  if (!anthropic) return null;
  // Include span I/O so the judge can catch hallucination and intent drift in a
  // trace where every span returned ok — the whole point of an LLM judge.
  const spanLines = trace.spans
    .map((s) => {
      const io = s.io ? `\n    input: ${(s.io.input ?? "").slice(0, 600)}\n    output: ${(s.io.output ?? "").slice(0, 600)}` : "";
      return `- ${s.name} [${s.kind}] status=${s.status}${s.error ? ` error="${s.error}"` : ""}${s.git ? ` @${s.git.file}:${s.git.line}` : ""} (id=${s.id})${io}`;
    })
    .join("\n");
  const prompt = `You are a production monitoring judge analyzing one AI-agent trace. Decide whether it exhibits a problem in one of these classes:
- hallucination: the output asserts facts not supported by any tool result or input
- tool_failure: a tool/function/API call failed, or failed silently, on the critical path
- intent_drift: the final output diverges from what the user actually asked for
- safety: policy violation, unsafe advice, or sensitive data exposed in output

A trace where every span returned "ok" can STILL be a hallucination or intent drift — read the inputs and outputs, do not rely on status alone. If the run is genuinely healthy, set identified=false.

Service: ${trace.service}
Spans:
${spanLines}

Respond with ONLY a JSON object: {"identified": boolean, "detector": one of the four class names, "severity": "critical"|"high"|"medium", "confidence": number between 0 and 1, "title": short string, "summary": one or two sentences citing the evidence, "triggeredSpanId": the id of the span the problem originates in}.`;
  const res = await anthropic.messages.create({
    model: config.DETECTOR_MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") return null;
  const match = text.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const parsed = VerdictSchema.safeParse(JSON.parse(match[0]));
  if (!parsed.success) return null;
  // The judge can name a span that doesn't exist — pin it to a real one.
  const v = parsed.data;
  if (!trace.spans.some((s) => s.id === v.triggeredSpanId)) {
    v.triggeredSpanId =
      trace.spans.find((s) => s.status === "error")?.id ?? trace.spans[0]?.id ?? "";
  }
  return v;
}

/**
 * Run the detector over a trace. Writes a finding (and alerts + optionally
 * triggers RCA) when a problem is identified. Returns the finding or null.
 * Uses the LLM judge when an Anthropic key is set, else a heuristic so it
 * still produces findings in demo mode.
 */
export async function runDetector(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const trace = (await getTrace(fastify, orgId, traceId)) as unknown as TraceView | null;
  if (!trace) return null;
  const errSpan = trace.spans.find((s) => s.status === "error");
  const warnSpan = trace.spans.find((s) => s.status === "warn");

  // NOTE: the judge runs on EVERY trace. A run where every span returned "ok"
  // can still be a hallucination or intent drift — that's exactly the class an
  // LLM judge exists to catch, and gating on error/warn made it unreachable.
  let verdict: Verdict | null = null;
  if (anthropic) {
    try {
      verdict = await judgeWithLlm(trace);
    } catch (err) {
      fastify.log.warn({ err, traceId }, "LLM judge failed — falling back to heuristic");
    }
  }
  // Without a model we can only reason from status, so a clean trace stays clean.
  if (!verdict) verdict = heuristicVerdict(errSpan, warnSpan);

  const judgeModel = anthropic ? config.DETECTOR_MODEL : "heuristic";
  const detectorRow = verdict
    ? ((await fastify.pg`
        SELECT id FROM detectors WHERE org_id = ${orgId} AND type = ${verdict.detector} AND enabled LIMIT 1
      `) as Array<{ id: string }>)[0]
    : undefined;

  // Record the evaluation either way, so "clean" runs are auditable history.
  if (!verdict || !verdict.identified) {
    await fastify.pg`
      INSERT INTO detector_runs (org_id, detector_id, trace_id, identified, judge_model)
      VALUES (${orgId}, ${detectorRow?.id ?? null}, ${traceId}, false, ${judgeModel})
    `;
    return null;
  }

  // Respect the org's confidence floor rather than persisting anything.
  if (verdict.confidence < config.MIN_CONFIDENCE_THRESHOLD) {
    await fastify.pg`
      INSERT INTO detector_runs (org_id, detector_id, trace_id, identified, judge_model)
      VALUES (${orgId}, ${detectorRow?.id ?? null}, ${traceId}, false, ${judgeModel})
    `;
    return null;
  }

  const id = uuidv7();
  await fastify.pg`
    INSERT INTO trace_findings (id, trace_id, org_id, detector, detector_id, title, severity, confidence, summary, triggered_span_id, judge_model)
    VALUES (${id}, ${traceId}, ${orgId}, ${verdict.detector}, ${detectorRow?.id ?? null}, ${verdict.title}, ${verdict.severity},
            ${verdict.confidence}, ${verdict.summary}, ${verdict.triggeredSpanId}, ${judgeModel})
  `;
  await fastify.pg`
    INSERT INTO detector_runs (org_id, detector_id, trace_id, identified, finding_id, judge_model)
    VALUES (${orgId}, ${detectorRow?.id ?? null}, ${traceId}, true, ${id}, ${judgeModel})
  `;

  if (config.ENABLE_SLACK_NOTIFICATIONS && config.SLACK_INCIDENT_CHANNEL) {
    void notifySlackChannel(
      config.SLACK_INCIDENT_CHANNEL,
      `:rotating_light: Causal detector — *${verdict.title}* in \`${trace.service}\` (${Math.round(verdict.confidence * 100)}% · ${LABEL[verdict.detector]})`
    ).catch((err) => fastify.log.warn({ err }, "slack alert failed"));
  }

  if (config.ENABLE_AUTO_RCA) {
    setImmediate(async () => {
      try {
        const { runRca } = await import("./rca.js");
        await runRca(fastify, orgId, traceId);
      } catch (err) {
        fastify.log.error({ err, traceId }, "auto-RCA failed");
      }
    });
  }

  return { findingId: id, ...verdict };
}
