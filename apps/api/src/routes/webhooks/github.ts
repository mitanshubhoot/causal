import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";
import { parsePushWebhook, verifyGithubSignature } from "../../services/github.js";
import { config } from "../../config.js";

const githubWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/github", {
    config: { rawBody: true },  // need raw body for HMAC verification
  }, async (request, reply) => {
    const event = request.headers["x-github-event"] as string;
    const signature = request.headers["x-hub-signature-256"] as string;

    // Verify HMAC via the shared helper — the inline version compared buffers
    // with timingSafeEqual and no length guard, so a short/garbage signature
    // threw RangeError (a 500) instead of returning 401.
    if (config.GITHUB_WEBHOOK_SECRET) {
      const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? "";
      if (!verifyGithubSignature(rawBody, signature ?? "")) {
        return reply.code(401).send({ error: "Invalid webhook signature" });
      }
    }

    const body = request.body as Record<string, unknown>;
    const installationId = (body["installation"] as Record<string, unknown>)?.["id"] as number | undefined;

    // ── Installation lifecycle ──────────────────────────────────────
    // Nothing used to persist installations, so resolveRepo() in the fix-PR
    // path never found one and no PR could ever be opened. Record them here.
    if (event === "installation" || event === "installation_repositories") {
      const action = body["action"] as string;
      const account = (body["installation"] as Record<string, unknown>)?.["account"] as Record<string, unknown> | undefined;
      const login = (account?.["login"] as string) ?? "";
      // Map to an existing org by login, else fall back to the demo org so a
      // fresh install is still usable.
      const orgRow = (await fastify.pg`
        SELECT id FROM organizations WHERE id = ${login} OR name = ${login} LIMIT 1
      `.catch(() => [])) as Array<{ id: string }>;
      const targetOrg = orgRow[0]?.id ?? "org_demo_causal_001";

      if (installationId && (action === "created" || action === "added" || action === "new_permissions_accepted")) {
        await fastify.pg`
          INSERT INTO github_installations (installation_id, org_id)
          VALUES (${installationId}, ${targetOrg})
          ON CONFLICT (installation_id) DO UPDATE SET org_id = EXCLUDED.org_id
        `.catch((err: unknown) => fastify.log.error({ err }, "failed to persist installation"));

        // Record the repositories this installation grants access to.
        const repos = [
          ...(((body["repositories"] as Array<Record<string, unknown>>) ?? [])),
          ...(((body["repositories_added"] as Array<Record<string, unknown>>) ?? [])),
        ];
        for (const r of repos) {
          const fullName = r["full_name"] as string;
          if (!fullName) continue;
          await fastify.pg`
            INSERT INTO repositories (id, org_id, name, full_name, github_id, default_branch)
            VALUES (${fullName}, ${targetOrg}, ${(r["name"] as string) ?? fullName}, ${fullName},
                    ${(r["id"] as number) ?? null}, ${(r["default_branch"] as string) ?? "main"})
            ON CONFLICT (org_id, full_name) DO NOTHING
          `.catch((err: unknown) => fastify.log.error({ err, fullName }, "failed to persist repository"));
        }
        fastify.log.info({ installationId, targetOrg, repos: repos.length }, "GitHub App installed");
      }

      if (installationId && (action === "deleted" || action === "removed")) {
        await fastify.pg`DELETE FROM github_installations WHERE installation_id = ${installationId}`
          .catch(() => undefined);
      }
      return reply.send({ ok: true, event, action });
    }

    // Resolve org from GitHub installation ID
    const orgRows = await fastify.pg`
      SELECT org_id FROM github_installations WHERE installation_id = ${installationId ?? 0}
    `.catch(() => []) as Array<{ org_id: string }>;

    // An unknown installation is not ours — reject rather than writing data
    // into a phantom "default" org (which is what used to happen).
    const resolvedOrg = orgRows[0]?.org_id;
    if (!resolvedOrg && config.GITHUB_WEBHOOK_SECRET) {
      return reply.code(404).send({ error: "Unknown GitHub installation" });
    }
    const orgId = resolvedOrg ?? "default";
    const repoFullName = (body["repository"] as Record<string, unknown>)?.["full_name"] as string ?? "";

    // Resolve or create repoId
    let repoId = "";
    const repoRows = await fastify.pg`
      SELECT id FROM repositories WHERE org_id = ${orgId} AND full_name = ${repoFullName}
    `.catch(() => []) as Array<{ id: string }>;
    repoId = repoRows[0]?.id ?? repoFullName;

    if (event === "push") {
      const commits = parsePushWebhook(body);

      for (const commit of commits) {
        const codeNode = await createNode(fastify, {
          layer: "CODE",
          kind: "git_commit",
          timestamp: commit.timestamp,
          agentId: null,
          modelVersion: null,
          sessionId: commit.sessionId,
          contextSnapId: null,
          payload: {
            commitHash: commit.hash,
            commitMessage: commit.message,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            branch: commit.branch,
            repoFullName: commit.repoFullName,
            filesChanged: commit.filesChanged,
            causalSessionTrailer: commit.sessionId,
          },
          orgId,
          repoId,
        });

        // Auto-link immediately — session ID linking is synchronous
        await runAutoLinkPipeline(fastify, codeNode);
      }

      fastify.log.info(
        { event, commits: commits.length, repoFullName },
        "GitHub push processed"
      );
    }

    if (event === "pull_request") {
      const pr = body["pull_request"] as Record<string, unknown>;
      const action = body["action"] as string;

      if (action === "opened" || action === "reopened" || action === "synchronize") {
        fastify.log.info({ pr: pr["number"], action }, "PR event received — risk check TBD");
        // Phase 2: Pre-ship risk check
      }
    }

    return reply.code(200).send({ ok: true });
  });
};

export default githubWebhookPlugin;
