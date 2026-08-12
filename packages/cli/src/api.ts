/**
 * Thin fetch wrapper for the Causal API. Every failure becomes a
 * CausalCliError carrying the right exit code, so command code can stay linear.
 */

import { authError, CausalCliError, internalError, networkError, notFoundError, usageError } from "./errors.js";
import type { ResolvedConfig } from "./config.js";
import type { HealthResponse } from "./types.js";

const USER_AGENT = "@causal/cli/0.1.0";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiClientOptions {
  host: string;
  apiKey: string;
  orgId?: string | undefined;
  timeoutMs?: number;
}

export type Query = Record<string, string | number | boolean | undefined>;

export class ApiClient {
  readonly host: string;
  private readonly apiKey: string;
  private readonly orgId: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.host = options.host.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.orgId = options.orgId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromConfig(config: ResolvedConfig, timeoutMs?: number): ApiClient {
    return new ApiClient({
      host: config.host,
      apiKey: config.apiKey,
      orgId: config.orgId,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  /** Fail fast with an auth error when no credential is configured. */
  requireKey(): void {
    if (!this.apiKey) {
      throw authError(
        "no Causal API key configured",
        "Run `causal login`, or set CAUSAL_API_KEY in the environment."
      );
    }
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  private url(path: string, query?: Query): string {
    let url: URL;
    try {
      url = new URL(`${this.host}${path.startsWith("/") ? path : `/${path}`}`);
    } catch {
      throw usageError(
        `"${this.host}" is not a valid host URL`,
        "Pass a full URL, e.g. --host https://api.causal.dev"
      );
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; query?: Query; anonymous?: boolean } = {}
  ): Promise<T> {
    const url = this.url(path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { accept: "application/json", "user-agent": USER_AGENT };
    if (this.apiKey && !options.anonymous) headers["authorization"] = `Bearer ${this.apiKey}`;
    if (this.orgId) headers["x-causal-org-id"] = this.orgId;
    if (options.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw networkError(`request to ${this.host} timed out after ${this.timeoutMs}ms`);
      }
      throw networkError(
        `cannot reach ${this.host}: ${describeCause(err)}`,
        "Check that the API is running and that --host / CAUSAL_API_URL is correct."
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    if (!response.ok) throw httpError(response.status, text, method, path, this.host);

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw internalError(
        `${this.host}${path} returned a non-JSON body (HTTP ${response.status})`,
        "Is --host pointing at a Causal API?"
      );
    }
  }

  /** GET without the Authorization header — used to probe /api/v1/health. */
  getAnonymous<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query, anonymous: true });
  }
}

/**
 * `GET /api/v1/health` — unauthenticated on purpose (the route skips auth), so
 * it answers "is there a Causal API here?" separately from "is my key good?".
 */
export async function probeHealth(api: ApiClient): Promise<HealthResponse> {
  try {
    return await api.getAnonymous<HealthResponse>("/api/v1/health");
  } catch (err) {
    if (err instanceof CausalCliError && err.code === "not_found") {
      throw networkError(
        `no Causal API at ${api.host} (/api/v1/health returned 404)`,
        "Point --host / CAUSAL_API_URL at a Causal deployment."
      );
    }
    throw err;
  }
}

/**
 * Undici wraps connection failures: `fetch failed` on the outside, the useful
 * code (ECONNREFUSED, ENOTFOUND, …) on `cause`, sometimes one level deeper
 * inside an AggregateError. Dig out the most specific thing available.
 */
function describeCause(err: unknown): string {
  const describe = (candidate: unknown, depth: number): string => {
    if (!(candidate instanceof Error) || depth > 3) return "";
    const code = (candidate as Error & { code?: string }).code;
    const message = candidate.message.trim();
    if (code && message) return `${code} (${message})`;
    if (code) return code;
    if (message) return message;
    const nested = (candidate as Error & { errors?: unknown[] }).errors;
    return Array.isArray(nested) ? describe(nested[0], depth + 1) : "";
  };

  if (!(err instanceof Error)) return String(err);
  return (
    describe((err as Error & { cause?: unknown }).cause, 0) ||
    err.message.trim() ||
    "connection failed"
  );
}

/** Pull the most useful message out of a Fastify error body. */
function extractMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const message = parsed["message"] ?? parsed["error"];
    if (typeof message === "string") return message;
  } catch {
    /* not JSON — fall through to the raw body */
  }
  return body.slice(0, 300).replace(/\s+/g, " ").trim();
}

function httpError(status: number, body: string, method: string, path: string, host: string): CausalCliError {
  const detail = extractMessage(body);
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) {
    return authError(
      `API key rejected by ${host}${suffix}`,
      "Run `causal login` with a valid key, or check CAUSAL_API_KEY."
    );
  }
  if (status === 404) {
    return notFoundError(`not found — ${method} ${path}${suffix}`);
  }
  if (status === 400 || status === 422) {
    return usageError(`request rejected${suffix}`);
  }
  if (status === 429) {
    return internalError(`rate limited by ${host}${suffix}`, "Wait a moment and retry.");
  }
  return internalError(`API error ${status} on ${method} ${path}${suffix}`);
}
