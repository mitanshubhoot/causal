/**
 * `observe()` — one line of instrumentation per step, no plumbing.
 *
 *   const rows = await observe("db.lookup", { input: sql }, () => db.query(sql));
 *
 * It opens a span on the ambient trace (see `context.ts`), so it nests under
 * whatever is running; outside a traced run it starts a trace of its own and
 * flushes it. It infers the span kind from the name, captures input/output
 * truncated to ~2000 chars with secret-looking keys redacted, and records
 * `status: "error"` plus the message when the call throws — then re-throws.
 * Sync and async functions both work; a sync function stays sync.
 *
 * The same core is available as a wrapper and as a method decorator:
 *
 *   export const search = traced("tool.search", (q: string) => index.query(q));
 *
 *   class Agent {
 *     @observeMethod({ kind: "tool" })
 *     async book(req: Booking) { ... }
 *   }
 *
 * Nothing here can break the host app: if tracing is unavailable the function
 * is still called, and capture failures are swallowed.
 */

import { getCurrentTrace, getDefaultTracer, runWithSpan } from "./context.js";
import { CausalTracer, detachedSpan } from "./tracer.js";
import type { CausalSpan, CausalTrace, SpanKind, SpanStatus } from "./tracer.js";

/** Keys whose values never leave the process, at any depth of a captured
 *  value. Widen it per call with `ObserveOptions.redact`. */
export const REDACTED_KEY_PATTERN = /key|token|secret|password|authorization/i;

const REDACTED = "[redacted]";
const DEFAULT_MAX_CHARS = 2000;
const MAX_ERROR_CHARS = 1000;

/** Name → kind, first match wins. Deliberately small: an explicit
 *  `opts.kind` is always available when a name is ambiguous. */
const KIND_HINTS: ReadonlyArray<readonly [RegExp, SpanKind]> = [
  [/agent|subagent|assistant/i, "agent"],
  [/llm|model|completion|chat|prompt|generate|inference/i, "llm"],
  [/tool|action|function_call/i, "tool"],
  [/skill/i, "skill"],
  [/workflow|pipeline|graph|chain|orchestr/i, "workflow"],
  [/\bdb\b|sql|query|postgres|mysql|mongo|redis|prisma|insert|select/i, "db"],
  [/search|retriev|vector|embed|rag|rerank|index/i, "search"],
  [/http|fetch|request|api\.|rest|webhook|upload|download/i, "http"],
  [/shell|exec|bash|spawn|command|subprocess/i, "shell"],
];

/** Best-guess span kind for a span name. Defaults to `"function"`. */
export function inferKind(name: string): SpanKind {
  for (const [pattern, kind] of KIND_HINTS) {
    if (pattern.test(name)) return kind;
  }
  return "function";
}

export interface ObserveOptions {
  /** Span kind. Inferred from the span name when omitted. */
  kind?: SpanKind;
  /** Value recorded as `io.input` — serialized, redacted, truncated. Ignored by
   *  `traced()` and the decorator, which capture the call's arguments. */
  input?: unknown;
  /** Record the input. Default true. */
  captureInput?: boolean;
  /** Record the return value as `io.output`. Default true. */
  captureOutput?: boolean;
  /** Per-field truncation budget, in characters. Default 2000. */
  maxChars?: number;
  /** Extra key pattern to redact, on top of `REDACTED_KEY_PATTERN`. */
  redact?: RegExp;
  attributes?: { label: string; value: string }[];
  git?: { file: string; line: number; commit: string };
}

/** Options for the decorator, which takes its span name from the method. */
export interface ObserveMethodOptions extends ObserveOptions {
  /** Span name. Defaults to `Class.method`. */
  name?: string;
}

/** Run `fn` inside a span named `name`. Returns exactly what `fn` returns. */
export function observe<T>(name: string, fn: (span: CausalSpan) => T): T;
export function observe<T>(name: string, opts: ObserveOptions, fn: (span: CausalSpan) => T): T;
export function observe<T>(
  name: string,
  optsOrFn: ObserveOptions | ((span: CausalSpan) => T),
  maybeFn?: (span: CausalSpan) => T
): T {
  const opts = typeof optsOrFn === "function" ? {} : optsOrFn;
  const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
  if (!fn) throw new TypeError("observe(name, opts?, fn): fn is required");
  return runObserved(name, opts, opts.input, fn);
}

/** Wrap a function so every call opens a span. The call's arguments become the
 *  span input. Signature and behaviour are otherwise unchanged. */
export function traced<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R;
export function traced<A extends unknown[], R>(
  name: string,
  opts: ObserveOptions,
  fn: (...args: A) => R
): (...args: A) => R;
export function traced<A extends unknown[], R>(
  name: string,
  optsOrFn: ObserveOptions | ((...args: A) => R),
  maybeFn?: (...args: A) => R
): (...args: A) => R {
  const opts = typeof optsOrFn === "function" ? {} : optsOrFn;
  const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
  if (!fn) throw new TypeError("traced(name, opts?, fn): fn is required");
  return function (this: unknown, ...args: A): R {
    return runObserved(name, opts, argsToInput(args), () => fn.apply(this, args));
  };
}

type Stage3MethodDecorator = <This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
) => (this: This, ...args: Args) => Return;

type LegacyMethodDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
) => PropertyDescriptor;

/** Method decorator form of `observe()`. Works with both the standard (TC39)
 *  decorators TypeScript 5 emits by default and legacy
 *  `experimentalDecorators` builds. */
export function observeMethod(
  opts: ObserveMethodOptions = {}
): Stage3MethodDecorator & LegacyMethodDecorator {
  const decorate = (target: unknown, context: unknown, descriptor?: PropertyDescriptor): unknown => {
    // Legacy form: (prototype, propertyKey, descriptor)
    if (descriptor && typeof descriptor.value === "function") {
      const declared = ownerName((target as { constructor?: unknown })?.constructor);
      descriptor.value = wrapMethod(nameResolver(opts, String(context), declared), opts, descriptor.value as AnyMethod);
      return descriptor;
    }
    // Standard (TC39) form: (method, ClassMethodDecoratorContext)
    const ctx = context as ClassMethodDecoratorContext;
    return wrapMethod(nameResolver(opts, String(ctx.name), undefined), opts, target as AnyMethod);
  };
  return decorate as Stage3MethodDecorator & LegacyMethodDecorator;
}

type AnyMethod = (this: unknown, ...args: unknown[]) => unknown;

function wrapMethod(resolveName: (self: unknown) => string, opts: ObserveOptions, method: AnyMethod): AnyMethod {
  return function (this: unknown, ...args: unknown[]): unknown {
    return runObserved(resolveName(this), opts, argsToInput(args), () => method.apply(this, args));
  };
}

/** `Class.method`, resolved from the receiver at call time so both decorator
 *  flavours — and subclasses — produce the same shape of span name. */
function nameResolver(
  opts: ObserveMethodOptions,
  method: string,
  declared: string | undefined
): (self: unknown) => string {
  if (opts.name) return () => opts.name as string;
  return (self: unknown): string => {
    const owner = ownerName(self) ?? declared;
    return owner ? `${owner}.${method}` : method;
  };
}

/** Class name of a receiver: the constructor for an instance, the class itself
 *  for a static method. `Object` is noise, not a name. */
function ownerName(self: unknown): string | undefined {
  const named =
    typeof self === "function"
      ? (self as { name?: unknown }).name
      : ((self as { constructor?: { name?: unknown } } | null | undefined)?.constructor?.name ?? undefined);
  return typeof named === "string" && named !== "" && named !== "Object" ? named : undefined;
}

/** One argument is the input; several are captured as a list; none is nothing. */
function argsToInput(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  return args.length === 1 ? args[0] : args;
}

// ── core ──────────────────────────────────────────────────────────────────

function runObserved<T>(name: string, opts: ObserveOptions, input: unknown, invoke: (span: CausalSpan) => T): T {
  const { span, owned } = beginSpan(name, opts.kind ?? inferKind(name));
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const io: { input?: string; output?: string } = {};

  if (opts.captureInput !== false) {
    const captured = capture(input, maxChars, opts.redact);
    if (captured !== undefined) io.input = captured;
  }

  const settle = (status: SpanStatus, output: unknown, error?: string): void => {
    try {
      if (status === "ok" && opts.captureOutput !== false) {
        const captured = capture(output, maxChars, opts.redact);
        if (captured !== undefined) io.output = captured;
      }
      span.end({
        status,
        error,
        io: io.input !== undefined || io.output !== undefined ? io : undefined,
        attributes: opts.attributes,
        git: opts.git,
      });
      // A trace we started ourselves has nobody else to ship it.
      if (owned) void owned.flush().catch(() => undefined);
    } catch {
      // telemetry must never break the host app
    }
  };

  let result: T;
  try {
    result = runWithSpan(span, () => invoke(span));
  } catch (err) {
    settle("error", undefined, errorMessage(err));
    throw err;
  }

  if (isThenable(result)) {
    return result.then(
      (value: unknown) => {
        settle("ok", value);
        return value;
      },
      (err: unknown) => {
        settle("error", undefined, errorMessage(err));
        throw err;
      }
    ) as T;
  }

  settle("ok", result);
  return result;
}

/** The span the observed call runs in, plus the trace we own (and must flush)
 *  when there was no ambient run to join. */
function beginSpan(name: string, kind: SpanKind): { span: CausalSpan; owned: CausalTrace | null } {
  try {
    const ambient = getCurrentTrace();
    if (ambient) return { span: ambient.span(name, kind), owned: null };
    const trace = fallbackTracer().startTrace();
    return { span: trace.span(name, kind, null), owned: trace };
  } catch {
    return { span: detachedSpan(name, kind), owned: null }; // fail open
  }
}

let implicitTracer: CausalTracer | undefined;

/** The tracer for observes that run outside any traced run: the one registered
 *  with `setDefaultTracer()`, else an env-configured stand-in. The stand-in is
 *  never registered, so a tracer set later still wins. */
function fallbackTracer(): CausalTracer {
  const registered = getDefaultTracer();
  if (registered) return registered;
  implicitTracer ??= new CausalTracer({
    service: process.env["CAUSAL_SERVICE"] ?? process.env["SERVICE_NAME"] ?? "unknown-service",
  });
  return implicitTracer;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function errorMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return clip(text, MAX_ERROR_CHARS);
}

// ── capture ───────────────────────────────────────────────────────────────

/** Serialize a value for `io`: redacted, truncated, and never throwing. */
function capture(value: unknown, maxChars: number, extra?: RegExp): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value === "string") return clip(value, maxChars);
    const json = stringify(value, extra);
    return json === undefined ? undefined : clip(json, maxChars);
  } catch {
    return undefined; // a throwing getter or exotic value is not worth a crash
  }
}

function stringify(value: unknown, extra?: RegExp): string | undefined {
  try {
    return JSON.stringify(value, redactor(extra, false));
  } catch {
    // circular structure (or a replacer-visible cycle) — retry detecting them
    try {
      return JSON.stringify(value, redactor(extra, true));
    } catch {
      return undefined;
    }
  }
}

function redactor(extra: RegExp | undefined, detectCycles: boolean): (key: string, value: unknown) => unknown {
  const custom = extra ? stateless(extra) : undefined;
  const seen = new WeakSet<object>();
  return (key: string, value: unknown): unknown => {
    if (key !== "" && (REDACTED_KEY_PATTERN.test(key) || custom?.test(key) === true)) return REDACTED;
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "function") return "[function]";
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (detectCycles && typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
    }
    return value;
  };
}

/** A copy without the `g`/`y` flags — `test()` on those is stateful. */
function stateless(pattern: RegExp): RegExp {
  return pattern.flags.includes("g") || pattern.flags.includes("y")
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
    : pattern;
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[+${text.length - maxChars} chars]`;
}
