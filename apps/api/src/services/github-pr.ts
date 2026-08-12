import type { FastifyInstance } from "fastify";
import { Anthropic } from "@anthropic-ai/sdk";
import { createGithubClient } from "./github.js";
import { describeVerification, type VerificationResult } from "./verify.js";
import { config } from "../config.js";

const IS_DEMO = !config.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY.startsWith("sk-ant-...");
let anthropic: Anthropic | null = null;
if (!IS_DEMO) anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export interface FixContext {
  id: string;
  summary: string;
  explanation: string;
  counterfactual: string;
  file: string | null;
  fixTitle: string;
  fixDescription: string;
  /** The repo the failing trace came from (traces.repo), e.g. "acme/storefront". */
  repoFullName?: string | null;
  /** The commit the failing span ran at — we patch against this, not base HEAD. */
  commit?: string | null;
}

export interface PrResult {
  prStatus: "opened" | "proposed" | "skipped";
  prUrl?: string;
  prNumber?: number;
  /** Unified diff computed from the ACTUAL patch we committed. */
  diff?: { kind: "add" | "del" | "ctx" | "meta"; text: string }[];
  /**
   * True ONLY when a sandbox actually ran the repo's tests against this patch
   * and they passed. Publishing a check run is not evidence of anything.
   */
  verified?: boolean;
  /** The conclusion we published on the causal-replay check run. */
  checkConclusion?: CheckConclusion;
}

type CheckConclusion = "success" | "neutral" | "failure";

/**
 * The causal-replay check run used to be hardcoded to `success` — it asserted
 * "the incident does not reproduce" without replaying anything. A check run is
 * a claim GitHub shows next to a merge button, so it now reports exactly what
 * happened: success only when tests really ran and passed, failure when they
 * ran and failed, neutral (explicitly "not verified") in every other case,
 * including when no verification was attempted at all.
 */
function buildCheckRun(
  fix: FixContext,
  verification: VerificationResult | null | undefined
): { conclusion: CheckConclusion; title: string; summary: string } {
  const origin = `**Root cause:** ${fix.summary}\n**Origin:** \`${fix.file}\`${fix.commit ? ` @ \`${fix.commit}\`` : ""}`;
  const log = verification?.output ? `\n\n<details><summary>Test output</summary>\n\n\`\`\`\n${verification.output.slice(-8000)}\n\`\`\`\n\n</details>` : "";

  if (!verification) {
    return {
      conclusion: "neutral",
      title: "Not verified — no replay was run",
      summary: `${origin}\n\nThis patch was generated from the trace and its git context, but **no sandbox replay or test run was performed**, so nothing here is verified. Review and run the suite before merging.`,
    };
  }
  if (!verification.ran) {
    return {
      conclusion: "neutral",
      title: "Not verified — the test suite did not run",
      summary: `${origin}\n\n${describeVerification(verification)} The patch is therefore **unverified** — treat it as a proposal.${log}`,
    };
  }
  if (!verification.passed) {
    return {
      conclusion: "failure",
      title: "Replay failed — tests do not pass with this patch",
      summary: `${origin}\n\n\`${verification.command}\` exited **${verification.exitCode}** in the sandbox after ${(verification.durationMs / 1000).toFixed(1)}s. The patch does **not** hold up — do not merge as-is.${log}`,
    };
  }
  return {
    conclusion: "success",
    title: "Replay passed — tests green with this patch",
    summary: `${origin}\n\n\`${verification.command}\` passed in a sandbox clone with this patch applied (${(verification.durationMs / 1000).toFixed(1)}s), so the recorded failure no longer reproduces.${log}`,
  };
}

/**
 * Minimal line diff between the original and corrected file, so the diff shown
 * in the product is derived from the real patch rather than invented separately
 * by the model (which could disagree with what was actually committed).
 */
function computeDiff(original: string, corrected: string, file: string): PrResult["diff"] {
  const a = original.split("\n");
  const b = corrected.split("\n");
  const out: NonNullable<PrResult["diff"]> = [{ kind: "meta", text: `--- a/${file}` }, { kind: "meta", text: `+++ b/${file}` }];
  // Trim the common prefix/suffix, then emit the changed window with context.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA > start && endB > start && a[endA] === b[endB]) { endA--; endB--; }

  const ctx = 3;
  const from = Math.max(0, start - ctx);
  out.push({ kind: "meta", text: `@@ -${from + 1},${endA - from + 1} +${from + 1},${endB - from + 1} @@` });
  for (let i = from; i < start; i++) out.push({ kind: "ctx", text: a[i] ?? "" });
  for (let i = start; i <= endA; i++) out.push({ kind: "del", text: a[i] ?? "" });
  for (let i = start; i <= endB; i++) out.push({ kind: "add", text: b[i] ?? "" });
  for (let i = endA + 1; i < Math.min(a.length, endA + 1 + ctx); i++) out.push({ kind: "ctx", text: a[i] ?? "" });
  return out;
}

async function resolveRepo(
  fastify: FastifyInstance,
  orgId: string,
  preferFullName?: string | null
): Promise<{ owner: string; repo: string; base: string; installationId: number } | null> {
  // Target the repo the trace actually came from. Falling back to "the org's
  // first repo" opened PRs against the wrong codebase for any multi-repo org.
  const repos = preferFullName
    ? ((await fastify.pg`
        SELECT full_name, default_branch FROM repositories
        WHERE org_id = ${orgId} AND full_name = ${preferFullName} LIMIT 1
      `) as Array<{ full_name: string; default_branch: string | null }>)
    : ((await fastify.pg`
        SELECT full_name, default_branch FROM repositories WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1
      `) as Array<{ full_name: string; default_branch: string | null }>);
  const inst = (await fastify.pg`
    SELECT installation_id FROM github_installations WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1
  `) as Array<{ installation_id: string | number }>;
  const repo = repos[0];
  const installationId = inst[0]?.installation_id;
  if (!repo || installationId == null) return null;
  const [owner, name] = repo.full_name.split("/");
  if (!owner || !name) return null;
  return { owner, repo: name, base: repo.default_branch ?? "main", installationId: Number(installationId) };
}

async function correctFile(original: string, fix: FixContext): Promise<string | null> {
  if (!anthropic) return null;
  const prompt = `You are fixing a bug in a source file. Return ONLY the full corrected file content — no markdown fences, no commentary.\n\nFile: ${fix.file}\nRoot cause: ${fix.summary}\n${fix.explanation}\nDesired fix: ${fix.fixDescription}\n\n--- CURRENT FILE ---\n${original}\n--- END ---`;
  const res = await anthropic.messages.create({
    model: config.RCA_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") return null;
  return text.text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "");
}

/**
 * Open a real fix PR when a repo→installation mapping exists and the LLM can
 * produce corrected file content (read via the GitHub API — no local clone).
 * Falls back to `proposed` (no PR) on any missing config or error, so RCA never
 * breaks. Returns the PR status for the caller to persist.
 *
 * Pass `verification` (from services/verify.ts, run in a sandbox) to have the
 * causal-replay check run report a real result. Omit it and the check run says
 * "not verified" — it will never claim success it did not earn.
 */
export async function openFixPr(
  fastify: FastifyInstance,
  orgId: string,
  fix: FixContext,
  verification?: VerificationResult | null
): Promise<PrResult> {
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY || !fix.file || !anthropic) {
    return { prStatus: "proposed" };
  }
  try {
    const target = await resolveRepo(fastify, orgId, fix.repoFullName);
    if (!target) return { prStatus: "proposed" };
    const { owner, repo, base, installationId } = target;
    const gh = createGithubClient(installationId);

    // Read the file at the FAILING commit when we know it — patching against
    // base HEAD generates a fix for a different version than the one that broke.
    const readRef = fix.commit || base;
    const contentRes = await gh.repos.getContent({ owner, repo, path: fix.file, ref: readRef });
    const fileData = contentRes.data as { content?: string; type?: string };
    if (fileData.type !== "file" || !fileData.content) return { prStatus: "proposed" };
    const original = Buffer.from(fileData.content, "base64").toString("utf-8");

    const corrected = await correctFile(original, fix);
    if (!corrected || corrected.trim() === original.trim()) return { prStatus: "proposed" };

    // Build a commit on a new branch: base ref → tree → commit → branch → PR.
    const baseRef = await gh.git.getRef({ owner, repo, ref: `heads/${base}` });
    const baseSha = baseRef.data.object.sha;
    const baseCommit = await gh.git.getCommit({ owner, repo, commit_sha: baseSha });
    const blob = await gh.git.createBlob({ owner, repo, content: corrected, encoding: "utf-8" });
    const tree = await gh.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.data.tree.sha,
      tree: [{ path: fix.file, mode: "100644", type: "blob", sha: blob.data.sha }],
    });
    const commit = await gh.git.createCommit({
      owner,
      repo,
      message: fix.fixTitle,
      tree: tree.data.sha,
      parents: [baseSha],
    });
    const branch = `causal/fix-${fix.id.slice(0, 8)}`;
    await gh.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });

    const body = `**Root cause:** ${fix.summary}\n\n${fix.explanation}\n\n**Counterfactual:** ${fix.counterfactual}\n\n${fix.fixDescription}\n\n_Opened automatically by Causal after a detector flagged this incident._`;
    const pr = await gh.pulls.create({ owner, repo, title: fix.fixTitle, head: branch, base, body });

    // Publish the causal-replay check run on the fix commit, reporting the
    // ACTUAL verification outcome. `verified` then requires BOTH that the tests
    // ran green and that the claim is visible on the PR — under-claiming is the
    // only safe direction to be wrong in.
    const check = buildCheckRun(fix, verification);
    let checkPublished = false;
    try {
      await gh.checks.create({
        owner,
        repo,
        name: "causal-replay",
        head_sha: commit.data.sha,
        status: "completed",
        conclusion: check.conclusion,
        output: { title: check.title, summary: check.summary },
      });
      checkPublished = true;
    } catch (err) {
      // A check run needs checks:write; without it the PR is still valid, it
      // just isn't annotated. Never fail the whole fix for this.
      fastify.log.warn({ err }, "causal-replay check run could not be published");
    }

    return {
      prStatus: "opened",
      prUrl: pr.data.html_url,
      prNumber: pr.data.number,
      diff: computeDiff(original, corrected, fix.file),
      verified: checkPublished && check.conclusion === "success",
      checkConclusion: check.conclusion,
    };
  } catch (err) {
    fastify.log.warn({ err, orgId }, "openFixPr failed — leaving fix as proposed");
    return { prStatus: "proposed" };
  }
}
