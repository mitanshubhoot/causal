import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  PROVIDERS, PROVIDER_INFO, isProvider, listProviderKeys, upsertProviderKey,
  deleteProviderKey, getLlmSettings, updateLlmSettings, envCredentialFor,
  type Provider,
} from "../services/llm.js";
import { isEncryptionConfigured, encryptionUnavailableReason } from "../services/crypto.js";

/**
 * BYOK — bring your own model provider, per workspace.
 * Credentials are encrypted at rest (AES-256-GCM) and NEVER returned; only a
 * hint (last four characters) is ever exposed.
 */

const SettingsSchema = z.object({
  provider: z.string().nullable().optional(),
  detectorModel: z.string().nullable().optional(),
  rcaModel: z.string().nullable().optional(),
  copilotModel: z.string().nullable().optional(),
});

const KeySchema = z.object({
  credential: z.string().min(8, "credential looks too short"),
  modelDefault: z.string().nullable().optional(),
});

const providersPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/providers — every supported provider, whether this workspace
  // has a key, and where the credential would come from.
  fastify.get("/providers", async (request) => {
    const { orgId } = request.authUser;
    const stored = await listProviderKeys(fastify, orgId);
    const byProvider = new Map(stored.map((k) => [k.provider, k]));

    return {
      encryptionConfigured: isEncryptionConfigured(),
      providers: PROVIDERS.map((p) => {
        const key = byProvider.get(p);
        return {
          provider: p,
          label: PROVIDER_INFO[p].label,
          fastModel: PROVIDER_INFO[p].fastModel,
          smartModel: PROVIDER_INFO[p].smartModel,
          credentialFormat: PROVIDER_INFO[p].credentialFormat,
          consoleUrl: PROVIDER_INFO[p].consoleUrl,
          configured: !!key || !!envCredentialFor(p),
          source: key ? "workspace" : envCredentialFor(p) ? "server" : null,
          keyHint: key?.keyHint ?? null,
          modelDefault: key?.modelDefault ?? null,
          updatedAt: key?.updatedAt ?? null,
        };
      }),
    };
  });

  // PUT /api/v1/providers/:provider — store a workspace credential.
  fastify.put<{ Params: { provider: string }; Body: unknown }>("/providers/:provider", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify providers");
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.badRequest(`Unknown provider "${provider}"`);
    if (!isEncryptionConfigured()) {
      return reply.code(503).send({ error: "Encryption unavailable", message: encryptionUnavailableReason() });
    }

    const parsed = KeySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");

    const row = await upsertProviderKey(
      fastify, orgId, provider as Provider, parsed.data.credential, parsed.data.modelDefault ?? null
    );
    return { ...row, credential: undefined };
  });

  // DELETE /api/v1/providers/:provider
  fastify.delete<{ Params: { provider: string } }>("/providers/:provider", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify providers");
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.badRequest(`Unknown provider "${provider}"`);
    const removed = await deleteProviderKey(fastify, orgId, provider as Provider);
    if (!removed) return reply.notFound("No credential stored for that provider");
    return { provider, removed: true };
  });

  // GET /api/v1/providers/settings — per-purpose model selection.
  fastify.get("/providers/settings", async (request) => {
    const { orgId } = request.authUser;
    return await getLlmSettings(fastify, orgId);
  });

  // PUT /api/v1/providers/settings
  fastify.put<{ Body: unknown }>("/providers/settings", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify settings");
    const parsed = SettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");
    if (parsed.data.provider != null && !isProvider(parsed.data.provider)) {
      return reply.badRequest(`Unknown provider "${parsed.data.provider}"`);
    }
    return await updateLlmSettings(fastify, orgId, parsed.data as never);
  });
};

export default providersPlugin;
