import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getDatasetMeta, listAllDatasetItems, spanSignature, isDiscriminatingSignature, type DatasetItem,
} from "./datasets.js";
import { complete, resolveForPurpose } from "./llm.js";

/**
 * Offline evals — the half of the loop that proves a fix actually worked.
 *
 * A dataset item says "this input used to produce this failure, and here is what
 * correct looks like". An eval run re-judges every item against CURRENT
 * behaviour and scores the dataset. Two judges:
 *
 *   * deterministic (always available): recompute each recent production span's
 *     failure signature and check whether the item's signature has come back
 *     since the item was promoted. No model, no API key, no ambiguity.
 *   * LLM (when the workspace has a provider configured): reads the same
 *     evidence plus the item's expectation, and can judge semantic failures —
 *     hallucination and intent drift — that no signature can catch.
 *
 * Hard evidence wins: if the signature demonstrably recurred, the item fails
 * regardless of what the model thinks.
 *
 * Which judge ran is recorded per item and per run. Falling back to the
 * signature check is a real weakening of a release gate, so it is never
 * implied — it is written down.
 */

// The judge is the same class of task as the detector, so it resolves through
// that purpose rather than introducing a setting nothing else knows about.
const JUDGE_PURPOSE = "detector" as const;
const DETERMINISTIC_JUDGE = "deterministic";

/** How far back production traffic is considered "current" behaviour. */
const EVIDENCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Cap on spans pulled for evidence — an eval must never scan the whole store. */
const EVIDENCE_SPAN_LIMIT = 4000;
/** Concurrent judgements per run. */
const JUDGE_CONCURRENCY = 4;

/**
 * The model's verdict is untrusted: a score of 85 or a missing field would break
 * the 0..1 CHECK on eval_results. Validate and clamp before it reaches Postgres.
 */
const JudgementSchema = z.object({
  // z.coerce.boolean() turns the string "false" into true, so a model that
  // quotes its booleans would invert every verdict. Parse it properly.
  passed: z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") return ["true", "yes", "pass", "passed", "1"].includes(v.trim().toLowerCase());
    return false;
  }, z.boolean()),
  score: z.coerce
    .number()
    .catch(0)
    .transform((n) => {
      if (!Number.isFinite(n)) return 0;
      const v = n > 1 ? n / 100 : n;
      return Math.max(0, Math.min(1, v));
    }),
  reason: z.string().max(2000).default(""),
});
type Judgement = z.infer<typeof JudgementSchema>;

interface Occurrence {
  traceId: string;
  spanId: string;
  name: string;
  kind: string;
  status: string;
  error: string | null;
  output: string | null;
  service: string;
  seenAt: Date;
}
interface Bucket {
  count: number;
  /** Most recent first (the evidence query is ordered DESC). */
  recent: Occurrence[];
}
interface Evidence {
  since: Date;
  spansScanned: number;
  bySignature: Map<string, Bucket>;
  byName: Map<string, Bucket>;
}
interface ItemEvidence {
  signature: string | null;
  discriminating: boolean;
  recurred: boolean;
  recurrences: Occurrence[];
  exercised: number;
  latest: Occurrence | null;
}

interface SpanEvidenceRow {
  trace_id: string;
  span_id: string;
  name: string;
  kind: string;
  status: string;
  error: string | null;
  io: { input?: string; output?: string } | null;
  service: string;
  started_at: Date;
}

export interface EvalResultView {
  id: string;
  datasetItemId: string | null;
  passed: boolean;
  score: number;
  actual: Record<string, unknown> | null;
  reason: string | null;
  /** Which named expectation held, and on what evidence. */
  assertionResults: AssertionResult[];
  latencyMs: number | null;
  /** null when no price backs the judged tokens — see `costOrNull`. */
  costUsd: number | null;
  /** Movement against the previous complete run: fixed | regressed | unchanged. */
  delta: "fixed" | "regressed" | "unchanged";
  spanSignature?: string | null;
  title?: string | null;
  notes?: string | null;
  traceId?: string | null;
  findingId?: string | null;
  createdAt?: unknown;
}

export interface EvalRunView {
  id: string;
  datasetId: string;
  datasetName?: string | null;
  name: string | null;
  status: string;
  model: string | null;
  judgeModel: string | null;
  /** The release this run gated — what makes two runs comparable. */
  release: string | null;
  commit: string | null;
  /** null when no price backs the judged tokens — see `costOrNull`. */
  costUsd: number | null;
  total: number;
  passed: number;
  failed: number;
  score: number;
  startedAt: unknown;
  finishedAt: unknown;
  results?: EvalResultView[];
}

function json(sql: FastifyInstance["pg"], value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * `cost_usd` is NOT NULL DEFAULT 0 in the schema and nothing here prices a
 * token — there is no price table to price it against. A stored 0 therefore
 * means "not measured", not "free", so report it as null: rendering $0.0000 as
 * a measurement is exactly the unfounded claim this product exists to kill.
 */
function costOrNull(value: unknown): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function failingSpanName(item: DatasetItem): string | null {
  const failing = item.input["failingSpan"] as { name?: unknown } | null | undefined;
  const name = failing?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

// ── Evidence ─────────────────────────────────────────────────────────

/**
 * Pull recent production spans once per run and index them by failure signature
 * and by span name. One query serves every item in the dataset.
 */
async function collectEvidence(fastify: FastifyInstance, orgId: string, items: DatasetItem[]): Promise<Evidence> {
  const now = Date.now();
  const earliestItem = items.reduce((min, i) => {
    const ms = toMs(i.createdAt);
    return ms > 0 && ms < min ? ms : min;
  }, now);
  const since = new Date(Math.max(earliestItem, now - EVIDENCE_WINDOW_MS));

  const rows = (await fastify.pg`
    SELECT s.trace_id, s.id AS span_id, s.name, s.kind, s.status, s.error, s.io,
           t.service, t.started_at
    FROM spans s
    JOIN traces t ON t.org_id = s.org_id AND t.id = s.trace_id
    WHERE s.org_id = ${orgId} AND t.started_at >= ${since}
    ORDER BY t.started_at DESC
    LIMIT ${EVIDENCE_SPAN_LIMIT}
  `) as SpanEvidenceRow[];

  const bySignature = new Map<string, Bucket>();
  const byName = new Map<string, Bucket>();

  const push = (map: Map<string, Bucket>, key: string, occ: Occurrence) => {
    const bucket = map.get(key) ?? { count: 0, recent: [] };
    bucket.count += 1;
    if (bucket.recent.length < 5) bucket.recent.push(occ);
    map.set(key, bucket);
  };

  for (const r of rows) {
    const occ: Occurrence = {
      traceId: r.trace_id,
      spanId: r.span_id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      error: r.error,
      output: clip(r.io?.output ?? null, 600),
      service: r.service,
      seenAt: r.started_at instanceof Date ? r.started_at : new Date(toMs(r.started_at)),
    };
    push(bySignature, spanSignature(r), occ);
    push(byName, r.name, occ);
  }

  return { since, spansScanned: rows.length, bySignature, byName };
}

/** Narrow the run-wide evidence down to one golden item. */
function evidenceForItem(item: DatasetItem, ev: Evidence): ItemEvidence {
  const signature = item.spanSignature;
  const discriminating = isDiscriminatingSignature(signature);
  const promotedAt = toMs(item.createdAt);

  const sigBucket = signature ? ev.bySignature.get(signature) : undefined;
  // Only occurrences AFTER the case was promoted count as a regression — the
  // original failure is in the window by construction.
  const recurrences = (sigBucket?.recent ?? []).filter((o) => o.seenAt.getTime() > promotedAt);

  const name = failingSpanName(item);
  const nameBucket = name ? ev.byName.get(name) : undefined;
  const exercisedRecent = (nameBucket?.recent ?? []).filter((o) => o.seenAt.getTime() > promotedAt);

  return {
    signature,
    discriminating,
    recurred: discriminating && recurrences.length > 0,
    recurrences,
    exercised: exercisedRecent.length,
    latest: exercisedRecent[0] ?? null,
  };
}

// ── Judges ───────────────────────────────────────────────────────────

/** No-API-key path: pure signature reasoning over real production spans. */
function deterministicJudgement(ev: ItemEvidence, spanName: string | null): Judgement {
  if (ev.recurred) {
    const hit = ev.recurrences[0]!;
    return {
      passed: false,
      score: 0,
      reason: `Regression: failure signature \`${ev.signature}\` reappeared ${ev.recurrences.length} time(s) since this case was promoted — most recently in trace ${hit.traceId} (${hit.seenAt.toISOString()})${hit.error ? `: ${clip(hit.error, 200)}` : ""}.`,
    };
  }
  if (!ev.discriminating) {
    return {
      passed: true,
      score: 0.5,
      // A hallucination/intent-drift case: the span returned ok, so no signature
      // can separate a good run from a bad one. Honest partial credit.
      reason: `Unverified: this case's failing step returns \`ok\` (a semantic failure), so the signature check cannot discriminate. Configure an LLM judge to score it properly.`,
    };
  }
  if (ev.exercised > 0) {
    return {
      passed: true,
      score: 1,
      reason: `Fix holds: \`${spanName ?? "the failing step"}\` ran ${ev.exercised} time(s) in production since this case was promoted and never produced \`${ev.signature}\` again.`,
    };
  }
  return {
    passed: true,
    score: 0.5,
    reason: `Unverified: no production traffic has exercised \`${spanName ?? "this path"}\` since the case was promoted, so the fix is unproven rather than broken.`,
  };
}

// ── Assertions ───────────────────────────────────────────────────────

export interface AssertionResult {
  id: string;
  passed: boolean;
  detail: string;
}

/**
 * Check each assertion against the production evidence we collected.
 *
 * This is deliberately conservative. Some assertion kinds (`must_contain`,
 * `no_unsourced_number`) are claims about the agent's OUTPUT TEXT, which this
 * evaluator does not re-generate — it reasons over spans that already ran. For
 * those we check what the spans can actually support and say so in the detail,
 * rather than inventing a verdict. An assertion we cannot check is reported as
 * passing-with-an-explanation, never as a silent pass: a green tick with no
 * detail behind it is exactly the kind of claim this product exists to kill.
 */
function evaluateAssertions(item: DatasetItem, ev: ItemEvidence): AssertionResult[] {
  const spanName = failingSpanName(item);
  const target = (a: { target: string }) => clip(a.target, 160) ?? a.target;

  return item.assertions.map((a): AssertionResult => {
    switch (a.kind) {
      case "must_not_raise": {
        if (ev.recurred) {
          const hit = ev.recurrences[0]!;
          return {
            id: a.id,
            passed: false,
            detail: `\`${ev.signature}\` raised again in trace ${hit.traceId}${hit.error ? ` — ${clip(hit.error, 160)}` : ""}`,
          };
        }
        if (ev.exercised > 0) {
          return { id: a.id, passed: true, detail: `${ev.exercised} production run(s) of \`${spanName ?? "this step"}\`, 0 raised` };
        }
        return { id: a.id, passed: true, detail: `unproven: no traffic has exercised \`${spanName ?? "this path"}\` since promotion` };
      }

      case "must_call_tool": {
        if (ev.exercised > 0) {
          return { id: a.id, passed: true, detail: `\`${spanName ?? target(a)}\` present in ${ev.exercised} run(s)` };
        }
        return { id: a.id, passed: true, detail: `unproven: \`${target(a)}\` not seen in the evidence window` };
      }

      case "latency_under_ms": {
        // The budget is the numeric part of the target, wherever it sits.
        const budget = Number(a.target.match(/(\d[\d_]*)\s*(?:ms)?\s*$/)?.[1]?.replace(/_/g, ""));
        if (!Number.isFinite(budget)) {
          return { id: a.id, passed: true, detail: `unchecked: no numeric budget in \`${target(a)}\`` };
        }
        return { id: a.id, passed: true, detail: `unproven: span durations are not part of the recurrence evidence (budget ${budget}ms)` };
      }

      case "must_not_contain":
      case "must_contain":
      case "must_confirm":
      case "cost_under_usd":
      case "no_unsourced_number":
        return {
          id: a.id,
          passed: !ev.recurred,
          detail: ev.recurred
            ? `not evaluated on its own terms — the case regressed on signature \`${ev.signature}\`, so the run failed before this could hold`
            : `unproven: \`${a.kind}\` is a claim about output text, which the signature evaluator does not re-generate`,
        };
    }
  });
}

function buildJudgePrompt(item: DatasetItem, ev: ItemEvidence): string {
  const input = item.input;
  const expected = item.expected;
  const failing = input["failingSpan"] as Record<string, unknown> | null | undefined;

  const contextLines = Array.isArray(input["context"])
    ? (input["context"] as Array<Record<string, unknown>>)
        .slice(0, 25)
        .map((s) => `  - ${String(s["name"])} [${String(s["kind"])}] ${String(s["status"])}${s["error"] ? ` error="${String(s["error"])}"` : ""}`)
        .join("\n")
    : "  (not recorded)";

  const evidenceLines = ev.recurrences.length
    ? ev.recurrences
        .map((o) => `  - RECURRED in trace ${o.traceId} at ${o.seenAt.toISOString()} — ${o.name} [${o.kind}] ${o.status}${o.error ? ` error="${clip(o.error, 300)}"` : ""}`)
        .join("\n")
    : ev.latest
      ? `  - ${ev.exercised} run(s) of \`${ev.latest.name}\` since promotion, most recent trace ${ev.latest.traceId} at ${ev.latest.seenAt.toISOString()} — status ${ev.latest.status}${ev.latest.error ? ` error="${clip(ev.latest.error, 300)}"` : ""}${ev.latest.output ? `\n    output: ${ev.latest.output}` : ""}`
      : "  - no production runs have exercised this path since the case was promoted";

  return `You are an offline evaluation judge for an AI-agent observability product. You are scoring ONE golden case that was promoted from a real production failure. Decide whether CURRENT behaviour satisfies the expectation.

GOLDEN CASE
  request: ${clip(String(input["request"] ?? ""), 1500) || "(not recorded)"}
  service: ${String(input["service"] ?? "unknown")}
  original failing step: ${failing ? `${String(failing["name"])} [${String(failing["kind"])}] status=${String(failing["status"])}${failing["error"] ? ` error="${clip(String(failing["error"]), 400)}"` : ""}` : "(not recorded)"}
  original run:
${contextLines}

EXPECTATION (what correct looks like)
  ${String(expected["behaviour"] ?? "the run must complete without the failure above")}
  detector: ${String(expected["detector"] ?? "unknown")}
  failure signature that must not recur: ${item.spanSignature ?? "(none)"}

CURRENT PRODUCTION EVIDENCE (since the case was promoted, ${ev.exercised} matching run(s)):
${evidenceLines}

Scoring rules:
- If the signature recurred, the case FAILS with score 0.
- If the path ran cleanly and the expectation is satisfied, it PASSES with a high score.
- If nothing exercised the path, it is UNPROVEN, not broken: pass with a score near 0.5 and say so.
- Judge only from the evidence above. Do not invent traces, errors, or outputs.

Respond with ONLY a JSON object: {"passed": boolean, "score": number between 0 and 1, "reason": one or two sentences citing the evidence}.`;
}

interface LlmJudgement {
  judgement: Judgement;
  /** The model that ACTUALLY answered — with BYOK it is not a config default. */
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Ask the workspace's own provider to judge one case. Returns null when no
 * provider is reachable or the answer is unusable, which drops that item to the
 * signature check — a real loss of coverage the caller records rather than hides.
 */
async function judgeWithLlm(
  fastify: FastifyInstance,
  orgId: string,
  item: DatasetItem,
  ev: ItemEvidence
): Promise<LlmJudgement | null> {
  const res = await complete({
    fastify,
    orgId,
    purpose: JUDGE_PURPOSE,
    maxTokens: 500,
    messages: [{ role: "user", content: buildJudgePrompt(item, ev) }],
  });
  if (!res) return null;
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(match[0]);
  } catch {
    return null; // a judge that returns prose instead of JSON must not fail the run
  }
  const parsed = JudgementSchema.safeParse(parsedJson);
  if (!parsed.success) return null;
  return { judgement: parsed.data, model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
}

// ── Run ──────────────────────────────────────────────────────────────

interface PendingResult {
  eval_run_id: string;
  org_id: string;
  dataset_item_id: string;
  passed: boolean;
  score: number;
  actual: ReturnType<typeof json>;
  reason: string;
  assertion_results: ReturnType<typeof json>;
  latency_ms: number;
  delta: "fixed" | "regressed" | "unchanged";
}

/**
 * What actually judged the run. A gate that names a model when half its cases
 * fell back to the signature check reports coverage it did not have, so a mixed
 * run says so — with the split.
 */
function describeJudges(counts: Map<string, number>, fallback: string): string {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return fallback;
  if (entries.length === 1) return entries[0]![0];
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return entries.map(([judge, n]) => `${judge} (${n}/${total})`).join(" + ").slice(0, 200);
}

/**
 * How each case did in the PREVIOUS run of this dataset, so a verdict can be
 * reported as movement rather than as a bare state.
 *
 * The previous run is the newest COMPLETE one — a failed or still-running run
 * is not a baseline, and comparing against it would report phantom regressions.
 */
async function previousVerdicts(
  fastify: FastifyInstance,
  orgId: string,
  datasetId: string,
  currentRunId: string
): Promise<Map<string, boolean>> {
  const rows = (await fastify.pg`
    SELECT res.dataset_item_id, res.passed
    FROM eval_results res
    WHERE res.eval_run_id = (
      SELECT id FROM eval_runs
      WHERE dataset_id = ${datasetId} AND org_id = ${orgId}
        AND status = 'complete' AND id <> ${currentRunId}
      ORDER BY started_at DESC
      LIMIT 1
    )
      AND res.org_id = ${orgId}
      AND res.dataset_item_id IS NOT NULL
  `) as Array<{ dataset_item_id: string; passed: boolean }>;
  return new Map(rows.map((r) => [r.dataset_item_id, r.passed]));
}

/**
 * Run every item in a dataset and record the verdicts. Always completes the
 * eval_runs row — a judge blowing up marks the run `failed` rather than leaving
 * it stuck in `running`.
 */
export async function runEval(
  fastify: FastifyInstance,
  orgId: string,
  opts: { datasetId: string; name?: string | null; release?: string | null; commit?: string | null }
): Promise<EvalRunView | null> {
  const sql = fastify.pg;
  const dataset = await getDatasetMeta(fastify, orgId, opts.datasetId);
  if (!dataset) return null;

  // Every case, not the newest page of them: a run that judges 500 of 900 cases
  // and reports 'complete' is a green gate over unjudged regressions.
  const items = await listAllDatasetItems(fastify, orgId, dataset.id);
  const name = (opts.name ?? `${dataset.name} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`).slice(0, 200);

  // The judge this workspace would use, resolved before any item runs so a
  // still-running run names its judge. Corrected below to whatever answered.
  const planned = await resolveForPurpose(fastify, orgId, JUDGE_PURPOSE);
  const plannedJudge = planned?.model ?? DETERMINISTIC_JUDGE;
  if (!planned) {
    fastify.log.warn(
      { orgId, datasetId: dataset.id, items: items.length },
      "no LLM provider reachable — this run scores on signature recurrence only, so semantic failures go unjudged"
    );
  }
  const release = clip(opts.release ?? null, 120);
  const commit = clip(opts.commit ?? null, 40);

  const runRows = (await sql`
    INSERT INTO eval_runs (org_id, dataset_id, name, status, model, judge_model, release, commit_sha, total)
    VALUES (${orgId}, ${dataset.id}, ${name}, 'running', ${plannedJudge}, ${plannedJudge}, ${release}, ${commit}, ${items.length})
    RETURNING id, started_at
  `) as Array<{ id: string; started_at: Date }>;
  const run = runRows[0]!;

  // Judge → items it decided. Declared outside the try so a run that blows up
  // half way still reports what had judged it, rather than the plan.
  const judgedBy = new Map<string, number>();

  try {
    const evidence = items.length ? await collectEvidence(fastify, orgId, items) : null;
    const before = await previousVerdicts(fastify, orgId, dataset.id, run.id);

    const judgeOne = async (item: DatasetItem): Promise<PendingResult> => {
      const startedAt = Date.now();
      const itemEv: ItemEvidence = evidence
        ? evidenceForItem(item, evidence)
        : { signature: item.spanSignature, discriminating: false, recurred: false, recurrences: [], exercised: 0, latest: null };
      const spanName = failingSpanName(item);

      let verdict: Judgement | null = null;
      let judge = DETERMINISTIC_JUDGE;
      let usage: { tokensIn: number; tokensOut: number } | null = null;
      if (planned) {
        try {
          const judged = await judgeWithLlm(fastify, orgId, item, itemEv);
          if (judged) {
            verdict = judged.judgement;
            judge = judged.model;
            usage = { tokensIn: judged.tokensIn, tokensOut: judged.tokensOut };
          } else {
            fastify.log.warn({ itemId: item.id, model: planned.model }, "LLM eval judge unavailable — falling back to signature check");
          }
        } catch (err) {
          fastify.log.warn({ err, itemId: item.id }, "LLM eval judge failed — falling back to signature check");
        }
      }
      if (!verdict) verdict = deterministicJudgement(itemEv, spanName);
      judgedBy.set(judge, (judgedBy.get(judge) ?? 0) + 1);

      // Hard evidence beats the model: if the exact failure signature came back,
      // the fix did not hold, whatever the judge wrote.
      if (itemEv.recurred && verdict.passed) {
        verdict = {
          passed: false,
          score: 0,
          reason: `Regression confirmed by signature \`${itemEv.signature}\` recurring in trace ${itemEv.recurrences[0]!.traceId}. Judge note: ${verdict.reason}`.slice(0, 2000),
        };
      }

      // An assertion that fails is a failure, whatever the judge concluded:
      // the case named an expectation and the evidence contradicts it.
      const assertions = evaluateAssertions(item, itemEv);
      const brokenAssertion = assertions.find((a) => !a.passed);
      if (brokenAssertion && verdict.passed) {
        verdict = {
          passed: false,
          score: 0,
          reason: `Assertion \`${brokenAssertion.id}\` failed: ${brokenAssertion.detail}. Judge note: ${verdict.reason}`.slice(0, 2000),
        };
      }

      // First-ever verdict for a case is `unchanged` — there is nothing to
      // compare against, and calling a new failure a regression would be a lie.
      const prior = before.get(item.id);
      const delta =
        prior === undefined || prior === verdict.passed
          ? "unchanged"
          : verdict.passed
            ? "fixed"
            : "regressed";

      return {
        eval_run_id: run.id,
        org_id: orgId,
        dataset_item_id: item.id,
        passed: verdict.passed,
        score: Number(verdict.score.toFixed(3)),
        assertion_results: json(sql, assertions),
        latency_ms: Date.now() - startedAt,
        delta,
        actual: json(sql, {
          signature: itemEv.signature,
          discriminating: itemEv.discriminating,
          recurred: itemEv.recurred,
          occurrences: itemEv.recurrences.length,
          exercised: itemEv.exercised,
          spansScanned: evidence?.spansScanned ?? 0,
          since: evidence?.since?.toISOString() ?? null,
          latest: itemEv.latest
            ? {
                traceId: itemEv.latest.traceId,
                spanId: itemEv.latest.spanId,
                status: itemEv.latest.status,
                error: clip(itemEv.latest.error, 500),
                seenAt: itemEv.latest.seenAt.toISOString(),
              }
            : null,
          judge,
          // The provider's own token counts. No price table exists to turn them
          // into money, so they are reported as tokens and cost stays unset.
          judgeTokensIn: usage?.tokensIn ?? null,
          judgeTokensOut: usage?.tokensOut ?? null,
        }),
        reason: verdict.reason.slice(0, 2000),
      };
    };

    // Bounded concurrency — a 200-item dataset must not open 200 LLM calls.
    const results: PendingResult[] = [];
    for (let i = 0; i < items.length; i += JUDGE_CONCURRENCY) {
      const batch = items.slice(i, i + JUDGE_CONCURRENCY);
      results.push(...(await Promise.all(batch.map(judgeOne))));
    }

    if (results.length > 0) {
      // cost_usd is left to its column default: nothing here can price a token,
      // and writing 0 would render as a measured $0.0000.
      await sql`
        INSERT INTO eval_results ${sql(
          results,
          "eval_run_id", "org_id", "dataset_item_id", "passed", "score",
          "actual", "reason", "assertion_results", "latency_ms", "delta"
        )}
      `;
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const score = results.length ? Number((results.reduce((a, r) => a + r.score, 0) / results.length).toFixed(3)) : 0;
    const judgeModel = describeJudges(judgedBy, plannedJudge);

    const finishedRows = (await sql`
      UPDATE eval_runs
      SET status = 'complete', total = ${results.length}, passed = ${passed}, failed = ${failed},
          score = ${score}, model = ${judgeModel}, judge_model = ${judgeModel}, finished_at = now()
      WHERE id = ${run.id} AND org_id = ${orgId}
      RETURNING finished_at
    `) as Array<{ finished_at: Date }>;

    // Read the run back so the caller gets the persisted rows (real result ids,
    // stored `actual` evidence) rather than a hand-assembled echo that could
    // drift from what's in the table.
    const persisted = await getEvalRun(fastify, orgId, run.id);
    if (persisted) return persisted;

    return {
      id: run.id,
      datasetId: dataset.id,
      datasetName: dataset.name,
      name,
      status: "complete",
      model: judgeModel,
      judgeModel,
      release,
      commit,
      costUsd: null,
      total: results.length,
      passed,
      failed,
      score,
      startedAt: run.started_at,
      finishedAt: finishedRows[0]?.finished_at ?? null,
      results: [],
    };
  } catch (err) {
    fastify.log.error({ err, datasetId: dataset.id, runId: run.id }, "eval run failed");
    // Never leave a run stuck in `running`.
    await sql`
      UPDATE eval_runs SET status = 'failed', finished_at = now() WHERE id = ${run.id} AND org_id = ${orgId}
    `.catch(() => undefined);
    const judgeModel = describeJudges(judgedBy, plannedJudge);
    return {
      id: run.id,
      datasetId: dataset.id,
      datasetName: dataset.name,
      name,
      status: "failed",
      model: judgeModel,
      judgeModel,
      release,
      commit,
      costUsd: null,
      total: items.length,
      passed: 0,
      failed: 0,
      score: 0,
      startedAt: run.started_at,
      finishedAt: new Date(),
      results: [],
    };
  }
}

// ── Reads ────────────────────────────────────────────────────────────

/** One eval run with every judged item. */
export async function getEvalRun(fastify: FastifyInstance, orgId: string, id: string): Promise<EvalRunView | null> {
  const rows = (await fastify.pg`
    SELECT r.id, r.dataset_id, r.name, r.status, r.model, r.judge_model, r.release, r.commit_sha,
           r.cost_usd, r.total, r.passed, r.failed, r.score,
           r.started_at, r.finished_at, d.name AS dataset_name
    FROM eval_runs r
    LEFT JOIN datasets d ON d.id = r.dataset_id AND d.org_id = r.org_id
    WHERE r.id = ${id} AND r.org_id = ${orgId}
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;

  const results = (await fastify.pg`
    SELECT e.id, e.dataset_item_id, e.passed, e.score, e.actual, e.reason, e.created_at,
           e.assertion_results, e.latency_ms, e.cost_usd, e.delta,
           i.span_signature, i.title, i.notes, i.trace_id, i.finding_id
    FROM eval_results e
    LEFT JOIN dataset_items i ON i.id = e.dataset_item_id AND i.org_id = e.org_id
    WHERE e.eval_run_id = ${id} AND e.org_id = ${orgId}
    ORDER BY e.created_at ASC, e.id ASC
    LIMIT 1000
  `) as Array<Record<string, unknown>>;

  return {
    id: r["id"] as string,
    datasetId: r["dataset_id"] as string,
    datasetName: (r["dataset_name"] as string | null) ?? null,
    name: (r["name"] as string | null) ?? null,
    status: r["status"] as string,
    model: (r["model"] as string | null) ?? null,
    judgeModel: (r["judge_model"] as string | null) ?? null,
    release: (r["release"] as string | null) ?? null,
    commit: (r["commit_sha"] as string | null) ?? null,
    costUsd: costOrNull(r["cost_usd"]),
    total: Number(r["total"]),
    passed: Number(r["passed"]),
    failed: Number(r["failed"]),
    score: Number(r["score"]),
    startedAt: r["started_at"],
    finishedAt: r["finished_at"],
    results: results.map((e) => ({
      id: e["id"] as string,
      datasetItemId: (e["dataset_item_id"] as string | null) ?? null,
      passed: e["passed"] === true,
      score: Number(e["score"]),
      actual: (e["actual"] as Record<string, unknown> | null) ?? null,
      reason: (e["reason"] as string | null) ?? null,
      assertionResults: Array.isArray(e["assertion_results"]) ? (e["assertion_results"] as AssertionResult[]) : [],
      latencyMs: e["latency_ms"] === null || e["latency_ms"] === undefined ? null : Number(e["latency_ms"]),
      costUsd: costOrNull(e["cost_usd"]),
      delta: (e["delta"] as EvalResultView["delta"]) ?? "unchanged",
      spanSignature: (e["span_signature"] as string | null) ?? null,
      title: (e["title"] as string | null) ?? null,
      notes: (e["notes"] as string | null) ?? null,
      traceId: (e["trace_id"] as string | null) ?? null,
      findingId: (e["finding_id"] as string | null) ?? null,
      createdAt: e["created_at"],
    })),
  };
}

/** Eval runs for an org, newest first — optionally filtered to one dataset. */
export async function listEvalRuns(
  fastify: FastifyInstance,
  orgId: string,
  datasetId?: string | null,
  limit = 100
): Promise<EvalRunView[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = (datasetId
    ? await fastify.pg`
        SELECT r.id, r.dataset_id, r.name, r.status, r.model, r.judge_model, r.release, r.commit_sha,
               r.cost_usd, r.total, r.passed, r.failed, r.score,
               r.started_at, r.finished_at, d.name AS dataset_name
        FROM eval_runs r
        LEFT JOIN datasets d ON d.id = r.dataset_id AND d.org_id = r.org_id
        WHERE r.org_id = ${orgId} AND r.dataset_id = ${datasetId}
        ORDER BY r.started_at DESC
        LIMIT ${capped}
      `
    : await fastify.pg`
        SELECT r.id, r.dataset_id, r.name, r.status, r.model, r.judge_model, r.release, r.commit_sha,
               r.cost_usd, r.total, r.passed, r.failed, r.score,
               r.started_at, r.finished_at, d.name AS dataset_name
        FROM eval_runs r
        LEFT JOIN datasets d ON d.id = r.dataset_id AND d.org_id = r.org_id
        WHERE r.org_id = ${orgId}
        ORDER BY r.started_at DESC
        LIMIT ${capped}
      `) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r["id"] as string,
    datasetId: r["dataset_id"] as string,
    datasetName: (r["dataset_name"] as string | null) ?? null,
    name: (r["name"] as string | null) ?? null,
    status: r["status"] as string,
    model: (r["model"] as string | null) ?? null,
    judgeModel: (r["judge_model"] as string | null) ?? null,
    release: (r["release"] as string | null) ?? null,
    commit: (r["commit_sha"] as string | null) ?? null,
    costUsd: costOrNull(r["cost_usd"]),
    total: Number(r["total"]),
    passed: Number(r["passed"]),
    failed: Number(r["failed"]),
    score: Number(r["score"]),
    startedAt: r["started_at"],
    finishedAt: r["finished_at"],
  }));
}
