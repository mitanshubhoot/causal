import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { complete } from "./llm.js";
import { getTrace } from "./traces.js";
import { notifySlackChannel } from "./slack.js";
import { sendEmailAlert } from "./email.js";
import { config } from "../config.js";

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

/**
 * Score a trace with the workspace's configured judge model. Goes through the
 * BYOK layer, so an org running on OpenAI/Gemini/DeepSeek/etc uses ITS key and
 * model — previously this constructed Anthropic directly and silently ignored
 * every provider credential the customer had configured.
 *
 * Returns null when no provider is reachable, so the caller falls back to the
 * status-only heuristic.
 */
async function judgeWithLlm(
  fastify: FastifyInstance,
  orgId: string,
  trace: TraceView
): Promise<{ verdict: Verdict; model: string } | null> {
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
  const res = await complete({
    fastify,
    orgId,
    purpose: "detector",
    maxTokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  if (!res) return null;
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(match[0]);
  } catch {
    return null; // a model that returns prose instead of JSON must not throw
  }
  const parsed = VerdictSchema.safeParse(parsedJson);
  if (!parsed.success) return null;
  // The judge can name a span that doesn't exist — pin it to a real one.
  const v = parsed.data;
  if (!trace.spans.some((s) => s.id === v.triggeredSpanId)) {
    v.triggeredSpanId =
      trace.spans.find((s) => s.status === "error")?.id ?? trace.spans[0]?.id ?? "";
  }
  // Report the model that ACTUALLY judged, not a config default — with BYOK the
  // org may be running on any provider.
  return { verdict: v, model: res.model };
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
  let judgeModel = "heuristic";
  try {
    const judged = await judgeWithLlm(fastify, orgId, trace);
    if (judged) {
      verdict = judged.verdict;
      judgeModel = judged.model;
    }
  } catch (err) {
    fastify.log.warn({ err, traceId }, "LLM judge failed — falling back to heuristic");
  }
  // Without a reachable provider we can only reason from status, so a clean
  // trace stays clean.
  if (!verdict) verdict = heuristicVerdict(errSpan, warnSpan);
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

  // Alerts — Slack and/or email, whichever is configured.
  const alertedVia: string[] = [];
  if (config.ENABLE_SLACK_NOTIFICATIONS && config.SLACK_INCIDENT_CHANNEL) {
    alertedVia.push("slack");
    void notifySlackChannel(
      config.SLACK_INCIDENT_CHANNEL,
      `:rotating_light: Causal detector — *${verdict.title}* in \`${trace.service}\` (${Math.round(verdict.confidence * 100)}% · ${LABEL[verdict.detector]})`
    ).catch((err) => fastify.log.warn({ err }, "slack alert failed"));
  }
  if (config.ALERT_EMAIL_TO) {
    alertedVia.push("email");
    const failing = trace.spans.find((s) => s.id === verdict.triggeredSpanId);
    void sendEmailAlert(fastify, {
      severity: verdict.severity,
      subject: `[Causal] ${verdict.severity.toUpperCase()} — ${verdict.title}`,
      heading: verdict.title,
      body: verdict.summary,
      facts: [
        { label: "service", value: trace.service },
        { label: "detector", value: LABEL[verdict.detector] },
        { label: "confidence", value: `${Math.round(verdict.confidence * 100)}%` },
        { label: "trace", value: traceId },
        ...(failing?.name ? [{ label: "span", value: failing.name }] : []),
        ...(failing?.git ? [{ label: "origin", value: `${failing.git.file}:${failing.git.line} @ ${failing.git.commit}` }] : []),
      ],
      linkUrl: `${config.APP_URL}/incidents/${traceId}`,
      linkLabel: "Open the trace",
    }).catch((err) => fastify.log.warn({ err }, "email alert failed"));
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

  return { findingId: id, ...verdict, alertedVia };
}
