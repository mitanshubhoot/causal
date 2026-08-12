import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { complete } from "./llm.js";
import { getTrace } from "./traces.js";
import { openFixPr, type PrResult } from "./github-pr.js";
import { collectGitEvidence, type GitEvidence } from "./git-context.js";
// sandbox.ts / verify.ts are imported LAZILY inside runVerification. They pull
// in node:child_process and a large module graph that is only ever needed when
// SANDBOX_ENABLED is on, and this file sits on the serverless cold-start path —
// which is exactly what previously blew Vercel's function timeout.
import type { VerificationResult } from "./verify.js";
import { config } from "../config.js";

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

/**
 * The model's JSON is untrusted: a confidence of 95 overflows
 * confidence NUMERIC(4,3) and "high" is not a number at all. Either one raises
 * on the INSERT below, which discards the git evidence and the sandbox
 * verification along with it. Validate and clamp before anything reaches
 * Postgres; a field we cannot make sense of stays null so the caller's own
 * fallback applies rather than an invented number.
 */
const RcaJsonSchema = z.object({
  summary: z.string().optional(),
  explanation: z.string().optional(),
  counterfactual: z.string().optional(),
  // null/"" mean the model declined to score, and Number() would turn both into
  // a confident-looking 0 — leave it null so the caller's fallback applies.
  confidence: z
    .preprocess((v) => (v === null || v === "" ? undefined : v), z.coerce.number().catch(NaN))
    .transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) : null)),
  fixTitle: z.string().optional(),
  fixDescription: z.string().optional(),
  fixDiff: z
    .array(z.object({ kind: z.enum(["add", "del", "ctx", "meta"]).catch("ctx"), text: z.string() }))
    .catch([]),
});

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

async function rcaWithLlm(
  fastify: FastifyInstance,
  orgId: string,
  trace: TraceView,
  span: SpanView,
  evidence: GitEvidence
): Promise<{ rca: RcaResult; model: string } | null> {
  const git = span.git ?? null;

  // Give the model the actual code and commit — it used to see only a path and
  // a line number, which is not enough to root-cause anything.
  const codeBlock = evidence.snippet
    ? `\n\nSOURCE at ${evidence.snippet.file} (commit ${git?.commit ?? "HEAD"}):\n${evidence.snippet.lines
        .map((l) => `${l.marked ? ">>" : "  "} ${l.n}: ${l.text}`)
        .join("\n")}`
    : "";
  const commitBlock = evidence.commit
    ? `\n\nSUSPECT COMMIT ${evidence.commit.sha}\nauthor: ${evidence.commit.author}\ndate: ${evidence.commit.date}\nmessage: ${evidence.commit.message}\nfiles: ${(evidence.commit.files ?? []).map((f) => `${f.filename} (+${f.additions}/-${f.deletions})`).join(", ")}${
        (evidence.commit.files ?? [])
          .filter((f) => f.patch && git && f.filename === git.file)
          .map((f) => `\n\nPATCH for ${f.filename}:\n${f.patch}`)
          .join("")
      }`
    : "";

  // Ordered trace context so the model can distinguish origin from symptom.
  const spanBlock = trace.spans
    .map((s) => `- ${s.name} [${s.kind}] ${s.status}${s.error ? ` error="${s.error}"` : ""}${s.git ? ` @${s.git.file}:${s.git.line}` : ""}`)
    .join("\n");

  const prompt = `You are an SRE agent doing root-cause analysis on an AI-agent failure.

Service: ${trace.service}
Detector: ${trace.finding?.title ?? "failure"}
Failing span: ${span.name} [${span.kind}] status=${span.status} error="${span.error ?? ""}"${git ? ` at ${git.file}:${git.line} (commit ${git.commit})` : ""}

TRACE (in order — the earliest failure is usually the origin, later ones are symptoms):
${spanBlock}${codeBlock}${commitBlock}

Root-cause the EARLIEST failure, not the loudest downstream symptom. Base every claim on the evidence above.

Produce ONLY a JSON object: {"summary": short root-cause, "explanation": 2-3 sentences citing the code/commit, "counterfactual": one "if X, this wouldn't have happened" sentence, "confidence": 0..1, "fixTitle": conventional-commit style, "fixDescription": what the fix does, "fixDiff": array of {"kind":"add"|"del"|"ctx"|"meta","text":...} showing a minimal patch}.`;
  // Routed through the BYOK layer so the workspace's own provider answers.
  const res = await complete({
    fastify,
    orgId,
    purpose: "rca",
    maxTokens: 900,
    messages: [{ role: "user", content: prompt }],
  });
  if (!res) return null;
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(match[0]);
  } catch {
    return null; // prose instead of JSON must not throw
  }
  const validated = RcaJsonSchema.safeParse(parsedJson);
  if (!validated.success) return null;
  const parsed = validated.data;
  const built: RcaResult = {
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
    // Built explicitly rather than assigned from `parsed.fixDiff` directly.
    // Vercel's TypeScript analyzer runs with different strictness than this
    // tsconfig, and without strictNullChecks zod's inferred output type loses
    // required-ness — every key reads as optional, so the array no longer
    // satisfies DiffLine[] and the deploy fails on a build that passes here.
    // Constructing the shape makes the type independent of that inference.
    fixDiff: parsed.fixDiff.map((d) => ({ kind: d.kind ?? "ctx", text: d.text ?? "" })),
  };
  return { rca: built, model: res.model };
}

/**
 * Verify a proposed fix by running the repo's own test suite against it.
 *
 * Returns null when verification could not be attempted at all (sandbox
 * disabled, no repo mapping, no patch) — the caller must then NOT claim the fix
 * is verified. Never throws: a verification failure must not lose the RCA.
 */
async function runVerification(
  fastify: FastifyInstance,
  orgId: string,
  repoFullName: string | null,
  rca: RcaResult
): Promise<VerificationResult | null> {
  // Cheap gate first, so the heavy module graph is never loaded when the
  // feature is off (which is the default, and always the case on serverless).
  if (!config.SANDBOX_ENABLED || !repoFullName || !rca.file) return null;

  const [{ withSandbox, sandboxAvailable }, { verifyFix }] = await Promise.all([
    import("./sandbox.js"),
    import("./verify.js"),
  ]);
  if (!sandboxAvailable()) return null;

  const inst = (await fastify.pg`
    SELECT installation_id FROM github_installations WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1
  `.catch(() => [])) as Array<{ installation_id: string | number }>;
  const installationId = inst[0]?.installation_id;
  if (installationId == null) return null;

  try {
    return await withSandbox(
      {
        repoFullName,
        installationId: Number(installationId),
        ref: rca.commit ?? null,
        logger: fastify.log,
      },
      async (sandbox) => {
        // Establish a baseline first: if the suite is already red at this
        // commit, a green run after our patch proves nothing and a red one
        // isn't our fault.
        const baseline = await verifyFix({ sandbox, logger: fastify.log });
        if (!baseline.ran) return baseline;

        const patch = unifiedDiffFor(rca);
        if (!patch) return { ...baseline, ran: false, passed: false, reason: "no patch to apply" };

        const applied = await sandbox.applyPatch(patch);
        if (!applied.applied) {
          return { ...baseline, ran: false, passed: false, reason: `patch did not apply: ${applied.error ?? "unknown"}` };
        }
        const after = await verifyFix({ sandbox, logger: fastify.log });
        // Only a red→green transition is real evidence the fix works.
        if (baseline.passed && after.passed) return { ...after, reason: "suite was already green before the patch" };
        return after;
      }
    );
  } catch (err) {
    fastify.log.warn({ err, repoFullName }, "fix verification could not run");
    return null;
  }
}

/** Render our structured diff back to a unified patch git can apply. */
function unifiedDiffFor(rca: RcaResult): string | null {
  if (!rca.fixDiff?.length || !rca.file) return null;
  const body = rca.fixDiff
    .map((l) => (l.kind === "add" ? `+${l.text}` : l.kind === "del" ? `-${l.text}` : l.kind === "meta" ? l.text : ` ${l.text}`))
    .join("\n");
  if (!/^(---|\+\+\+|@@)/m.test(body)) return null; // no hunk header — not applicable
  return `${body}\n`;
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

  // Pull real git evidence (commit metadata + the source at the failing line)
  // before reasoning, so the model isn't guessing from a path and a line number.
  const traceRepo = (trace as unknown as { repo?: string }).repo ?? null;
  const evidence = await collectGitEvidence(
    fastify, orgId, traceRepo, span.git?.file ?? null, span.git?.line ?? null, span.git?.commit ?? null
  );

  let rca: RcaResult | null = null;
  let rcaModel = "heuristic";
  try {
    const analyzed = await rcaWithLlm(fastify, orgId, trace, span, evidence);
    if (analyzed) {
      rca = analyzed.rca;
      rcaModel = analyzed.model;
    }
  } catch (err) {
    fastify.log.warn({ err, traceId }, "LLM RCA failed — falling back to heuristic");
  }
  if (!rca) rca = heuristicRca(trace, span);
  // hopsUpstream was hardcoded to 1; use the real distance when we resolved it.
  if (evidence.resolved) rca.hopsUpstream = evidence.hopsUpstream;

  const rows = (await fastify.pg`
    INSERT INTO rca_runs (
      trace_id, finding_id, org_id, status, summary, commit_sha, file, line,
      explanation, counterfactual, confidence, hops_upstream,
      fix_title, fix_description, fix_diff, pr_status, model
    ) VALUES (
      ${traceId}, ${findingId}, ${orgId}, 'complete', ${rca.summary}, ${rca.commit}, ${rca.file}, ${rca.line},
      ${rca.explanation}, ${rca.counterfactual}, ${rca.confidence}, ${rca.hopsUpstream},
      ${rca.fixTitle}, ${rca.fixDescription}, ${fastify.pg.json(rca.fixDiff as unknown as Parameters<typeof fastify.pg.json>[0])}, 'proposed', ${rcaModel}
    )
    RETURNING id
  `) as Array<{ id: string }>;
  const rcaId = rows[0]?.id;

  // Attempt to open a real fix PR (no-op unless a GitHub App + repo mapping
  // exist); persist the outcome on the run.
  let pr: PrResult = { prStatus: "proposed" };
  if (rcaId) {
    // Actually verify the fix before we let anything call it verified: clone
    // the repo at the failing commit, apply the patch, and RUN the test suite.
    // Without this the check run can only ever be "neutral" — which is why
    // `verified` was false by construction.
    const verification = await runVerification(fastify, orgId, traceRepo, rca);

    pr = await openFixPr(
      fastify,
      orgId,
      {
        id: rcaId,
        summary: rca.summary,
        explanation: rca.explanation,
        counterfactual: rca.counterfactual,
        file: rca.file,
        fixTitle: rca.fixTitle,
        fixDescription: rca.fixDescription,
        repoFullName: traceRepo,
        commit: rca.commit,
      },
      verification
    );
    // Record what verification actually did — including when it did not run —
    // so `verified` is a stored fact rather than something inferred downstream.
    await fastify.pg`
      UPDATE rca_runs
      SET verified = ${pr.verified === true},
          verification = ${fastify.pg.json((verification ?? null) as unknown as Parameters<typeof fastify.pg.json>[0])},
          commit_message = ${evidence.commit?.message ?? null},
          commit_author = ${evidence.commit?.author ?? null}
      WHERE id = ${rcaId}
    `.catch((err: unknown) => fastify.log.warn({ err }, "could not persist verification"));

    if (pr.prStatus === "opened") {
      // Persist the diff computed from the ACTUAL patch (not the model's
      // independently-invented one) so the UI can't disagree with the commit.
      await fastify.pg`
        UPDATE rca_runs
        SET pr_status = ${pr.prStatus}, pr_url = ${pr.prUrl ?? null}, pr_number = ${pr.prNumber ?? null},
            fix_diff = ${fastify.pg.json((pr.diff ?? rca.fixDiff) as unknown as Parameters<typeof fastify.pg.json>[0])},
            files_changed = ${pr.diff ? 1 : null}
        WHERE id = ${rcaId}
      `;
      if (pr.diff) rca.fixDiff = pr.diff;
    }
  }

  return {
    rcaId,
    ...rca,
    prStatus: pr.prStatus,
    prUrl: pr.prUrl,
    prNumber: pr.prNumber,
    // Only true when the causal-replay check run was actually published.
    verified: pr.verified === true,
    gitEvidence: evidence.resolved,
  };
}

/** Fetch the latest RCA run for a trace. */
export async function getRca(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const rows = (await fastify.pg`
    SELECT id, status, summary, commit_sha, file, line, explanation, counterfactual, confidence, hops_upstream,
           fix_title, fix_description, fix_diff, pr_status, pr_url, pr_number, model, created_at,
           verified, verification, base_branch, files_changed, commit_message, commit_author
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
    // Verification is a recorded fact: true only when the suite ran and passed.
    verified: r["verified"] === true,
    verification: r["verification"] ?? null,
    baseBranch: r["base_branch"] ?? null,
    filesChanged: r["files_changed"] === null ? null : Number(r["files_changed"]),
    commitMessage: r["commit_message"] ?? null,
    commitAuthor: r["commit_author"] ?? null,
  };
}
