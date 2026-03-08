import fp from "fastify-plugin";
import { createHash } from "crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";

export interface AuthUser {
  userId: string;
  orgId: string;
  role: "admin" | "member" | "viewer";
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest<AuthUser>("authUser", {
    getter() { return { userId: "", orgId: "", role: "viewer" as const }; },
  });

  fastify.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for webhook routes — they use their own HMAC verification
      if (request.url.startsWith("/api/v1/webhooks")) return;
      if (request.url === "/health") return;
      if (request.url === "/api/v1/health") return;

      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return reply.code(401).send({ error: "Missing Authorization header" });
      }

      // Split on the first space only to handle tokens that may contain spaces.
      // Previously used authHeader.split(" ") which would truncate tokens with
      // embedded spaces (e.g. Clerk session tokens on some platforms).
      const spaceIdx = authHeader.indexOf(" ");
      const scheme = spaceIdx === -1 ? authHeader : authHeader.slice(0, spaceIdx);
      const token = spaceIdx === -1 ? undefined : authHeader.slice(spaceIdx + 1).trim() || undefined;

      if (scheme === "Bearer" && token) {
        // API key auth: hash the provided key and look it up
        const keyHash = createHash("sha256").update(token).digest("hex");

        const rows = await fastify.pg`
          SELECT ak.org_id, ak.id
          FROM api_keys ak
          WHERE ak.key_hash = ${keyHash}
            AND ak.revoked_at IS NULL
          LIMIT 1
        `;

        if (!rows.length) {
          return reply.code(401).send({ error: "Invalid API key" });
        }

        const row = rows[0] as { org_id: string; id: string };

        // Update last_used async (fire and forget)
        fastify.pg`
          UPDATE api_keys SET last_used = NOW() WHERE id = ${row.id}
        `.catch(() => {});

        request.authUser = {
          userId: `apikey:${row.id}`,
          orgId: row.org_id,
          role: "member",
        };
        return;
      }

      const supportedSchemes = ["Bearer"];
      return reply.code(401).send({
        error: "Invalid authorization scheme",
        supported: supportedSchemes,
      });
    }
  );
};

export default fp(authPlugin, { name: "auth" });
