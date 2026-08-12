import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Symmetric encryption for secrets we must store and later replay verbatim —
 * today that means customer-supplied model-provider keys (BYOK).
 *
 * AES-256-GCM, keyed by CAUSAL_ENCRYPTION_KEY. GCM (not CBC) so a tampered
 * ciphertext fails authentication instead of decrypting to garbage that we
 * would then send to a provider as an API key.
 *
 * Envelope format: `v1:<base64( iv[12] | tag[16] | ciphertext )>`
 * The version prefix exists so a future rotation (v2, envelope/KMS-backed) can
 * be introduced without a data migration — the reader dispatches on it.
 *
 * RULE: nothing in this module ever logs, throws, or returns plaintext. Error
 * messages describe the *failure*, never the value.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce — the GCM standard, and what Node expects
const TAG_BYTES = 16;
const VERSION = "v1";

const MISSING_KEY_MESSAGE =
  "CAUSAL_ENCRYPTION_KEY is not set — provider keys cannot be stored or read. " +
  "Generate one with `openssl rand -base64 32` and set it in the API environment.";

const BAD_KEY_MESSAGE =
  "CAUSAL_ENCRYPTION_KEY must decode to exactly 32 bytes — use base64 (44 chars) " +
  "or hex (64 chars). Generate one with `openssl rand -base64 32`.";

let cachedKey: Buffer | null = null;

/** Decode the configured key material. Hex is checked first: 64 hex chars are also valid base64. */
function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const buf = Buffer.from(normalized, "base64");
    if (buf.length === 32) return buf;
  }
  throw new Error(BAD_KEY_MESSAGE);
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = config.CAUSAL_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) throw new Error(MISSING_KEY_MESSAGE);
  cachedKey = decodeKeyMaterial(raw);
  return cachedKey;
}

/**
 * True when a usable CAUSAL_ENCRYPTION_KEY is configured. Routes call this to
 * return a helpful 503 instead of letting a write blow up mid-request.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** The reason encryption is unavailable, for surfacing to an operator. Null when it works. */
export function encryptionUnavailableReason(): string | null {
  try {
    getKey();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : MISSING_KEY_MESSAGE;
  }
}

/** Encrypt a secret for storage. Throws (with a clear message) when unconfigured. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: refusing to encrypt an empty value");
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

/**
 * Decrypt a stored secret. Throws on a missing key, an unknown envelope
 * version, or a failed authentication tag — which is exactly what happens after
 * CAUSAL_ENCRYPTION_KEY is rotated, so callers must treat it as "no key
 * available" and fall back, never as a 500.
 */
export function decryptSecret(envelope: string): string {
  const key = getKey();
  const sep = envelope.indexOf(":");
  const version = sep === -1 ? "" : envelope.slice(0, sep);
  if (version !== VERSION) {
    throw new Error(`Stored secret has an unsupported envelope version (${version || "none"})`);
  }
  const raw = Buffer.from(envelope.slice(sep + 1), "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Stored secret is malformed (truncated envelope)");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Swallow the underlying error: it is always "unable to authenticate data",
    // and re-wrapping keeps any buffer contents out of logs.
    throw new Error(
      "Stored secret could not be decrypted — CAUSAL_ENCRYPTION_KEY has changed since it was saved. Re-enter the key."
    );
  }
}

/**
 * Last 4 characters of a secret, for display. Safe to store in the clear and to
 * return over the API — the same hint Stripe/OpenAI/GitHub show.
 */
export function keyHint(secret: string): string {
  const trimmed = (secret ?? "").trim();
  return trimmed.length <= 4 ? "" : trimmed.slice(-4);
}

/**
 * Replace a secret with `***` wherever it appears in text. Used before an
 * upstream error body reaches the log, in case a provider echoes the credential.
 */
export function scrubSecret(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("***");
}
