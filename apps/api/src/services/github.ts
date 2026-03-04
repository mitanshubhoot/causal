import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { config } from "../config.js";

// ── GitHub App client factory ─────────────────────────────────────
export function createGithubClient(installationId?: number): Octokit {
  if (config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.GITHUB_APP_ID,
        privateKey: config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
        installationId,
      },
    });
  }
  return new Octokit();
}

// ── Verify GitHub webhook HMAC signature ─────────────────────────
export function verifyGithubSignature(
  payload: string,
  signature: string
): boolean {
  if (!config.GITHUB_WEBHOOK_SECRET) return true; // dev mode

  const { createHmac } = require("crypto");
  const expected =
    "sha256=" +
    createHmac("sha256", config.GITHUB_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  const { timingSafeEqual } = require("crypto");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Extract session ID from commit message/notes ──────────────────
// Supports two formats:
//   1. Git trailer:   "Causal-Session: <uuid>"
//   2. Git notes:     stored separately as "causal-session: <uuid>"
export function extractSessionId(commitMessage: string): string | null {
  // Trailer format (preferred)
  const trailerMatch = commitMessage.match(
    /^Causal-Session:\s*([0-9a-f-]{36})/im
  );
  if (trailerMatch?.[1]) return trailerMatch[1];

  // Also accept inline format used by some CLIs
  const inlineMatch = commitMessage.match(/\[causal:([0-9a-f-]{36})\]/i);
  if (inlineMatch?.[1]) return inlineMatch[1];

  return null;
}

// ── Parse GitHub push webhook payload ────────────────────────────
export interface ParsedCommit {
  hash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  branch: string;
  repoFullName: string;
  filesChanged: string[];
  sessionId: string | null;
}

export function parsePushWebhook(body: Record<string, unknown>): ParsedCommit[] {
  const commits = (body["commits"] as unknown[]) ?? [];
  const ref = (body["ref"] as string) ?? "";
  const branch = ref.replace("refs/heads/", "");
  const repo = body["repository"] as Record<string, unknown>;
  const repoFullName = (repo?.["full_name"] as string) ?? "";

  return commits.map((c) => {
    const commit = c as Record<string, unknown>;
    const message = (commit["message"] as string) ?? "";
    const author = commit["author"] as Record<string, unknown>;
    const added = (commit["added"] as string[]) ?? [];
    const modified = (commit["modified"] as string[]) ?? [];
    const removed = (commit["removed"] as string[]) ?? [];

    return {
      hash: (commit["id"] as string) ?? "",
      message,
      authorName: (author?.["name"] as string) ?? "",
      authorEmail: (author?.["email"] as string) ?? "",
      timestamp: new Date((commit["timestamp"] as string) ?? Date.now()).getTime(),
      branch,
      repoFullName,
      filesChanged: [...added, ...modified, ...removed],
      sessionId: extractSessionId(message),
    };
  });
}
