import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  PROVIDERS, PROVIDER_INFO, isProvider, listProviderKeys, upsertProviderKey,
  deleteProviderKey, getLlmSettings, updateLlmSettings, envCredentialFor,
  resolveForPurpose, validateProviderKey, modelFor,
  type Provider, type LlmSettings, type Purpose,
} from "../services/llm.js";
import { isEncryptionConfigured, encryptionUnavailableReason } from "../services/crypto.js";

/**
 * BYOK — bring your own model provider, per workspace.
 *
 * Mounted at /api/v1 (see factory.ts):
 *   GET    /api/v1/providers                  what this workspace can run on
 *   PUT    /api/v1/providers/:provider        store a key (proven live first)
 *   DELETE /api/v1/providers/:provider        remove it
 *   GET    /api/v1/providers/settings         per-purpose model selection
 *   PUT    /api/v1/providers/settings         change it
 *
 * Credentials are encrypted at rest (AES-256-GCM) and NEVER returned; only a
 * hint (last four characters) is ever exposed. Writes require a non-viewer
 * role: the public demo key authenticates as a viewer and must not be able to
 * install, replace, or delete a workspace credential.
 */

const modelField = z
  .union([z.string().max(200), z.null()])
  .optional()
  .transform((v) => (typeof v === "string" ? v.trim() || null : v));

const SettingsSchema = z.object({
  provider: z.union([z.string(), z.null()]).optional(),
  detectorModel: modelField,
  rcaModel: modelField,
  copilotModel: modelField,
});

const KeySchema = z.object({
  credential: z.string().min(4, "credential looks too short").max(8000),
  modelDefault: modelField,
  /** Escape hatch for a provider/region this deployment cannot reach. */
  validate: z.boolean().optional(),
});

const PURPOSES: readonly Purpose[] = ["detector", "rca", "copilot"];

/** UI-facing wording for where a credential comes from. */
type KeySource = "workspace" | "server";
const sourceLabel = (s: "org" | "env"): KeySource => (s === "org" ? "workspace" : "server");

interface ActiveModel { provider: Provider; model: string; source: KeySource }

/** What each purpose would actually run on right now. */
async function activeModels(fastify: FastifyInstance, orgId: string): Promise<Record<string, ActiveModel | null>> {
  const out: Record<string, ActiveModel | null> = {};
  for (const purpose of PURPOSES) {
    const r = await resolveForPurpose(fastify, orgId, purpose);
    out[purpose] = r ? { provider: r.provider, model: r.model, source: sourceLabel(r.source) } : null;
  }
  return out;
}

const providersPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/providers — every supported provider, whether this workspace
  // has a key, and where the credential would come from.
  fastify.get("/providers", async (request) => {
    const { orgId } = request.authUser;
    const [stored, settings, active] = await Promise.all([
      listProviderKeys(fastify, orgId),
      getLlmSettings(fastify, orgId),
      activeModels(fastify, orgId),
    ]);
    const byProvider = new Map(stored.map((k) => [k.provider, k]));

    return {
      encryptionConfigured: isEncryptionConfigured(),
      ...(isEncryptionConfigured() ? {} : { encryptionError: encryptionUnavailableReason() }),
      settings,
      // The answer to "which model am I actually paying for right now?".
      active,
      providers: PROVIDERS.map((p) => {
        const key = byProvider.get(p);
        const hasEnv = envCredentialFor(p) !== null;
        return {
          provider: p,
          label: PROVIDER_INFO[p].label,
          fastModel: PROVIDER_INFO[p].fastModel,
          smartModel: PROVIDER_INFO[p].smartModel,
          credentialFormat: PROVIDER_INFO[p].credentialFormat,
          consoleUrl: PROVIDER_INFO[p].consoleUrl,
          configured: Boolean(key) || hasEnv,
          source: key ? "workspace" : hasEnv ? "server" : null,
          keyHint: key?.keyHint ?? null,
          modelDefault: key?.modelDefault ?? null,
          createdAt: key?.createdAt ?? null,
          updatedAt: key?.updatedAt ?? null,
        };
      }),
    };
  });

  // GET /api/v1/providers/settings — per-purpose model selection.
  fastify.get("/providers/settings", async (request) => {
    const { orgId } = request.authUser;
    const [settings, active] = await Promise.all([getLlmSettings(fastify, orgId), activeModels(fastify, orgId)]);
    return { ...settings, active };
  });

  // PUT /api/v1/providers/settings — choose the provider and per-purpose models.
  fastify.put<{ Body: unknown }>("/providers/settings", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify settings");

    const parsed = SettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");
    const body = parsed.data;
    if (body.provider != null && !isProvider(body.provider)) {
      return reply.badRequest(`Unknown provider "${body.provider}"`);
    }

    // Selecting a provider we hold no credential for would silently downgrade
    // every LLM feature to its heuristic fallback — refuse it loudly instead.
    if (body.provider) {
      const target = body.provider as Provider;
      const stored = await listProviderKeys(fastify, orgId);
      const hasKey = stored.some((k) => k.provider === target) || envCredentialFor(target) !== null;
      if (!hasKey) {
        return reply.badRequest(
          `No API key configured for ${PROVIDER_INFO[target].label}. PUT /api/v1/providers/${target} first.`
        );
      }
    }

    const current = await getLlmSettings(fastify, orgId);
    const nextProvider = (body.provider ?? null) as Provider | null;
    // Switching provider invalidates any model ids left over from the old one —
    // "gpt-4o" is not a thing on Anthropic. Anything named in THIS request wins;
    // everything else resets to the new provider's defaults.
    const switching = body.provider !== undefined && nextProvider !== current.provider;

    const patch: Partial<LlmSettings> = {};
    if (body.provider !== undefined) patch.provider = nextProvider;
    if (body.detectorModel !== undefined) patch.detectorModel = body.detectorModel;
    else if (switching) patch.detectorModel = null;
    if (body.rcaModel !== undefined) patch.rcaModel = body.rcaModel;
    else if (switching) patch.rcaModel = null;
    if (body.copilotModel !== undefined) patch.copilotModel = body.copilotModel;
    else if (switching) patch.copilotModel = null;

    const settings = await updateLlmSettings(fastify, orgId, patch);
    return { ...settings, active: await activeModels(fastify, orgId) };
  });

  // PUT /api/v1/providers/:provider — store this workspace's credential. The
  // key is proven with a cheap live completion BEFORE it is encrypted and
  // saved, so a typo fails here instead of silently disabling the detector an
  // hour later, in the background, where nobody is looking.
  fastify.put<{ Params: { provider: string }; Body: unknown }>("/providers/:provider", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify providers");
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.badRequest(`Unknown provider "${provider}"`);
    if (!isEncryptionConfigured()) {
      return reply.code(503).send({ error: "Encryption unavailable", message: encryptionUnavailableReason() });
    }

    // Accept `credential`, `apiKey`, or `key` — the field name people reach for
    // differs per provider, and a 400 on the name is a pointless dead end.
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const parsed = KeySchema.safeParse({
      ...raw,
      credential: raw["credential"] ?? raw["apiKey"] ?? raw["key"],
    });
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");
    const credential = parsed.data.credential.trim();
    const modelDefault = parsed.data.modelDefault ?? null;

    let validatedWith: string | null = null;
    if (parsed.data.validate !== false) {
      const check = await validateProviderKey({ provider, credential, model: modelDefault });
      if (!check.ok) {
        // The provider's own message ("invalid x-api-key", "model not found")
        // is far more actionable than a generic 400. It is scrubbed of the key.
        return reply.badRequest(
          `${PROVIDER_INFO[provider].label} rejected the credential — ${check.error ?? "unknown error"}`
        );
      }
      validatedWith = check.model;
    }

    const row = await upsertProviderKey(fastify, orgId, provider, credential, modelDefault);
    // Log the hint only — the credential itself never reaches a log line.
    request.log.info({ orgId, provider, keyHint: row.keyHint }, "provider key stored");

    return {
      provider: row.provider,
      label: PROVIDER_INFO[provider].label,
      keyHint: row.keyHint,
      modelDefault: row.modelDefault,
      validated: validatedWith !== null,
      validatedWith,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  // DELETE /api/v1/providers/:provider — remove the key. The workspace falls
  // back to the server key (if any), then to the heuristic path. If it was also
  // the selected provider, clear the selection so nothing points at nothing.
  fastify.delete<{ Params: { provider: string } }>("/providers/:provider", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot modify providers");
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.badRequest(`Unknown provider "${provider}"`);

    const removed = await deleteProviderKey(fastify, orgId, provider);
    if (!removed) return reply.notFound("No credential stored for that provider");

    const settings = await getLlmSettings(fastify, orgId);
    if (settings.provider === provider && envCredentialFor(provider) === null) {
      // The selection now points at a provider we hold no credential for. Clear
      // it, and with it the per-purpose model ids — they named this provider's
      // models and would otherwise be sent to whatever provider takes over.
      await updateLlmSettings(fastify, orgId, {
        provider: null, detectorModel: null, rcaModel: null, copilotModel: null,
      });
    }
    request.log.info({ orgId, provider }, "provider key removed");

    return { provider, removed: true, active: await activeModels(fastify, orgId) };
  });

  // GET /api/v1/providers/:provider/models — the model ids this workspace would
  // use per purpose on a given provider. Lets the settings UI show the defaults
  // it is about to inherit before anything is saved.
  fastify.get<{ Params: { provider: string } }>("/providers/:provider/models", async (request, reply) => {
    const { orgId } = request.authUser;
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.badRequest(`Unknown provider "${provider}"`);

    const [settings, stored] = await Promise.all([getLlmSettings(fastify, orgId), listProviderKeys(fastify, orgId)]);
    const modelDefault = stored.find((k) => k.provider === provider)?.modelDefault ?? null;
    const models: Record<string, string> = {};
    for (const purpose of PURPOSES) models[purpose] = modelFor(settings, provider, purpose, modelDefault);
    return { provider, label: PROVIDER_INFO[provider].label, modelDefault, models };
  });
};

export default providersPlugin;
