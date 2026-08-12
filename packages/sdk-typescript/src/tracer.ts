/**
 * Causal tracer — capture agent runs as traces of spans and export them to the
 * Causal ingest endpoint (`POST /api/v1/traces`). Dependency-free; uses the
 * global `fetch` (Node 18+).
 *
 * Usage:
 *   const tracer = new CausalTracer({ service: "booking-agent" });
 *   await tracer.trace("booking_agent.run", async (t) => {
 *     const plan = t.span("llm.plan", "llm");
 *     // ... call the model ...
 *     plan.end({ status: "ok", io: { input, output } });
 *   });
 *
 * Telemetry never breaks the host app:
 *   - a missing API key degrades to a no-op export (nothing is sent, nothing
 *     throws),
 *   - `trace()` records an error, flushes, and re-throws the caller's error,
 *   - oversized payloads have their `io` truncated instead of being rejected,
 *   - exports retry transient failures (429 / 5xx / network) with backoff.
 *
 * Spans nest automatically via the ambient context (see `context.ts`):
 * `t.span(name, kind)` hangs off whatever span is currently running. Pass an
 * explicit `parentId` — including `null` for "attach to the trace root" — to
 * override it.
 */

import { webcrypto } from "node:crypto";
// `context.ts` imports only types from this module, so there is no runtime cycle.
import { getCurrentSpan, getCurrentTrace, runWithTrace } from "./context.js";

export type SpanKind =
  | "agent"
  | "llm"
  | "tool"
  | "http"
  | "db"
  | "function"
  | "skill"
  | "workflow"
  | "search"
  | "shell";
export type SpanStatus = "ok" | "warn" | "error";

export interface CausalTracerOptions {
  service: string;
  apiKey?: string;
  baseUrl?: string;
  orgId?: string;
  environment?: string;
  model?: string;
  repo?: string;
  gitRef?: string;
  user?: string;
  sessionId?: string;
  metadata?: { label: string; value: string }[];
  /** Timeout for a single export attempt, in ms. Default 10000. */
  timeoutMs?: number;
  /** Total export attempts, retries included (1 disables retrying). Default 3. */
  maxRetries?: number;
  /** Backoff before the second attempt, doubled each time after. Default 250ms. */
  retryDelayMs?: number;
  /** Hard cap on the serialized body. Span `io` is truncated until the payload
   *  fits rather than letting the export fail. Default 900_000 (the API's
   *  default body limit is 1 MiB). */
  maxPayloadBytes?: number;
}

export interface SpanEndOptions {
  status?: SpanStatus;
  error?: string;
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
  /** LLM economics. Recorded per span and rolled up to the trace on ingest. */
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
}

interface RecordedSpan {
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  error?: string;
}

const SDK_VERSION = "0.1.0";
/** Ingest rejects payloads over 2000 spans — stop recording before we get there. */
const MAX_SPANS = 2000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 900_000;
/** Successively tighter caps applied to span `io` when a payload is oversized. */
const IO_TRUNCATION_STEPS = [4000, 1000, 200, 0];
/** Transient statuses: rate limits, request timeouts, and server-side failures. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const cryptoApi: Crypto = globalThis.crypto ?? (webcrypto as unknown as Crypto);

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  cryptoApi.getRandomValues(buf);
  let out = "";
  for (const byte of buf) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** 128-bit trace id, W3C trace-context shaped (32 lowercase hex chars). */
function genTraceId(): string {
  return typeof cryptoApi.randomUUID === "function"
    ? cryptoApi.randomUUID().replace(/-/g, "")
    : randomHex(16);
}

/** 64-bit span id, W3C trace-context shaped (16 lowercase hex chars). */
function genSpanId(): string {
  return randomHex(8);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function byteLength(text: string): number {
  return typeof Buffer !== "undefined" ? Buffer.byteLength(text, "utf8") : new TextEncoder().encode(text).length;
}

/** In-flight exports, so `flushOnExit()` can wait for work already started. */
const inFlight = new Set<Promise<void>>();

/** Track an export without ever creating an unhandled rejection. */
function track(promise: Promise<void>): Promise<void> {
  const settled = promise.then(
    () => undefined,
    () => undefined
  );
  inFlight.add(settled);
  void settled.finally(() => {
    inFlight.delete(settled);
  });
  return promise;
}

let warnedMissingKey = false;
function warnMissingApiKey(): void {
  if (warnedMissingKey) return;
  warnedMissingKey = true;
  console.warn("[causal] CAUSAL_API_KEY is not set — traces are recorded locally but not exported.");
}

export class CausalSpan {
  private readonly startedAt = Date.now();
  private ended = false;
  constructor(
    private readonly rec: RecordedSpan,
    /** The trace this span belongs to. */
    readonly trace: CausalTrace,
    /** `false` for a span past the ingest ceiling: usable, never exported. */
    private readonly recorded: boolean = true
  ) {}
  get id(): string {
    return this.rec.id;
  }
  get name(): string {
    return this.rec.name;
  }
  get kind(): SpanKind {
    return this.rec.kind;
  }
  /** Create a child span nested under this one. */
  child(name: string, kind: SpanKind): CausalSpan {
    return this.trace.span(name, kind, this.rec.id);
  }
  end(opts: SpanEndOptions = {}): void {
    if (this.ended) return;
    this.ended = true;
    this.rec.durationMs = Math.max(0, Date.now() - this.startedAt);
    this.rec.status = opts.status ?? "ok";
    if (opts.attributes) this.rec.attributes = opts.attributes;
    if (opts.io) this.rec.io = opts.io;
    if (opts.git) this.rec.git = opts.git;
    if (opts.tokensIn !== undefined) this.rec.tokensIn = opts.tokensIn;
    if (opts.tokensOut !== undefined) this.rec.tokensOut = opts.tokensOut;
    if (opts.cost !== undefined) this.rec.cost = opts.cost;
    if (opts.error) {
      this.rec.error = opts.error;
      if (!opts.status) this.rec.status = "error";
    }
    if (this.recorded) this.trace.touch();
  }
}

export class CausalTrace {
  readonly traceId: string;
  private readonly start: number;
  private readonly spans: RecordedSpan[] = [];
  private dropped = 0;
  /** Set whenever a span is opened or ended; cleared by a successful export. */
  private dirty = true;
  tokensIn = 0;
  tokensOut = 0;
  cost = 0;

  constructor(
    private readonly tracer: CausalTracer,
    traceId?: string,
    /** `false` builds a trace that records nothing — the SDK's fail-open sink. */
    private readonly recording: boolean = true
  ) {
    this.traceId = traceId ?? genTraceId();
    this.start = Date.now();
  }

  /** Spans recorded so far. */
  get spanCount(): number {
    return this.spans.length;
  }

  /** Spans handed out but never recorded — past the ingest ceiling of 2000, or
   *  opened on a detached trace. */
  get droppedSpanCount(): number {
    return this.dropped;
  }

  /** Open a span. Omit `parentId` to nest under the span that is currently
   *  running (see `context.ts`); pass `null` to attach it to the trace root. */
  span(name: string, kind: SpanKind = "function", parentId?: string | null): CausalSpan {
    const rec: RecordedSpan = {
      id: genSpanId(),
      parentId: parentId === undefined ? this.ambientParentId() : parentId,
      name,
      kind,
      startMs: Math.max(0, Date.now() - this.start),
      durationMs: 0,
      status: "ok",
    };
    // Past the ceiling the span still works — it is simply never exported, so a
    // runaway loop costs nothing instead of getting the whole trace rejected.
    if (!this.recording || this.spans.length >= MAX_SPANS) {
      this.dropped++;
      return new CausalSpan(rec, this, false);
    }
    this.spans.push(rec);
    this.dirty = true;
    return new CausalSpan(rec, this);
  }

  /** The current span, but only when it belongs to this trace — a span id from
   *  another trace would be a dangling parent on ingest. */
  private ambientParentId(): string | null {
    if (getCurrentTrace() !== this) return null;
    return getCurrentSpan()?.id ?? null;
  }

  /** @internal Mark the trace as having unexported changes. */
  touch(): void {
    this.dirty = true;
  }

  /** Ship the trace to Causal. Safe to call once at the end of a run, and safe
   *  to call again: a trace with nothing new since its last successful export
   *  is a no-op. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await track(this.tracer.export(this));
    } catch (err) {
      this.dirty = true; // let a later flush (or flushOnExit) try again
      throw err;
    }
  }

  toPayload(): Record<string, unknown> {
    return {
      traceId: this.traceId,
      service: this.tracer.service,
      environment: this.tracer.environment,
      model: this.tracer.model,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cost: this.cost,
      repo: this.tracer.repo,
      gitRef: this.tracer.gitRef,
      user: this.tracer.user,
      sessionId: this.tracer.sessionId,
      metadata: this.tracer.metadata,
      startedAt: new Date(this.start).toISOString(),
      spans: this.spans.map((s) => ({ ...s })),
    };
  }
}

export class CausalTracer {
  readonly service: string;
  readonly environment: string;
  readonly model?: string;
  readonly repo?: string;
  readonly gitRef?: string;
  readonly user?: string;
  readonly sessionId?: string;
  readonly metadata?: { label: string; value: string }[];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxPayloadBytes: number;

  constructor(opts: CausalTracerOptions) {
    this.service = opts.service;
    this.environment = opts.environment ?? "production";
    this.model = opts.model;
    this.repo = opts.repo;
    this.gitRef = opts.gitRef;
    this.user = opts.user;
    this.sessionId = opts.sessionId;
    this.metadata = opts.metadata;
    this.apiKey = opts.apiKey ?? process.env["CAUSAL_API_KEY"] ?? "";
    this.baseUrl = (opts.baseUrl ?? process.env["CAUSAL_API_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
    this.orgId = opts.orgId ?? process.env["CAUSAL_ORG_ID"] ?? "default";
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(1, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Math.max(0, opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.maxPayloadBytes = Math.max(1024, opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES);
  }

  startTrace(traceId?: string): CausalTrace {
    return new CausalTrace(this, traceId);
  }

  /** Run `fn` as a single traced run: opens a root agent span, times it, makes
   *  the trace and root ambient (so nested spans and `observe()` attach
   *  themselves), and flushes on completion — even on error. */
  async trace<T>(name: string, fn: (t: CausalTrace, root: CausalSpan) => Promise<T>): Promise<T> {
    const t = this.startTrace();
    const root = t.span(name, "agent", null);
    try {
      const out = await runWithTrace(t, root, () => fn(t, root));
      root.end({ status: "ok" });
      return out;
    } catch (err) {
      root.end({ status: "error", error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      try {
        await t.flush();
      } catch {
        // never let telemetry break the agent
      }
    }
  }

  /** POST the trace, retrying transient failures. Throws only after the last
   *  attempt fails — `trace()` swallows that, manual callers may not want to. */
  async export(t: CausalTrace): Promise<void> {
    if (!this.apiKey) {
      // Fail open: without a key every request is a guaranteed 401, so skip the
      // round trip entirely rather than hammering the API from a hot path.
      warnMissingApiKey();
      return;
    }

    const body = this.serializePayload(t.toPayload());
    let lastError = new Error("Causal trace export failed");
    let delay = this.retryDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const outcome = await this.attemptExport(body);
      if (outcome.ok) return;
      lastError = outcome.error;
      if (!outcome.retryable || attempt === this.maxRetries) break;
      const wait = Math.min(outcome.retryAfterMs ?? delay, MAX_RETRY_DELAY_MS);
      // Jitter keeps a fleet of agents from retrying in lockstep.
      await sleep(wait === 0 ? 0 : wait * (0.75 + Math.random() * 0.5));
      delay *= 2;
    }

    throw lastError;
  }

  private async attemptExport(
    body: string
  ): Promise<{ ok: true } | { ok: false; retryable: boolean; error: Error; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/traces`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "x-causal-org-id": this.orgId,
          "user-agent": `@causal/sdk/${SDK_VERSION}`,
        },
        body,
        signal: controller.signal,
      });
      // Always drain the body so the socket can be reused.
      const text = await res.text().catch(() => "");
      if (res.ok) return { ok: true };
      const detail = text ? ` ${text.slice(0, 200)}` : "";
      return {
        ok: false,
        retryable: RETRYABLE_STATUS.has(res.status) || res.status >= 500,
        error: new Error(`Causal trace export failed: ${res.status}${detail}`),
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const timedOut = error.name === "AbortError" || error.name === "TimeoutError";
      return {
        ok: false,
        retryable: true, // network error or timeout — both are worth another go
        error: timedOut ? new Error(`Causal trace export timed out after ${this.timeoutMs}ms`) : error,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Serialize the payload, shrinking span `io` until it fits the byte cap. A
   *  trace with truncated prompts beats no trace at all. */
  private serializePayload(payload: Record<string, unknown>): string {
    let body = JSON.stringify(payload);
    if (byteLength(body) <= this.maxPayloadBytes) return body;
    for (const cap of IO_TRUNCATION_STEPS) {
      body = JSON.stringify(capSpanIo(payload, cap));
      if (byteLength(body) <= this.maxPayloadBytes) return body;
    }
    return body; // best effort: everything capturable is already gone
  }
}

/** Truncate every span's `io` to `cap` characters per field; `cap === 0` drops
 *  `io` altogether. Returns a copy — the recorded spans are left intact. */
function capSpanIo(payload: Record<string, unknown>, cap: number): Record<string, unknown> {
  const spans = Array.isArray(payload["spans"]) ? (payload["spans"] as RecordedSpan[]) : [];
  return {
    ...payload,
    spans: spans.map((s) => {
      if (!s.io) return s;
      const copy: RecordedSpan = { ...s };
      if (cap === 0) {
        delete copy.io;
        return copy;
      }
      const io: { input?: string; output?: string } = {};
      if (s.io.input !== undefined) io.input = capText(s.io.input, cap);
      if (s.io.output !== undefined) io.output = capText(s.io.output, cap);
      copy.io = io;
      return copy;
    }),
  };
}

function capText(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}…[truncated]`;
}

/** `Retry-After` in ms — seconds or an HTTP date, per RFC 9110. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** A trace that records nothing and is never exported. The SDK hands spans from
 *  it to user callbacks when tracing itself is unavailable, so instrumented
 *  code never has to null-check. Constructed without touching `process.env`. */
let detached: CausalTrace | undefined;
export function detachedSpan(name: string, kind: SpanKind = "function"): CausalSpan {
  detached ??= new CausalTrace(
    new CausalTracer({ service: "causal.detached", apiKey: "", baseUrl: "", orgId: "" }),
    undefined,
    false
  );
  return detached.span(name, kind, null);
}

export interface FlushOnExitOptions {
  /** Traces to flush before the process leaves. */
  traces?: CausalTrace[];
  /** Cap on how long shutdown may block on telemetry. Default 3000ms. */
  timeoutMs?: number;
  /** Signals to hook. Default `["SIGTERM", "SIGINT"]`. */
  signals?: NodeJS.Signals[];
}

/** Flush before a short-lived process exits: drains exports already in flight
 *  and flushes the traces you hand it, on `beforeExit` and on SIGTERM/SIGINT.
 *
 *    const t = tracer.startTrace();
 *    flushOnExit(t);
 *
 *  Signals stay the process's own: after draining, the handler removes itself
 *  and re-raises the signal only when nothing else is listening. Returns an
 *  unregister function. */
export function flushOnExit(target?: CausalTrace | CausalTrace[] | FlushOnExitOptions): () => void {
  const options: FlushOnExitOptions =
    target instanceof CausalTrace
      ? { traces: [target] }
      : Array.isArray(target)
        ? { traces: target }
        : (target ?? {});
  const traces = options.traces ?? [];
  const timeoutMs = options.timeoutMs ?? 3_000;
  const signals: NodeJS.Signals[] = options.signals ?? ["SIGTERM", "SIGINT"];
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      const work = [...traces.map((t) => t.flush().catch(() => undefined)), ...inFlight];
      await withTimeout(Promise.all(work), timeoutMs);
    } catch {
      // shutdown must never fail because telemetry did
    } finally {
      draining = false;
    }
  };

  const onBeforeExit = (): void => {
    void drain();
  };
  const handlers = new Map<NodeJS.Signals, () => void>();

  const dispose = (): void => {
    process.off("beforeExit", onBeforeExit);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    handlers.clear();
  };

  for (const signal of signals) {
    const handler = (): void => {
      void drain().then(() => {
        dispose();
        // Nobody else is handling it, so restore the default: re-raise so the
        // process actually terminates.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.on("beforeExit", onBeforeExit);

  return dispose;
}

async function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: unknown;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        // the guard must not keep a finished process alive
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer as Parameters<typeof clearTimeout>[0]);
  }
}
