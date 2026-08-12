import type { FastifyInstance } from "fastify";
import { Anthropic } from "@anthropic-ai/sdk";
import { getTrace } from "./traces.js";
import { openFixPr, type PrResult } from "./github-pr.js";
import { config } from "../config.js";

const IS_DEMO = !config.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY.startsWith("sk-ant-...");
let anthropic: Anthropic | null = null;
if (!IS_DEMO) anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

interface SpanView {
  id: string;
  name: string;
  kind: string;
  status: string;
  error?: string | null;
  git?: { file: string; line: number; commit: string } | null;
}
interface FindingView {
  detector: string;
  title: string;
  severity: string;
  confidence: number;
  summary: string | null;
  triggeredSpanId: string | null;
}
interface TraceView {
  traceId: string;
  service: string;
  title: string | null;
  spans: SpanView[];
  finding: FindingView | null;
}

interface DiffLine { kind: "add" | "del" | "ctx" | "meta"; text: string }

interface RcaResult {
  summary: string;
  commit: string | null;
  file: string | null;
  line: number | null;
  explanation: string;
  counterfactual: string;
  confidence: number;
  hopsUpstream: number;
  fixTitle: string;
  fixDescription: string;
  fixDiff: DiffLine[];
}

function heuristicRca(trace: TraceView, span: SpanView): RcaResult {
  const git = span.git ?? null;
  const where = git ? `${git.file}:${git.line}` : span.name;
  return {
    summary: trace.finding?.title ?? `Failure in ${span.name}`,
    commit: git?.commit ?? null,
    file: git?.file ?? null,
    line: git?.line ?? null,
    explanation: `\`${span.name}\` returned ${span.status}: ${span.error ?? trace.finding?.summary ?? "unhandled failure"}. The origin is ${where}${git ? ` (commit ${git.commit})` : ""}, on the critical path of the run.`,
    counterfactual: `If ${where} handled this case with a safe default, the run would have completed and the incident would not have occurred.`,
    confidence: trace.finding?.confidence ?? 0.85,
    hopsUpstream: 1,
    fixTitle: `fix(${trace.service}): guard ${span.name}`,
    fixDescription: `Add a safe default at ${where} so the failure degrades gracefully instead of raising. (Proposed from the trace + git context; open in a sandbox to generate the exact diff.)`,
    fixDiff: git
      ? [
          { kind: "meta", text: `@@ ${git.file}:${git.line} @@` },
          { kind: "del", text: `    # failing call — no guard` },
          { kind: "add", text: `    # guard the failing path with a safe default` },
        ]
      : [{ kind: "meta", text: "proposed fix — no git context on the failing span" }],
  };
}

async function rcaWithLlm(trace: TraceView, span: SpanView): Promise<RcaResult | null> {
  if (!anthropic) return null;
  const git = span.git ?? null;
  const prompt = `You are an SRE agent doing root-cause analysis on an AI-agent failure.\n\nService: ${trace.service}\nDetector: ${trace.finding?.title ?? "failure"}\nFailing span: ${span.name} [${span.kind}] status=${span.status} error="${span.error ?? ""}"${git ? ` at ${git.file}:${git.line} (commit ${git.commit})` : ""}\n\nProduce ONLY a JSON object: {"summary": short root-cause, "explanation": 2-3 sentences, "counterfactual": one "if X, this wouldn't have happened" sentence, "confidence": 0..1, "fixTitle": conventional-commit style, "fixDescription": what the fix does, "fixDiff": array of {"kind":"add"|"del"|"ctx"|"meta","text":...} showing a minimal patch}.`;
  const res = await anthropic.messages.create({
    model: config.RCA_MODEL,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") return null;
  const match = text.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const parsed = JSON.parse(match[0]) as Partial<RcaResult>;
  return {
    summary: parsed.summary ?? trace.finding?.title ?? "Root cause",
    commit: git?.commit ?? null,
    file: git?.file ?? null,
    line: git?.line ?? null,
    explanation: parsed.explanation ?? "",
    counterfactual: parsed.counterfactual ?? "",
    confidence: parsed.confidence ?? trace.finding?.confidence ?? 0.85,
    hopsUpstream: 1,
    fixTitle: parsed.fixTitle ?? `fix(${trace.service}): guard ${span.name}`,
    fixDescription: parsed.fixDescription ?? "",
    fixDiff: Array.isArray(parsed.fixDiff) ? parsed.fixDiff : [],
  };
}

/**
 * Run RCA for a trace's latest finding. Produces a root cause + proposed fix and
 * stores an rca_runs row. Opening a real GitHub PR requires a repo→installation
 * mapping (not wired here), so the fix is stored as `proposed`.
 */
export async function runRca(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const trace = (await getTrace(fastify, orgId, traceId)) as unknown as TraceView | null;
  if (!trace) return null;

  const findingRows = (await fastify.pg`
    SELECT id FROM trace_findings WHERE trace_id = ${traceId} AND org_id = ${orgId} ORDER BY created_at DESC LIMIT 1
  `) as Array<{ id: string }>;
  const findingId = findingRows[0]?.id ?? null;

  const span =
    trace.spans.find((s) => s.id === trace.finding?.triggeredSpanId) ??
    trace.spans.find((s) => s.status === "error") ??
    trace.spans.find((s) => s.status === "warn");
  if (!span) return null;

  let rca: RcaResult | null = null;
  if (anthropic) {
    try {
      rca = await rcaWithLlm(trace, span);
    } catch (err) {
      fastify.log.warn({ err, traceId }, "LLM RCA failed — falling back to heuristic");
    }
  }
  if (!rca) rca = heuristicRca(trace, span);

  const rows = (await fastify.pg`
    INSERT INTO rca_runs (
      trace_id, finding_id, org_id, status, summary, commit_sha, file, line,
      explanation, counterfactual, confidence, hops_upstream,
      fix_title, fix_description, fix_diff, pr_status, model
    ) VALUES (
      ${traceId}, ${findingId}, ${orgId}, 'complete', ${rca.summary}, ${rca.commit}, ${rca.file}, ${rca.line},
      ${rca.explanation}, ${rca.counterfactual}, ${rca.confidence}, ${rca.hopsUpstream},
      ${rca.fixTitle}, ${rca.fixDescription}, ${fastify.pg.json(rca.fixDiff as unknown as Parameters<typeof fastify.pg.json>[0])}, 'proposed', ${anthropic ? config.RCA_MODEL : "heuristic"}
    )
    RETURNING id
  `) as Array<{ id: string }>;
  const rcaId = rows[0]?.id;

  // Attempt to open a real fix PR (no-op unless a GitHub App + repo mapping
  // exist); persist the outcome on the run.
  let pr: PrResult = { prStatus: "proposed" };
  if (rcaId) {
    pr = await openFixPr(fastify, orgId, {
      id: rcaId,
      summary: rca.summary,
      explanation: rca.explanation,
      counterfactual: rca.counterfactual,
      file: rca.file,
      fixTitle: rca.fixTitle,
      fixDescription: rca.fixDescription,
    });
    if (pr.prStatus === "opened") {
      await fastify.pg`
        UPDATE rca_runs SET pr_status = ${pr.prStatus}, pr_url = ${pr.prUrl ?? null}, pr_number = ${pr.prNumber ?? null}
        WHERE id = ${rcaId}
      `;
    }
  }

  return { rcaId, ...rca, prStatus: pr.prStatus, prUrl: pr.prUrl, prNumber: pr.prNumber };
}

/** Fetch the latest RCA run for a trace. */
export async function getRca(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const rows = (await fastify.pg`
    SELECT id, status, summary, commit_sha, file, line, explanation, counterfactual, confidence, hops_upstream,
           fix_title, fix_description, fix_diff, pr_status, pr_url, pr_number, model, created_at
    FROM rca_runs WHERE trace_id = ${traceId} AND org_id = ${orgId} ORDER BY created_at DESC LIMIT 1
  `) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r["id"],
    status: r["status"],
    summary: r["summary"],
    commit: r["commit_sha"],
    file: r["file"],
    line: r["line"] === null ? null : Number(r["line"]),
    explanation: r["explanation"],
    counterfactual: r["counterfactual"],
    confidence: Number(r["confidence"]),
    hopsUpstream: Number(r["hops_upstream"]),
    fixTitle: r["fix_title"],
    fixDescription: r["fix_description"],
    fixDiff: r["fix_diff"] ?? [],
    prStatus: r["pr_status"],
    prUrl: r["pr_url"],
    prNumber: r["pr_number"] === null ? null : Number(r["pr_number"]),
    model: r["model"],
    createdAt: r["created_at"],
  };
}
