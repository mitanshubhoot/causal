import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { createNode } from "../../services/nodes.js";
import { runAutoLinkPipeline } from "../../services/autolink.js";
import { parsePushWebhook } from "../../services/github.js";
import { config } from "../../config.js";

const githubWebhookPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/github", {
    config: { rawBody: true },  // need raw body for HMAC verification
  }, async (request, reply) => {
    const event = request.headers["x-github-event"] as string;
    const signature = request.headers["x-hub-signature-256"] as string;

    // Verify HMAC
    if (config.GITHUB_WEBHOOK_SECRET) {
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
      const expected =
        "sha256=" +
        createHmac("sha256", config.GITHUB_WEBHOOK_SECRET)
          .update(rawBody)
          .digest("hex");

      if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.code(401).send({ error: "Invalid webhook signature" });
      }
    }

    const body = request.body as Record<string, unknown>;
    const installationId = (body["installation"] as Record<string, unknown>)?.["id"] as number | undefined;

    // Resolve org from GitHub installation ID
    const orgRows = await fastify.pg`
      SELECT org_id FROM github_installations WHERE installation_id = ${installationId ?? 0}
    `.catch(() => []) as Array<{ org_id: string }>;

    const orgId = orgRows[0]?.org_id ?? "default";
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
