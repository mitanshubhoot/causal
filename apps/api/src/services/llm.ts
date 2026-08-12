import type { FastifyInstance } from "fastify";
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { decryptSecret, encryptSecret, keyHint, scrubSecret } from "./crypto.js";

/**
 * Provider-agnostic chat completion (BYOK).
 *
 * Every LLM feature in the API — the detector judge, RCA, the Copilot — goes
 * through `complete()`. It resolves *which* provider and model this workspace
 * uses, finds a credential (the org's stored key first, then the server env),
 * speaks that provider's HTTP API over plain `fetch` (no SDKs, no new deps),
 * and normalizes the answer to one shape.
 *
 * It never throws: a missing key, a 401 from the provider, a timeout, or an
 * empty completion all return `null`, which is the caller's signal to use its
 * heuristic fallback. A background feature must never break the request path.
 */

// ── Types ────────────────────────────────────────────────────────────
export type Provider =
  | "anthropic" | "openai" | "google" | "xai" | "deepseek"
  | "openrouter" | "moonshot" | "zhipu" | "bedrock";

export type Purpose = "detector" | "rca" | "copilot";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: Provider;
  tokensIn: number;
  tokensOut: number;
}

export interface CompleteArgs {
  fastify: FastifyInstance;
  orgId: string;
  purpose: Purpose;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Force a provider/model, bypassing the workspace's selection. */
  provider?: Provider;
  model?: string;
  timeoutMs?: number;
}

/** The wire protocol a provider speaks — several share one. */
type Wire = "anthropic" | "openai" | "google" | "bedrock";

export interface ProviderInfo {
  provider: Provider;
  label: string;
  wire: Wire;
  /** Base URL for the HTTP API (unused for bedrock, whose host is region-derived). */
  baseUrl: string;
  /** Server-wide env var consulted when the workspace has no stored key. */
  keyEnv: string;
  /** Where a user gets a key. */
  consoleUrl: string;
  /** Cheap model — used for the detector, which runs on every ingest. */
  fastModel: string;
  smartModel: string;
  /** Shown in the UI so a user knows what to paste (bedrock is not a bare key). */
  credentialFormat: string;
}

// ── Provider registry ────────────────────────────────────────────────
// Defaults are a starting point, not a pin: a workspace overrides them per
// purpose in org_llm_settings, or per provider via provider_keys.model_default.
export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  anthropic: {
    provider: "anthropic",
    label: "Anthropic",
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    fastModel: "claude-haiku-4-5",
    smartModel: "claude-sonnet-4-5",
    credentialFormat: "sk-ant-…",
  },
  openai: {
    provider: "openai",
    label: "OpenAI",
    wire: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    consoleUrl: "https://platform.openai.com/api-keys",
    fastModel: "gpt-4o-mini",
    smartModel: "gpt-4o",
    credentialFormat: "sk-…",
  },
  google: {
    provider: "google",
    label: "Google Gemini",
    wire: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyEnv: "GOOGLE_API_KEY",
    consoleUrl: "https://aistudio.google.com/app/apikey",
    fastModel: "gemini-2.0-flash",
    smartModel: "gemini-2.5-pro",
    credentialFormat: "AIza…",
  },
  xai: {
    provider: "xai",
    label: "xAI Grok",
    wire: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyEnv: "XAI_API_KEY",
    consoleUrl: "https://console.x.ai",
    fastModel: "grok-3-mini",
    smartModel: "grok-4",
    credentialFormat: "xai-…",
  },
  deepseek: {
    provider: "deepseek",
    label: "DeepSeek",
    wire: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    fastModel: "deepseek-chat",
    smartModel: "deepseek-reasoner",
    credentialFormat: "sk-…",
  },
  openrouter: {
    provider: "openrouter",
    label: "OpenRouter",
    wire: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    consoleUrl: "https://openrouter.ai/keys",
    fastModel: "openai/gpt-4o-mini",
    smartModel: "openai/gpt-4o",
    credentialFormat: "sk-or-…",
  },
  moonshot: {
    provider: "moonshot",
    label: "Moonshot (Kimi)",
    wire: "openai",
    // Global endpoint. Mainland-China accounts use https://api.moonshot.cn/v1 —
    // set MOONSHOT_BASE_URL to override.
    baseUrl: "https://api.moonshot.ai/v1",
    keyEnv: "MOONSHOT_API_KEY",
    consoleUrl: "https://platform.moonshot.ai/console/api-keys",
    fastModel: "moonshot-v1-8k",
    smartModel: "moonshot-v1-32k",
    credentialFormat: "sk-…",
  },
  zhipu: {
    provider: "zhipu",
    label: "Zhipu GLM",
    wire: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keyEnv: "ZHIPU_API_KEY",
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    fastModel: "glm-4-flash",
    smartModel: "glm-4-plus",
    credentialFormat: "<id>.<secret>",
  },
  bedrock: {
    provider: "bedrock",
    label: "AWS Bedrock",
    wire: "bedrock",
    baseUrl: "", // host is https://bedrock-runtime.<region>.amazonaws.com
    keyEnv: "AWS_ACCESS_KEY_ID",
    consoleUrl: "https://console.aws.amazon.com/bedrock",
    // Base model ids. Newer regions require a cross-region inference profile
    // ("us.anthropic.…"); set it as the model default if the base id 400s.
    fastModel: "anthropic.claude-3-5-haiku-20241022-v1:0",
    smartModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    credentialFormat: "accessKeyId:secretAccessKey[:region[:sessionToken]]",
  },
};

export const PROVIDERS: readonly Provider[] = Object.keys(PROVIDER_INFO) as Provider[];

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_INFO, value);
}

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const VALIDATE_TIMEOUT_MS = 20_000;

// ── Env credentials (the server's own keys) ──────────────────────────
/** The demo/CI placeholder that ships in .env.example — treat as "no key". */
function isPlaceholder(key: string): boolean {
  return key.startsWith("sk-ant-...") || key.includes("your-") || key.includes("xxx");
}

function envVar(name: string): string {
  return (process.env[name] ?? "").trim();
}

function awsRegionFromEnv(): string {
  return envVar("AWS_REGION") || envVar("AWS_DEFAULT_REGION") || config.S3_REGION || "us-east-1";
}

/**
 * The server-wide credential for a provider, or null. Anthropic/OpenAI come
 * from the zod config; the rest are read straight from the environment so that
 * adding a provider needs no config change.
 */
export function envCredentialFor(provider: Provider): string | null {
  if (provider === "bedrock") {
    const id = envVar("AWS_ACCESS_KEY_ID");
    const secret = envVar("AWS_SECRET_ACCESS_KEY");
    if (!id || !secret) return null;
    const session = envVar("AWS_SESSION_TOKEN");
    return [id, secret, awsRegionFromEnv(), session].filter(Boolean).join(":");
  }
  let raw = "";
  if (provider === "anthropic") raw = (config.ANTHROPIC_API_KEY ?? "").trim();
  else if (provider === "openai") raw = (config.OPENAI_API_KEY ?? "").trim();
  else if (provider === "google") raw = envVar("GOOGLE_API_KEY") || envVar("GEMINI_API_KEY");
  else if (provider === "zhipu") raw = envVar("ZHIPU_API_KEY") || envVar("ZHIPUAI_API_KEY");
  else raw = envVar(PROVIDER_INFO[provider].keyEnv);
  if (!raw || isPlaceholder(raw)) return null;
  return raw;
}

function baseUrlFor(provider: Provider): string {
  const override = envVar(`${provider.toUpperCase()}_BASE_URL`);
  return (override || PROVIDER_INFO[provider].baseUrl).replace(/\/+$/, "");
}

// ── Persistence: provider keys + per-workspace model selection ───────
export interface ProviderKeyRow {
  provider: Provider;
  keyHint: string;
  modelDefault: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LlmSettings {
  provider: Provider | null;
  detectorModel: string | null;
  rcaModel: string | null;
  copilotModel: string | null;
}

const EMPTY_SETTINGS: LlmSettings = { provider: null, detectorModel: null, rcaModel: null, copilotModel: null };

interface OrgLlmState {
  settings: LlmSettings;
  /** provider -> decrypted credential + its per-provider default model. */
  keys: Map<Provider, { credential: string; modelDefault: string | null }>;
}

// Resolution touches two tables on every completion, so cache it briefly. The
// TTL bounds staleness for other API instances; this instance invalidates
// explicitly whenever it writes.
const ORG_CACHE_TTL_MS = 60_000;
const orgCache = new Map<string, { at: number; state: OrgLlmState }>();

/** Drop cached credentials/settings — call after any write. */
export function invalidateOrgLlmCache(orgId?: string): void {
  if (orgId) orgCache.delete(orgId);
  else orgCache.clear();
}

async function loadOrgLlmState(fastify: FastifyInstance, orgId: string): Promise<OrgLlmState> {
  const cached = orgCache.get(orgId);
  if (cached && Date.now() - cached.at < ORG_CACHE_TTL_MS) return cached.state;

  const state: OrgLlmState = { settings: { ...EMPTY_SETTINGS }, keys: new Map() };

  // Both reads are best-effort: if 007_byok.sql hasn't been applied (or the DB
  // is briefly unavailable) BYOK is simply unavailable and the env key wins.
  try {
    const rows = (await fastify.pg`
      SELECT provider, detector_model, rca_model, copilot_model
      FROM org_llm_settings WHERE org_id = ${orgId} LIMIT 1
    `) as Array<{ provider: string | null; detector_model: string | null; rca_model: string | null; copilot_model: string | null }>;
    const row = rows[0];
    if (row) {
      state.settings = {
        provider: isProvider(row.provider) ? row.provider : null,
        detectorModel: row.detector_model,
        rcaModel: row.rca_model,
        copilotModel: row.copilot_model,
      };
    }
  } catch (err) {
    fastify.log.debug({ err }, "org_llm_settings unavailable — using server defaults");
  }

  try {
    const rows = (await fastify.pg`
      SELECT provider, encrypted_key, model_default
      FROM provider_keys WHERE org_id = ${orgId} ORDER BY created_at ASC
    `) as Array<{ provider: string; encrypted_key: string; model_default: string | null }>;
    for (const row of rows) {
      if (!isProvider(row.provider)) continue;
      try {
        // decryptSecret never returns or logs plaintext on failure.
        const credential = decryptSecret(row.encrypted_key);
        state.keys.set(row.provider, { credential, modelDefault: row.model_default });
      } catch {
        fastify.log.warn(
          { provider: row.provider, orgId },
          "stored provider key could not be decrypted — falling back to the server key"
        );
      }
    }
  } catch (err) {
    fastify.log.debug({ err }, "provider_keys unavailable — using server defaults");
  }

  orgCache.set(orgId, { at: Date.now(), state });
  return state;
}

/** Providers this workspace has stored a key for. Never returns key material. */
export async function listProviderKeys(fastify: FastifyInstance, orgId: string): Promise<ProviderKeyRow[]> {
  const rows = (await fastify.pg`
    SELECT provider, key_hint, model_default, created_at, updated_at
    FROM provider_keys WHERE org_id = ${orgId} ORDER BY created_at ASC
  `) as Array<{ provider: string; key_hint: string; model_default: string | null; created_at: string; updated_at: string }>;
  return rows.filter((r) => isProvider(r.provider)).map((r) => ({
    provider: r.provider as Provider,
    keyHint: r.key_hint ?? "",
    modelDefault: r.model_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Store (or replace) a workspace's credential for a provider. */
export async function upsertProviderKey(
  fastify: FastifyInstance,
  orgId: string,
  provider: Provider,
  credential: string,
  modelDefault: string | null
): Promise<ProviderKeyRow> {
  const encrypted = encryptSecret(credential);
  const hint = credentialHint(provider, credential);
  const rows = (await fastify.pg`
    INSERT INTO provider_keys (org_id, provider, encrypted_key, key_hint, model_default)
    VALUES (${orgId}, ${provider}, ${encrypted}, ${hint}, ${modelDefault})
    ON CONFLICT (org_id, provider) DO UPDATE
      SET encrypted_key = EXCLUDED.encrypted_key,
          key_hint      = EXCLUDED.key_hint,
          model_default = EXCLUDED.model_default,
          updated_at    = now()
    RETURNING provider, key_hint, model_default, created_at, updated_at
  `) as Array<{ provider: string; key_hint: string; model_default: string | null; created_at: string; updated_at: string }>;
  invalidateOrgLlmCache(orgId);
  const r = rows[0];
  return {
    provider,
    keyHint: r?.key_hint ?? hint,
    modelDefault: r?.model_default ?? modelDefault,
    createdAt: r?.created_at ?? new Date().toISOString(),
    updatedAt: r?.updated_at ?? new Date().toISOString(),
  };
}

/** Remove a workspace's credential. Returns false when there was nothing to remove. */
export async function deleteProviderKey(fastify: FastifyInstance, orgId: string, provider: Provider): Promise<boolean> {
  const rows = (await fastify.pg`
    DELETE FROM provider_keys WHERE org_id = ${orgId} AND provider = ${provider} RETURNING provider
  `) as Array<{ provider: string }>;
  invalidateOrgLlmCache(orgId);
  return rows.length > 0;
}

/** Per-purpose model selection for a workspace. */
export async function getLlmSettings(fastify: FastifyInstance, orgId: string): Promise<LlmSettings> {
  const state = await loadOrgLlmState(fastify, orgId);
  return { ...state.settings };
}

/** Merge a patch into a workspace's model selection (null clears a field). */
export async function updateLlmSettings(
  fastify: FastifyInstance,
  orgId: string,
  patch: Partial<LlmSettings>
): Promise<LlmSettings> {
  const current = await getLlmSettings(fastify, orgId);
  const next: LlmSettings = {
    provider: patch.provider === undefined ? current.provider : patch.provider,
    detectorModel: patch.detectorModel === undefined ? current.detectorModel : patch.detectorModel,
    rcaModel: patch.rcaModel === undefined ? current.rcaModel : patch.rcaModel,
    copilotModel: patch.copilotModel === undefined ? current.copilotModel : patch.copilotModel,
  };
  await fastify.pg`
    INSERT INTO org_llm_settings (org_id, provider, detector_model, rca_model, copilot_model)
    VALUES (${orgId}, ${next.provider}, ${next.detectorModel}, ${next.rcaModel}, ${next.copilotModel})
    ON CONFLICT (org_id) DO UPDATE
      SET provider       = EXCLUDED.provider,
          detector_model = EXCLUDED.detector_model,
          rca_model      = EXCLUDED.rca_model,
          copilot_model  = EXCLUDED.copilot_model,
          updated_at     = now()
  `;
  invalidateOrgLlmCache(orgId);
  return next;
}

// ── Resolution ───────────────────────────────────────────────────────
export interface ResolvedLlm {
  provider: Provider;
  model: string;
  /** "org" = the workspace's stored key, "env" = the server's own key. */
  source: "org" | "env";
}

function settingsModelFor(settings: LlmSettings, purpose: Purpose): string | null {
  if (purpose === "detector") return settings.detectorModel;
  if (purpose === "rca") return settings.rcaModel;
  return settings.copilotModel;
}

function envModelFor(purpose: Purpose): string {
  if (purpose === "detector") return config.DETECTOR_MODEL;
  if (purpose === "rca") return config.RCA_MODEL;
  return config.COPILOT_MODEL;
}

function defaultModelFor(provider: Provider, purpose: Purpose): string {
  const info = PROVIDER_INFO[provider];
  // The detector runs on every ingest — it gets the cheap model by default.
  const model = purpose === "detector" ? info.fastModel : info.smartModel;
  // The env-configured model names are Anthropic ids (claude-*), so they are
  // only meaningful when the provider actually is Anthropic.
  if (provider === "anthropic") return envModelFor(purpose) || model;
  return model;
}

/** The model a workspace would use for a purpose, without needing a credential. */
export function modelFor(settings: LlmSettings, provider: Provider, purpose: Purpose, modelDefault?: string | null): string {
  const chosen = settings.provider;
  if ((chosen === null || chosen === provider) && settingsModelFor(settings, purpose)) {
    return settingsModelFor(settings, purpose) as string;
  }
  if (modelDefault) return modelDefault;
  return defaultModelFor(provider, purpose);
}

/**
 * Pick the provider, model, and credential for this workspace + purpose.
 *
 * Order: explicit override -> the workspace's selected provider -> any provider
 * the workspace stored a key for (oldest first) -> any provider with a server
 * env key. Returns null when nothing is configured, which is the caller's
 * signal to run its heuristic fallback.
 */
async function resolve(
  fastify: FastifyInstance,
  orgId: string,
  purpose: Purpose,
  overrideProvider?: Provider,
  overrideModel?: string
): Promise<(ResolvedLlm & { credential: string }) | null> {
  const state = await loadOrgLlmState(fastify, orgId);

  const candidates: Provider[] = [];
  const push = (p: Provider | null | undefined) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };
  push(overrideProvider);
  if (!overrideProvider) {
    push(state.settings.provider);
    for (const p of state.keys.keys()) push(p);
    for (const p of PROVIDERS) push(p);
  }

  for (const provider of candidates) {
    const stored = state.keys.get(provider);
    const credential = stored?.credential ?? envCredentialFor(provider);
    if (!credential) continue;
    return {
      provider,
      model: overrideModel || modelFor(state.settings, provider, purpose, stored?.modelDefault ?? null),
      source: stored ? "org" : "env",
      credential,
    };
  }
  return null;
}

/** What a workspace would use for a purpose right now (no credential returned). */
export async function resolveForPurpose(
  fastify: FastifyInstance,
  orgId: string,
  purpose: Purpose
): Promise<ResolvedLlm | null> {
  const r = await resolve(fastify, orgId, purpose);
  if (!r) return null;
  return { provider: r.provider, model: r.model, source: r.source };
}

// ── The public entry point ───────────────────────────────────────────
/**
 * Run one chat completion for a workspace. Returns null (never throws) when no
 * credential is configured or the provider call fails — callers fall back.
 */
export async function complete(args: CompleteArgs): Promise<CompletionResult | null> {
  const { fastify, orgId, purpose } = args;

  const messages = normalizeMessages(args.messages);
  if (messages.length === 0) {
    fastify.log.warn({ purpose }, "LLM completion skipped — no usable messages");
    return null;
  }

  let resolved: (ResolvedLlm & { credential: string }) | null = null;
  try {
    resolved = await resolve(fastify, orgId, purpose, args.provider, args.model);
  } catch (err) {
    fastify.log.warn({ err, purpose }, "LLM provider resolution failed");
    return null;
  }
  if (!resolved) return null;

  const request: ProviderRequest = {
    model: resolved.model,
    messages,
    maxTokens: clampTokens(args.maxTokens),
    timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.system ? { system: args.system } : {}),
    ...(args.temperature === undefined ? {} : { temperature: args.temperature }),
  };

  try {
    const result = await callProvider(resolved.provider, resolved.credential, request);
    if (!result.text.trim()) {
      fastify.log.warn({ provider: resolved.provider, model: resolved.model, purpose }, "LLM returned an empty completion");
      return null;
    }
    return result;
  } catch (err) {
    fastify.log.warn(
      {
        provider: resolved.provider,
        model: resolved.model,
        purpose,
        source: resolved.source,
        reason: scrubSecret(err instanceof Error ? err.message : String(err), resolved.credential),
      },
      "LLM completion failed — caller will fall back"
    );
    return null;
  }
}

/**
 * Cheap live call used to verify a credential before we store it. Returns the
 * provider's own error text (with the credential scrubbed) so the user can see
 * "invalid api key" vs "model not found" rather than a generic failure.
 */
export async function validateProviderKey(opts: {
  provider: Provider;
  credential: string;
  model?: string | null;
  timeoutMs?: number;
  // NOTE: deliberately a flat shape, not a discriminated union. Vercel's
  // TypeScript analyzer runs with different strictness than our tsconfig and
  // does not narrow `{ok:true}|{ok:false}` on `if (!x.ok)`, which fails the
  // deploy even though `tsc` is clean locally.
}): Promise<{ ok: boolean; model: string | null; error: string | null }> {
  const model = (opts.model ?? "").trim() || PROVIDER_INFO[opts.provider].fastModel;
  try {
    await callProvider(opts.provider, opts.credential, {
      model,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      timeoutMs: opts.timeoutMs ?? VALIDATE_TIMEOUT_MS,
      system: "Reply with the single word OK.",
    });
    return { ok: true, model, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model: null, error: scrubSecret(message, opts.credential).slice(0, 400) };
  }
}

/** Last 4 of the part of a credential that is safe to hint at. */
export function credentialHint(provider: Provider, credential: string): string {
  if (provider === "bedrock") {
    // Hint from the access key id, not the secret access key.
    const parsed = parseAwsCredential(credential);
    return keyHint(parsed?.accessKeyId ?? "");
  }
  return keyHint(credential);
}

// ── Wire layer ───────────────────────────────────────────────────────
interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  timeoutMs: number;
  system?: string;
  temperature?: number;
}

function clampTokens(n: number | undefined): number {
  const v = Math.floor(Number(n ?? DEFAULT_MAX_TOKENS));
  if (!Number.isFinite(v)) return DEFAULT_MAX_TOKENS;
  return Math.max(1, Math.min(v, 32_000));
}

/**
 * Providers disagree about message shape but agree on the constraints that
 * matter: start with a user turn, alternate roles. Enforce both here so no
 * caller has to know (the Copilot replays stored history, which can violate
 * either after a failed turn).
 */
function normalizeMessages(input: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of input ?? []) {
    const content = typeof m?.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    if (out.length === 0 && role !== "user") continue; // must open with a user turn
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
      continue;
    }
    out.push({ role, content });
  }
  // A trailing assistant turn would ask the model to continue its own message;
  // every caller here wants an answer to the last user turn.
  while (out.length > 0 && out[out.length - 1]?.role === "assistant") out.pop();
  return out;
}

class ProviderError extends Error {
  readonly status: number;
  constructor(provider: Provider, status: number, detail: string) {
    super(`${PROVIDER_INFO[provider].label} ${status ? `HTTP ${status}` : "request failed"}: ${detail}`);
    this.name = "ProviderError";
    this.status = status;
  }
}

async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  if (!body) return res.statusText || "no response body";
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const err = json.error;
    if (typeof err === "string") return err.slice(0, 300);
    if (err?.message) return err.message.slice(0, 300);
    if (json.message) return String(json.message).slice(0, 300);
  } catch {
    /* not JSON — fall through to the raw body */
  }
  return body.slice(0, 300);
}

function callProvider(provider: Provider, credential: string, req: ProviderRequest): Promise<CompletionResult> {
  switch (PROVIDER_INFO[provider].wire) {
    case "anthropic":
      return callAnthropic(provider, credential, req);
    case "google":
      return callGoogle(provider, credential, req);
    case "bedrock":
      return callBedrock(provider, credential, req);
    default:
      return callOpenAiCompatible(provider, credential, req);
  }
}

// Anthropic messages API.
interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callAnthropic(provider: Provider, apiKey: string, req: ProviderRequest): Promise<CompletionResult> {
  const res = await fetch(`${baseUrlFor(provider)}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await errorDetail(res));
  const json = (await res.json()) as AnthropicResponse;
  const text = (json.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
  return {
    text,
    model: req.model,
    provider,
    tokensIn: num(json.usage?.input_tokens),
    tokensOut: num(json.usage?.output_tokens),
  };
}

// OpenAI-compatible /chat/completions — openai, xai, deepseek, openrouter,
// moonshot, zhipu. Same body, different base URL.
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
}

/** OpenAI's reasoning models reject `max_tokens` and require `max_completion_tokens`. */
function usesMaxCompletionTokens(provider: Provider, model: string): boolean {
  return provider === "openai" && /^(o\d|gpt-5)/i.test(model);
}

async function callOpenAiCompatible(provider: Provider, apiKey: string, req: ProviderRequest): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  if (usesMaxCompletionTokens(provider, req.model)) body["max_completion_tokens"] = req.maxTokens;
  else body["max_tokens"] = req.maxTokens;
  // Reasoning models only accept the default temperature, so only send it when asked.
  if (req.temperature !== undefined && !usesMaxCompletionTokens(provider, req.model)) {
    body["temperature"] = req.temperature;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    // OpenRouter attributes usage to an app via these; harmless elsewhere.
    headers["HTTP-Referer"] = config.APP_URL;
    headers["X-Title"] = "Causal";
  }

  const res = await fetch(`${baseUrlFor(provider)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await errorDetail(res));
  const json = (await res.json()) as OpenAiResponse;
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => p?.text ?? "").join("")
      : "";
  const usage = json.usage ?? {};
  return {
    text,
    model: req.model,
    provider,
    tokensIn: num(usage.prompt_tokens ?? usage.input_tokens),
    tokensOut: num(usage.completion_tokens ?? usage.output_tokens),
  };
}

// Google Gemini generateContent.
interface GoogleResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

async function callGoogle(provider: Provider, apiKey: string, req: ProviderRequest): Promise<CompletionResult> {
  const model = req.model.replace(/^models\//, "");
  const res = await fetch(`${baseUrlFor(provider)}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Header rather than ?key= so the credential never lands in a URL log.
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      },
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await errorDetail(res));
  const json = (await res.json()) as GoogleResponse;
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("");
  return {
    text,
    model,
    provider,
    tokensIn: num(json.usageMetadata?.promptTokenCount),
    tokensOut: num(json.usageMetadata?.candidatesTokenCount),
  };
}

// AWS Bedrock — Converse API, signed with SigV4 by hand (no AWS SDK needed).
interface AwsCredential {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
}

interface BedrockConverseResponse {
  output?: { message?: { content?: Array<{ text?: string }> } };
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** `accessKeyId:secretAccessKey[:region[:sessionToken]]`, or a JSON object. */
function parseAwsCredential(raw: string): AwsCredential | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      const pick = (...names: string[]): string => {
        for (const n of names) {
          const v = o[n];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
        return "";
      };
      const accessKeyId = pick("accessKeyId", "access_key_id", "AWS_ACCESS_KEY_ID");
      const secretAccessKey = pick("secretAccessKey", "secret_access_key", "AWS_SECRET_ACCESS_KEY");
      if (!accessKeyId || !secretAccessKey) return null;
      const sessionToken = pick("sessionToken", "session_token", "AWS_SESSION_TOKEN");
      return {
        accessKeyId,
        secretAccessKey,
        region: pick("region", "AWS_REGION") || awsRegionFromEnv(),
        ...(sessionToken ? { sessionToken } : {}),
      };
    } catch {
      return null;
    }
  }
  const parts = trimmed.split(":").map((p) => p.trim());
  const accessKeyId = parts[0] ?? "";
  const secretAccessKey = parts[1] ?? "";
  if (!accessKeyId || !secretAccessKey) return null;
  const region = parts[2] ?? "";
  const sessionToken = parts[3] ?? "";
  return {
    accessKeyId,
    secretAccessKey,
    region: region || awsRegionFromEnv(),
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Minimal SigV4 for a JSON POST. Path segments are encoded twice in the
 * canonical request (AWS requires it for every service except S3) — Bedrock
 * model ids contain a colon, so getting this wrong is the difference between
 * a 200 and a SignatureDoesNotMatch.
 */
function signAwsRequest(opts: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  body: string;
  credential: AwsCredential;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260812T090000Z
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: opts.host,
    "x-amz-date": amzDate,
  };
  if (opts.credential.sessionToken) headers["x-amz-security-token"] = opts.credential.sessionToken;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${(headers[n] ?? "").trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");
  const payloadHash = sha256Hex(opts.body);
  const canonicalPath = opts.path.split("/").map((seg) => encodeURIComponent(seg)).join("/");

  const canonicalRequest = [
    opts.method,
    canonicalPath,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.credential.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${opts.credential.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function callBedrock(provider: Provider, credential: string, req: ProviderRequest): Promise<CompletionResult> {
  const creds = parseAwsCredential(credential);
  if (!creds) {
    throw new ProviderError(provider, 0, "credential must be accessKeyId:secretAccessKey[:region[:sessionToken]]");
  }
  // Converse (not InvokeModel) so the body is model-agnostic: Claude, Nova,
  // Llama and Mistral on Bedrock all take and return the same shape.
  const body = JSON.stringify({
    messages: req.messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
    ...(req.system ? { system: [{ text: req.system }] } : {}),
    inferenceConfig: {
      maxTokens: req.maxTokens,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    },
  });

  const host = `bedrock-runtime.${creds.region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(req.model)}/converse`;
  const headers = signAwsRequest({
    method: "POST",
    host,
    path,
    region: creds.region,
    service: "bedrock",
    body,
    credential: creds,
  });

  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await errorDetail(res));
  const json = (await res.json()) as BedrockConverseResponse;
  const text = (json.output?.message?.content ?? []).map((c) => c?.text ?? "").join("");
  return {
    text,
    model: req.model,
    provider,
    tokensIn: num(json.usage?.inputTokens),
    tokensOut: num(json.usage?.outputTokens),
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
