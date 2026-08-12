-- ── Causal v2.3: BYOK — bring your own model provider ────────────────
-- Until now the judge/RCA/copilot were hardcoded to one Anthropic key held by
-- the server, which makes the product unsellable to anyone who (a) already has
-- provider credits, (b) is contractually pinned to a specific vendor, or (c)
-- runs models in their own AWS account. This migration adds per-workspace keys
-- and per-purpose model selection.
--
-- DESIGN
--
-- 1. Two tables, deliberately.
--    `provider_keys`      = the credential (one per org per provider).
--    `org_llm_settings`   = the *choice* (which provider, which model per
--                           purpose). Keeping them apart means you can rotate a
--                           key without touching model selection, and you can
--                           point at a provider whose key comes from the server
--                           env (no row here at all).
--
-- 2. The key is encrypted in the application, not by Postgres.
--    `encrypted_key` holds an AES-256-GCM envelope produced by
--    apps/api/src/services/crypto.ts (`v1:<base64 iv|tag|ciphertext>`), keyed by
--    the CAUSAL_ENCRYPTION_KEY env var. Rationale: pgcrypto would put the
--    plaintext and the encryption key in the same place a SQL-injection or a
--    leaked read-replica dump can reach, and managed Postgres (Neon/Supabase)
--    logs statement text. App-side encryption means a database dump is inert
--    without the API's env. Consequence: rotating CAUSAL_ENCRYPTION_KEY
--    invalidates every stored key — decryption fails closed, the API falls back
--    to the server env key or the heuristic path, and the workspace re-enters
--    its key. That is the intended failure mode; it is never a 500.
--
-- 3. `key_hint` is the last 4 characters, stored in the clear on purpose.
--    The UI must be able to show "sk-…f39a" so a user can tell which key is
--    installed, and the plaintext must never leave the API. Four characters is
--    not enough to be useful to an attacker and is the industry norm
--    (Stripe/OpenAI/GitHub all do exactly this).
--
-- 4. UNIQUE (org_id, provider) — one credential per provider per workspace, so
--    PUT /providers/:provider is a clean upsert and there is never ambiguity
--    about which key a completion used.
--
-- 5. Resolution order implemented by services/llm.ts:
--      explicit override -> org_llm_settings.provider -> org's stored keys
--      -> server env key -> null (caller uses its heuristic fallback).
--    Nothing here is NOT NULL that would force a workspace to configure BYOK;
--    an org with no rows behaves exactly as it did before this migration.
--
-- 6. `bedrock` is included in the provider list: the credential column holds
--    `accessKeyId:secretAccessKey[:region[:sessionToken]]` (or a JSON object),
--    encrypted the same way, and llm.ts signs SigV4 itself.

-- The nine providers the API can speak to. Kept as a CHECK rather than an enum
-- type so adding a provider is a one-line ALTER, not a type migration.
CREATE TABLE IF NOT EXISTS provider_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN (
                  'anthropic','openai','google','xai','deepseek',
                  'openrouter','moonshot','zhipu','bedrock')),
  -- AES-256-GCM envelope: "v1:<base64(iv|tag|ciphertext)>". Never a plaintext key.
  encrypted_key TEXT NOT NULL,
  -- Last 4 chars of the credential, for display only.
  key_hint      TEXT NOT NULL DEFAULT '',
  -- Optional per-provider default model, used when no per-purpose model is set.
  model_default TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

-- Every read is "all providers for this org", ordered oldest-first so the
-- fallback pick is deterministic across requests.
CREATE INDEX IF NOT EXISTS idx_provider_keys_org ON provider_keys (org_id, created_at ASC);

CREATE TABLE IF NOT EXISTS org_llm_settings (
  org_id         TEXT PRIMARY KEY,
  -- Active provider for this workspace. NULL = let llm.ts pick the first
  -- configured key (org first, then the server env).
  provider       TEXT CHECK (provider IN (
                   'anthropic','openai','google','xai','deepseek',
                   'openrouter','moonshot','zhipu','bedrock')),
  -- Per-purpose model ids. NULL = provider default (see PROVIDER_INFO in
  -- services/llm.ts). Detector runs on every ingest, so it usually wants the
  -- cheap/fast model; RCA and Copilot want the strong one.
  detector_model TEXT,
  rca_model      TEXT,
  copilot_model  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent re-runs of this migration must not clobber an existing config.
INSERT INTO org_llm_settings (org_id, provider)
VALUES ('org_demo_causal_001', 'anthropic')
ON CONFLICT (org_id) DO NOTHING;
