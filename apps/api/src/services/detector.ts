import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
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
}
interface TraceView {
  traceId: string;
  service: string;
  title: string | null;
  spans: SpanView[];
}

interface Verdict {
  identified: boolean;
  detector: DetectorType;
  severity: "critical" | "high" | "medium";
  confidence: number;
  title: string;
  summary: string;
  triggeredSpanId: string;
}

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
  const spanLines = trace.spans
    .map((s) => `- ${s.name} [${s.kind}] status=${s.status}${s.error ? ` error="${s.error}"` : ""}${s.git ? ` @${s.git.file}:${s.git.line}` : ""} (id=${s.id})`)
    .join("\n");
  const prompt = `You are a production monitoring judge analyzing one AI-agent trace. Decide if it exhibits a problem in one of these classes: hallucination, tool_failure, intent_drift, safety. If it looks healthy, set identified=false.\n\nService: ${trace.service}\nSpans:\n${spanLines}\n\nRespond with ONLY a JSON object: {"identified": boolean, "detector": one of the classes, "severity": "critical"|"high"|"medium", "confidence": 0..1, "title": short string, "summary": one sentence, "triggeredSpanId": the failing span id}.`;
  const res = await anthropic.messages.create({
    model: config.DETECTOR_MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") return null;
  const match = text.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const v = JSON.parse(match[0]) as Verdict;
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
  if (!errSpan && !warnSpan) return null; // healthy trace — nothing to flag

  let verdict: Verdict | null = null;
  if (anthropic) {
    try {
      verdict = await judgeWithLlm(trace);
    } catch (err) {
      fastify.log.warn({ err, traceId }, "LLM judge failed — falling back to heuristic");
    }
  }
  if (!verdict) verdict = heuristicVerdict(errSpan, warnSpan);
  if (!verdict || !verdict.identified) return null;

  const id = uuidv7();
  await fastify.pg`
    INSERT INTO trace_findings (id, trace_id, org_id, detector, title, severity, confidence, summary, triggered_span_id, judge_model)
    VALUES (${id}, ${traceId}, ${orgId}, ${verdict.detector}, ${verdict.title}, ${verdict.severity},
            ${verdict.confidence}, ${verdict.summary}, ${verdict.triggeredSpanId}, ${anthropic ? config.DETECTOR_MODEL : "heuristic"})
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
