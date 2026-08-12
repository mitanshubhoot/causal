export { CausalClient } from "./client.js";
export { CausalSession, readSessionFile, clearSessionFile } from "./session.js";
export type { CausalClientOptions } from "./client.js";
export { CausalTracer, CausalTrace, CausalSpan, flushOnExit } from "./tracer.js";
export type { CausalTracerOptions, SpanEndOptions, SpanKind, SpanStatus, FlushOnExitOptions } from "./tracer.js";
export {
  getCurrentContext,
  getCurrentTrace,
  getCurrentSpan,
  runWithTrace,
  runWithSpan,
  runWithoutTrace,
  setDefaultTracer,
  getDefaultTracer,
} from "./context.js";
export type { CausalContext } from "./context.js";
export { observe, traced, observeMethod, inferKind, REDACTED_KEY_PATTERN } from "./observe.js";
export type { ObserveOptions, ObserveMethodOptions } from "./observe.js";
