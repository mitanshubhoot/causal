/**
 * Ambient tracing context — the current trace and the current span, carried
 * across `await` boundaries by `AsyncLocalStorage`. This is what lets spans
 * nest automatically: `t.span(name, kind)` picks up whatever span is running
 * instead of forcing every call site to thread a parent through its signature.
 *
 *   await tracer.trace("agent.run", async () => {   // trace + root are ambient
 *     await observe("tool.search", {}, () => search()); // nests under the root
 *   });
 *
 * Frameworks that own the call stack (LangGraph, queues, HTTP routers) can set
 * the context themselves:
 *
 *   runWithTrace(t, root, () => graph.invoke(input));
 *   runWithSpan(span, () => step());
 *
 * Nothing here throws, and nothing here is required: code that keeps passing
 * `t` and a parent span explicitly behaves exactly as before.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { CausalSpan, CausalTrace, CausalTracer } from "./tracer.js";

export interface CausalContext {
  readonly trace: CausalTrace;
  /** The innermost open span, if any. New spans nest under it. */
  readonly span?: CausalSpan;
}

const storage = new AsyncLocalStorage<CausalContext>();

let defaultTracer: CausalTracer | undefined;

/** The whole ambient context, or `undefined` outside any traced run. */
export function getCurrentContext(): CausalContext | undefined {
  return storage.getStore();
}

/** The trace of the current run, or `undefined` outside any traced run. */
export function getCurrentTrace(): CausalTrace | undefined {
  return storage.getStore()?.trace;
}

/** The innermost open span, or `undefined` when nothing is running. */
export function getCurrentSpan(): CausalSpan | undefined {
  return storage.getStore()?.span;
}

/** Run `fn` with `trace` (and optionally `span`) as the ambient context.
 *  Returns whatever `fn` returns — sync value or promise, untouched. */
export function runWithTrace<T>(trace: CausalTrace, fn: () => T): T;
export function runWithTrace<T>(trace: CausalTrace, span: CausalSpan | null | undefined, fn: () => T): T;
export function runWithTrace<T>(
  trace: CausalTrace,
  spanOrFn: CausalSpan | null | undefined | (() => T),
  maybeFn?: () => T
): T {
  const fn = typeof spanOrFn === "function" ? spanOrFn : maybeFn;
  if (!fn) throw new TypeError("runWithTrace(trace, span?, fn): fn is required");
  const span = typeof spanOrFn === "function" ? undefined : (spanOrFn ?? undefined);
  return storage.run(span ? { trace, span } : { trace }, fn);
}

/** Run `fn` with `span` as the ambient parent. The span's own trace comes
 *  along, so this works even outside `runWithTrace`. */
export function runWithSpan<T>(span: CausalSpan, fn: () => T): T {
  return storage.run({ trace: span.trace, span }, fn);
}

/** Run `fn` with no ambient trace — spans opened inside start fresh. Useful for
 *  background work kicked off from a request that must not join its trace. */
export function runWithoutTrace<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** Register the tracer that `observe()` should use when it runs outside any
 *  traced run. Call it once, next to where the tracer is constructed. */
export function setDefaultTracer(tracer: CausalTracer | undefined): void {
  defaultTracer = tracer;
}

/** The tracer registered with `setDefaultTracer`, if any. */
export function getDefaultTracer(): CausalTracer | undefined {
  return defaultTracer;
}
