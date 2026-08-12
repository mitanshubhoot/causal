import type { FastifyInstance } from "fastify";
import { createGithubClient } from "./github.js";
import { config } from "../config.js";

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
  /** Files touched by the commit, when available. */
  files?: { filename: string; additions: number; deletions: number; patch?: string }[];
}

export interface GitEvidence {
  commit?: CommitInfo;
  /** The failing file's content around the failing line, at that commit. */
  snippet?: { file: string; startLine: number; lines: { n: number; text: string; marked?: boolean }[] };
  /** How many commits back the failing line was last changed. */
  hopsUpstream: number;
  /** True when we actually reached GitHub; false means we're reasoning blind. */
  resolved: boolean;
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
 * Pull the real git evidence behind a failing span: the commit that introduced
 * it (message/author/date/patch) and the source around the failing line, read
 * at that commit. Without this the RCA model was reasoning from a file path and
 * a line number alone.
 *
 * Degrades to `resolved: false` whenever the GitHub App isn't configured, so
 * RCA still runs — it just falls back to the heuristic narrative.
 */
export async function collectGitEvidence(
  fastify: FastifyInstance,
  orgId: string,
  repoFullName: string | null | undefined,
  file: string | null | undefined,
  line: number | null | undefined,
  commitSha: string | null | undefined
): Promise<GitEvidence> {
  const blind: GitEvidence = { hopsUpstream: 1, resolved: false };
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY || !repoFullName || !file) return blind;

  try {
    const target = await resolveInstallation(fastify, orgId, repoFullName);
    if (!target) return blind;
    const { owner, repo, installationId } = target;
    const gh = createGithubClient(installationId);

    let commit: CommitInfo | undefined;
    if (commitSha) {
      const res = await gh.repos.getCommit({ owner, repo, ref: commitSha });
      commit = {
        sha: res.data.sha,
        message: res.data.commit.message,
        author: res.data.commit.author?.name ?? res.data.author?.login ?? "unknown",
        date: res.data.commit.author?.date ?? "",
        url: res.data.html_url,
        files: (res.data.files ?? []).map((f) => ({
          filename: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          ...(f.patch ? { patch: f.patch.slice(0, 4000) } : {}),
        })),
      };
    }

    // Read the file at that commit and window around the failing line.
    let snippet: GitEvidence["snippet"];
    const ref = commitSha || undefined;
    const contentRes = await gh.repos.getContent({ owner, repo, path: file, ...(ref ? { ref } : {}) });
    const data = contentRes.data as { content?: string; type?: string };
    if (data.type === "file" && data.content) {
      const text = Buffer.from(data.content, "base64").toString("utf-8");
      const all = text.split("\n");
      const target0 = Math.max(0, (line ?? 1) - 1);
      const from = Math.max(0, target0 - 4);
      const to = Math.min(all.length - 1, target0 + 4);
      snippet = {
        file,
        startLine: from + 1,
        lines: Array.from({ length: to - from + 1 }, (_, i) => ({
          n: from + i + 1,
          text: all[from + i] ?? "",
          ...(from + i === target0 ? { marked: true } : {}),
        })),
      };
    }

    // How far back was this line last touched? Walk the file's commit history.
    let hopsUpstream = 1;
    try {
      const hist = await gh.repos.listCommits({ owner, repo, path: file, per_page: 20 });
      const idx = hist.data.findIndex((c) => c.sha === commitSha);
      hopsUpstream = idx >= 0 ? idx + 1 : 1;
    } catch {
      /* history is a nice-to-have */
    }

    return {
      ...(commit ? { commit } : {}),
      ...(snippet ? { snippet } : {}),
      hopsUpstream,
      resolved: true,
    };
  } catch (err) {
    fastify.log.warn({ err, repoFullName, file }, "git evidence unavailable — RCA will run without it");
    return blind;
  }
}
