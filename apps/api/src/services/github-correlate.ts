import type { FastifyInstance } from "fastify";
import { createGithubClient } from "./github.js";
import { config } from "../config.js";

/**
 * Failure → *change* correlation.
 *
 * git-context.ts resolves the commit behind a failing span, but a commit is the
 * least human artifact in the chain: nobody reviews a commit, argues in a
 * commit, or closes a commit. The review conversation lives on the PR and the
 * intent lives on the issues it closes — plus, very often, someone has *already
 * filed* an open issue about the same file. This pulls all of that back so an
 * incident can say "this broke in PR #412, which closed #388, and there are two
 * open issues already complaining about this file".
 *
 * Degrades to a fully-null correlation (never throws) whenever the GitHub App
 * isn't configured or the API is unhappy — correlation is enrichment, it must
 * never break RCA.
 */

// ── Normalized shapes ───────────────────────────────────────────────
export interface CorrelatedCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

export interface CorrelatedPullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  state: string;
  /** ISO timestamp, or null when the PR is still open. */
  mergedAt: string | null;
  labels: string[];
}

export interface CorrelatedIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  state: string;
  labels: string[];
  /** For related issues: the term (file / symbol) that matched. */
  matchedOn?: string;
}

export interface CommitCorrelation {
  repo: string | null;
  commit: CorrelatedCommit | null;
  /** The PR that introduced this commit, when the commit reached main via one. */
  pullRequest: CorrelatedPullRequest | null;
  /** Issues the PR declares it closes ("closes #123" in its title/body). */
  closesIssues: CorrelatedIssue[];
  /** Open issues that already mention the failing file or symbol. */
  relatedIssues: CorrelatedIssue[];
  /** False means we never reached GitHub — everything above is empty/null. */
  resolved: boolean;
}

export interface CorrelateOptions {
  /** The failing file, so we can find open issues already discussing it. */
  file?: string | null;
  /** The failing function/class name, same purpose. */
  symbol?: string | null;
  /** Cap on open issues scanned (one page each). */
  scanIssues?: number;
  /** Cap on related open issues returned. */
  maxRelatedIssues?: number;
  /** Cap on "closes #n" references followed. */
  maxClosesIssues?: number;
}

/** A parsed "closes #123" / "closes owner/repo#123" reference. */
export interface IssueRef {
  owner: string | null;
  repo: string | null;
  number: number;
}

// ── Tunables ────────────────────────────────────────────────────────
const DEFAULT_SCAN_ISSUES = 100;
const DEFAULT_MAX_RELATED = 5;
const DEFAULT_MAX_CLOSES = 10;
const MAX_ASSOCIATED_PRS = 10;
/** Bodies can be enormous; keep them prompt-sized like git-context does patches. */
const MAX_BODY_CHARS = 4000;
/** Anything shorter than this matches half the repo. */
const MIN_TERM_LENGTH = 3;

const EMPTY: CommitCorrelation = {
  repo: null,
  commit: null,
  pullRequest: null,
  closesIssues: [],
  relatedIssues: [],
  resolved: false,
};

/**
 * GitHub's own closing keywords, followed by `#123`, `owner/repo#123`, or a
 * full issue URL. Global + case-insensitive; `lastIndex` is reset per call.
 */
const CLOSING_REF =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?:https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)|(?:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+))?#(\d+))/gi;

/**
 * Pull every "closes #123"-style reference out of a PR title + body.
 * Exported because it's the one piece of this module worth testing without a
 * network: GitHub's keyword rules are fiddly and easy to regress.
 */
export function parseClosingReferences(text: string): IssueRef[] {
  if (!text) return [];
  const out: IssueRef[] = [];
  const seen = new Set<string>();
  CLOSING_REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOSING_REF.exec(text)) !== null) {
    const owner = m[1] ?? m[4] ?? null;
    const repo = m[2] ?? m[5] ?? null;
    const number = Number(m[3] ?? m[6]);
    if (!Number.isInteger(number) || number <= 0) continue;
    const key = `${owner ?? ""}/${repo ?? ""}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number });
  }
  return out;
}

/**
 * Terms that make an open issue "about" this failure: the file path, its
 * basename with and without extension, and the failing symbol.
 */
export function matchTerms(file?: string | null, symbol?: string | null): string[] {
  const terms = new Set<string>();
  if (file) {
    const path = file.trim();
    if (path) terms.add(path);
    const base = path.split("/").pop() ?? "";
    if (base) terms.add(base);
    const stem = base.replace(/\.[^.]+$/, "");
    if (stem) terms.add(stem);
  }
  if (symbol && symbol.trim()) terms.add(symbol.trim());
  return [...terms].filter((t) => t.length >= MIN_TERM_LENGTH);
}

// ── Octokit response normalization ──────────────────────────────────
// Typed structurally (as git-context.ts does for repos.getContent) so this keeps
// compiling across octokit's generated-type churn.
interface RawIssueLike {
  number?: number;
  title?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  html_url?: string | null;
  state?: string | null;
  labels?: unknown;
  merged_at?: string | null;
  /** Present on issues that are really pull requests. */
  pull_request?: unknown;
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : ((l as { name?: string | null } | null)?.name ?? null)))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

const body = (raw: RawIssueLike): string => (raw.body ?? "").slice(0, MAX_BODY_CHARS);

function toIssue(raw: RawIssueLike, matchedOn?: string): CorrelatedIssue | null {
  if (typeof raw.number !== "number") return null;
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: body(raw),
    author: raw.user?.login ?? "unknown",
    url: raw.html_url ?? "",
    state: raw.state ?? "open",
    labels: labelNames(raw.labels),
    ...(matchedOn ? { matchedOn } : {}),
  };
}

function toPullRequest(raw: RawIssueLike): CorrelatedPullRequest | null {
  if (typeof raw.number !== "number") return null;
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: body(raw),
    author: raw.user?.login ?? "unknown",
    url: raw.html_url ?? "",
    state: raw.state ?? "open",
    mergedAt: raw.merged_at ?? null,
    labels: labelNames(raw.labels),
  };
}

async function resolveInstallation(
  fastify: FastifyInstance,
  orgId: string,
  repoFullName: string
): Promise<{ owner: string; repo: string; installationId: number } | null> {
  const inst = (await fastify.pg`
    SELECT installation_id FROM github_installations WHERE org_id = ${orgId} ORDER BY created_at ASC LIMIT 1
  `.catch(() => [])) as Array<{ installation_id: string | number }>;
  const id = inst[0]?.installation_id;
  if (id == null) return null;
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo, installationId: Number(id) };
}

/**
 * Correlate a failing commit to the change that shipped it.
 *
 * Returns the commit, the PR that introduced it, the issues that PR closes, and
 * any OPEN issues already mentioning the failing file or symbol. Every network
 * step is individually fault-tolerant: a missing PR, an unreadable cross-repo
 * issue, or a rate limit degrades that one field instead of the whole result.
 */
export async function correlateCommit(
  fastify: FastifyInstance,
  orgId: string,
  repoFullName: string | null | undefined,
  sha: string | null | undefined,
  opts: CorrelateOptions = {}
): Promise<CommitCorrelation> {
  const blind: CommitCorrelation = { ...EMPTY, repo: repoFullName ?? null };
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY || !repoFullName || !sha) return blind;

  try {
    const target = await resolveInstallation(fastify, orgId, repoFullName);
    if (!target) return blind;
    const { owner, repo, installationId } = target;
    const gh = createGithubClient(installationId);

    // 1. The commit itself. Without it there's nothing to correlate.
    let commit: CorrelatedCommit | null = null;
    try {
      const res = await gh.repos.getCommit({ owner, repo, ref: sha });
      commit = {
        sha: res.data.sha,
        message: res.data.commit.message,
        author: res.data.commit.author?.name ?? res.data.author?.login ?? "unknown",
        date: res.data.commit.author?.date ?? "",
        url: res.data.html_url ?? null,
      };
    } catch (err) {
      fastify.log.warn({ err, repoFullName, sha }, "commit metadata unavailable for correlation");
    }

    // 2. The PR that introduced it. A commit can be associated with several
    //    (backports, forks) — the merged one is the one that shipped.
    let pullRequest: CorrelatedPullRequest | null = null;
    try {
      const res = await gh.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: sha,
        per_page: MAX_ASSOCIATED_PRS,
      });
      const raws = res.data as unknown as RawIssueLike[];
      const chosen = raws.find((p) => p.merged_at) ?? raws[0];
      if (chosen) pullRequest = toPullRequest(chosen);
    } catch (err) {
      fastify.log.warn({ err, repoFullName, sha }, "no PR association available for commit");
    }

    // 3. The issues that PR declares it closes — the *intent* behind the change.
    const maxCloses = opts.maxClosesIssues ?? DEFAULT_MAX_CLOSES;
    const closesIssues: CorrelatedIssue[] = [];
    if (pullRequest) {
      const refs = parseClosingReferences(`${pullRequest.title}\n${pullRequest.body}`).slice(0, maxCloses);
      const fetched = await Promise.allSettled(
        refs.map((ref) =>
          gh.issues.get({
            owner: ref.owner ?? owner,
            repo: ref.repo ?? repo,
            issue_number: ref.number,
          })
        )
      );
      for (const result of fetched) {
        if (result.status !== "fulfilled") continue;
        const raw = result.value.data as unknown as RawIssueLike;
        // issues.get also serves PRs; a PR referencing a PR isn't an issue.
        if (raw.pull_request) continue;
        const issue = toIssue(raw);
        if (issue) closesIssues.push(issue);
      }
    }

    // 4. Open issues that already mention the failing file or symbol. Someone
    //    reporting this before the incident is the strongest possible context.
    const terms = matchTerms(opts.file, opts.symbol);
    const relatedIssues: CorrelatedIssue[] = [];
    if (terms.length > 0) {
      const maxRelated = opts.maxRelatedIssues ?? DEFAULT_MAX_RELATED;
      const exclude = new Set<number>(closesIssues.map((i) => i.number));
      if (pullRequest) exclude.add(pullRequest.number);
      try {
        const res = await gh.issues.listForRepo({
          owner,
          repo,
          state: "open",
          sort: "updated",
          direction: "desc",
          per_page: Math.min(100, opts.scanIssues ?? DEFAULT_SCAN_ISSUES),
        });
        const raws = res.data as unknown as RawIssueLike[];
        for (const raw of raws) {
          if (relatedIssues.length >= maxRelated) break;
          if (raw.pull_request) continue; // listForRepo returns PRs too
          if (typeof raw.number !== "number" || exclude.has(raw.number)) continue;
          const haystack = `${raw.title ?? ""}\n${raw.body ?? ""}`.toLowerCase();
          const matched = terms.find((t) => haystack.includes(t.toLowerCase()));
          if (!matched) continue;
          const issue = toIssue(raw, matched);
          if (issue) relatedIssues.push(issue);
        }
      } catch (err) {
        fastify.log.warn({ err, repoFullName }, "open-issue scan failed — correlation continues without it");
      }
    }

    return { repo: repoFullName, commit, pullRequest, closesIssues, relatedIssues, resolved: true };
  } catch (err) {
    fastify.log.warn({ err, repoFullName, sha }, "commit correlation unavailable — falling back to commit-only context");
    return blind;
  }
}
