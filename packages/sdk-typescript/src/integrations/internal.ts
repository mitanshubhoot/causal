/**
 * Shared plumbing for the Causal provider integrations: span targeting, model
 * pricing, usage extraction, safe stringification and stream instrumentation.
 *
 * Nothing in this module imports a provider SDK and nothing in it throws —
 * telemetry must never be the reason a host application fails. Every helper
 * that touches user data or the tracer swallows its own errors and degrades to
 * a no-op.
 */

import type { CausalSpan, CausalTrace, CausalTracer, SpanEndOptions, SpanKind } from "../tracer.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- proxy plumbing is inherently untyped */
type AnyFn = (...args: any[]) => any;

/** Anything a wrapper can hang its spans off. */
export type SpanTarget = CausalTracer | CausalTrace | CausalSpan;

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  /** Price per 1M input (prompt) tokens. */
  in: number;
  /** Price per 1M output (completion) tokens. */
  out: number;
}

export interface WrapOptions {
  /** Nest emitted spans under this span instead of hanging them off the trace root. */
  parent?: CausalSpan;
  /** Record prompt/completion text in `span.io`. Default `true`. */
  captureIo?: boolean;
  /** Truncate each side of `span.io` to this many characters. Default 4000. */
  maxIoChars?: number;
  /** Extra per-1M-token prices, merged over (and winning against) the built-in table. */
  prices?: Record<string, ModelPrice>;
  /** Override the span name. Defaults to the provider method it wraps. */
  spanName?: string;
}

/**
 * Per-1M-token list prices, USD. Deliberately small: enough to cost the models
 * teams actually ship, with a safe default of 0 for everything else so an
 * unknown model reports honest zero cost instead of a wrong number.
 *
 * Keys are matched by longest prefix, so dated snapshots resolve too
 * (`gpt-4o-2024-08-06` -> `gpt-4o`, `claude-sonnet-4-5-20250929` -> `claude-sonnet-4-5`).
 * Pass `prices` in `WrapOptions` to override or extend.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ── OpenAI ────────────────────────────────────────────────────────
  "gpt-5": { in: 1.25, out: 10.0 },
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5-nano": { in: 0.05, out: 0.4 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4-turbo": { in: 10.0, out: 30.0 },
  "gpt-3.5-turbo": { in: 0.5, out: 1.5 },
  o3: { in: 2.0, out: 8.0 },
  "o3-mini": { in: 1.1, out: 4.4 },
  "o4-mini": { in: 1.1, out: 4.4 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },

  // ── Anthropic ─────────────────────────────────────────────────────
  "claude-fable-5": { in: 10.0, out: 50.0 },
  "claude-mythos-5": { in: 10.0, out: 50.0 },
  "claude-opus-5": { in: 5.0, out: 25.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-opus-4-7": { in: 5.0, out: 25.0 },
  "claude-opus-4-6": { in: 5.0, out: 25.0 },
  "claude-opus-4-5": { in: 5.0, out: 25.0 },
  "claude-opus-4-1": { in: 15.0, out: 75.0 },
  "claude-opus-4-0": { in: 15.0, out: 75.0 },
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-0": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },

  // ── Google ────────────────────────────────────────────────────────
  "gemini-2.5-pro": { in: 1.25, out: 10.0 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
};

const ZERO_PRICE: ModelPrice = { in: 0, out: 0 };

/**
 * Strip the gateway/region decoration providers bolt onto model ids so the
 * price table matches: `openai/gpt-4o`, `us.anthropic.claude-opus-5`,
 * `claude-opus-4-5@20251101` and `models/gemini-2.5-pro` all normalise.
 */
function normalizeModel(model: string): string {
  let id = model.trim().toLowerCase();
  const slash = id.lastIndexOf("/");
  if (slash >= 0) id = id.slice(slash + 1);
  id = id.replace(/^(?:us|eu|apac|global)\./, "").replace(/^anthropic\./, "");
  const at = id.indexOf("@");
  if (at > 0) id = id.slice(0, at);
  return id;
}

/** Look up per-1M-token pricing. Unknown models price at 0 — never a guess. */
export function priceFor(model: string | undefined, overrides?: Record<string, ModelPrice>): ModelPrice {
  if (!model) return ZERO_PRICE;
  const id = normalizeModel(model);
  const table = overrides ? { ...MODEL_PRICES, ...overrides } : MODEL_PRICES;
  const exact = table[id];
  if (exact) return exact;
  let best: ModelPrice | undefined;
  let bestLen = 0;
  for (const [key, price] of Object.entries(table)) {
    if (key.length > bestLen && id.startsWith(key)) {
      best = price;
      bestLen = key.length;
    }
  }
  return best ?? ZERO_PRICE;
}

/** Round to 8dp so float noise never reaches the ingest endpoint. */
export function roundCost(cost: number): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return Math.round(cost * 1e8) / 1e8;
}

/** Straight in/out cost. Providers with cache tiers compute their own. */
export function estimateCost(
  model: string | undefined,
  tokensIn: number,
  tokensOut: number,
  overrides?: Record<string, ModelPrice>
): number {
  const price = priceFor(model, overrides);
  return roundCost((tokensIn * price.in + tokensOut * price.out) / 1_000_000);
}

/* ── span targeting ─────────────────────────────────────────────────── */

/** A span the integration owns, plus the flush it may owe. */
export interface SpanHandle {
  /** Span id, or `null` when the target could not be resolved (no-op handle). */
  readonly id: string | null;
  /** End the span. Safe to call more than once; never throws. */
  end(opts: SpanEndOptions): void;
  /** Flush the trace, but only if this handle created it. Never throws. */
  finish(): Promise<void>;
}

const NOOP_HANDLE: SpanHandle = {
  id: null,
  end() {
    /* no target — drop the span */
  },
  async finish() {
    /* nothing to flush */
  },
};

function handleFor(span: CausalSpan, owned?: CausalTrace): SpanHandle {
  return {
    id: span.id,
    end(opts: SpanEndOptions) {
      try {
        span.end(opts);
      } catch {
        // telemetry never breaks the caller
      }
    },
    async finish() {
      if (!owned) return;
      try {
        await owned.flush();
      } catch {
        // an unreachable collector is not the host app's problem
      }
    },
  };
}

/**
 * Open a span against whatever the caller handed us.
 *
 * - a `CausalSpan`   -> a child of that span
 * - a `CausalTrace`  -> a span on that trace, nested under whatever span is
 *                       currently running (see `context.ts`)
 * - a `CausalTracer` -> a fresh one-span trace, flushed when the call finishes
 *
 * `parentId` is deliberately omitted rather than passed as `null` so an
 * instrumented client called inside `observe()` / `runWithSpan()` nests under
 * the enclosing span instead of jumping to the trace root.
 *
 * Returns a no-op handle rather than throwing when the target is unusable, so
 * a mis-wired integration degrades to "no telemetry", never to "broken app".
 */
export function openSpan(
  target: SpanTarget | undefined,
  name: string,
  kind: SpanKind,
  parent?: CausalSpan
): SpanHandle {
  try {
    if (parent && typeof parent.child === "function") return handleFor(parent.child(name, kind));
    if (!target || typeof target !== "object") return NOOP_HANDLE;
    const duck = target as unknown as Record<string, unknown>;
    if (typeof duck["child"] === "function") return handleFor((target as CausalSpan).child(name, kind));
    if (typeof duck["span"] === "function") return handleFor((target as CausalTrace).span(name, kind));
    if (typeof duck["startTrace"] === "function") {
      const trace = (target as CausalTracer).startTrace();
      return handleFor(trace.span(name, kind), trace);
    }
  } catch {
    // fall through to the no-op handle
  }
  return NOOP_HANDLE;
}

/* ── value helpers ──────────────────────────────────────────────────── */

/** Read a property off an unknown value without assuming its shape. */
export function pick(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Read a nested path off an unknown value. */
export function pickPath(value: unknown, ...keys: string[]): unknown {
  let cursor = value;
  for (const key of keys) {
    cursor = pick(cursor, key);
    if (cursor === undefined || cursor === null) return undefined;
  }
  return cursor;
}

/** Finite numbers only — `NaN`, `Infinity` and non-numbers become `undefined`. */
export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/** Non-empty strings only. */
export function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/** JSON with circular-reference and bigint protection; never throws. */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key: string, val: unknown) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[circular]";
          seen.add(val);
        }
        return val;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

/** Clip long prompts/completions so a trace payload stays sane. */
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/** Build the `{label, value}[]` attribute shape, dropping empty entries. */
export function attrs(record: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [label, value] of Object.entries(record)) {
    if (value === undefined || value === null || value === "") continue;
    out.push({ label, value: typeof value === "string" ? value : String(value) });
  }
  return out;
}

/** Human-readable message for anything that lands in a `catch`. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  return stringify(err) || "unknown error";
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === "function"
  );
}

/* ── proxy plumbing ─────────────────────────────────────────────────── */

/**
 * Return a Proxy over `root` that replaces the method at `path` with
 * `wrap(original)`, leaving every other property alone.
 *
 * Proxying rather than monkey-patching means the caller's client object is
 * never mutated, so an un-instrumented reference to the same client keeps
 * working and two tracers can wrap the same client independently.
 */
export function proxyPath<T extends object>(root: T, path: readonly string[], wrap: (orig: AnyFn) => AnyFn): T {
  const head = path[0];
  if (head === undefined) return root;
  const rest = path.slice(1);
  return new Proxy(root, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;

      // Proxy invariant: a non-configurable, non-writable own data property
      // must be reported verbatim. Never rewrite one.
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc && desc.configurable === false && desc.writable === false) return value;

      if (prop !== head) {
        return typeof value === "function" ? (value as AnyFn).bind(target) : value;
      }
      if (rest.length === 0) {
        return typeof value === "function" ? wrap((value as AnyFn).bind(target)) : value;
      }
      if (typeof value !== "object" || value === null) return value;
      return proxyPath(value as object, rest, wrap);
    },
  });
}

/**
 * Return a Proxy over a provider stream that tees every chunk to `onChunk` and
 * calls `onDone` exactly once — on completion, on error, or when the consumer
 * breaks out of the loop early. Everything else on the stream object
 * (`.controller`, `.tee()`, `.toReadableStream()`) passes straight through.
 */
export function traceStream<T>(
  stream: object,
  onChunk: (chunk: T) => void,
  onDone: (err?: unknown) => void
): object {
  let settled = false;
  const done = (err?: unknown): void => {
    if (settled) return;
    settled = true;
    try {
      onDone(err);
    } catch {
      // never let bookkeeping break the stream
    }
  };

  async function* iterate(): AsyncGenerator<T> {
    try {
      for await (const chunk of stream as AsyncIterable<T>) {
        try {
          onChunk(chunk);
        } catch {
          // a malformed chunk must not stop the stream
        }
        yield chunk;
      }
      done();
    } catch (err) {
      done(err);
      throw err;
    } finally {
      // covers `break` / `return` out of the consumer's for-await loop
      done();
    }
  }

  return new Proxy(stream, {
    get(target, prop) {
      if (prop === Symbol.asyncIterator) return () => iterate();
      const value = Reflect.get(target, prop, target) as unknown;
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc && desc.configurable === false && desc.writable === false) return value;
      return typeof value === "function" ? (value as AnyFn).bind(target) : value;
    },
  });
}

/* ── io capture ─────────────────────────────────────────────────────── */

/** Build the `io` payload honouring `captureIo` / `maxIoChars`. */
export function buildIo(
  options: WrapOptions,
  input: string,
  output: string
): { input?: string; output?: string } | undefined {
  if (options.captureIo === false) return undefined;
  const max = options.maxIoChars ?? 4000;
  const io: { input?: string; output?: string } = {};
  if (input) io.input = truncate(input, max);
  if (output) io.output = truncate(output, max);
  return io.input || io.output ? io : undefined;
}
