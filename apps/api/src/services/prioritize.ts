/**
 * Noise filtering + signal prioritization for traces.
 *
 * Ingest is firehose-shaped: the overwhelming majority of traces are healthy,
 * cheap and boring, and storing/judging all of them buries the handful that
 * actually mean something. This module scores a trace on how much signal it
 * carries, then decides whether to keep it or let it fall out of the sample.
 *
 * Deliberately pure: no fastify, no Postgres, no clock, no randomness. Every
 * decision is a function of the trace itself, so it is trivially unit-testable
 * and — critically — the sampling decision is *stable* for a given trace id.
 */

// ── Shapes (a structural subset of what getTrace() returns) ─────────
export interface ScorableSpan {
  id: string;
  parentId?: string | null;
  name: string;
  kind?: string | null;
  startMs?: number | null;
  durationMs?: number | null;
  status?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cost?: number | null;
  error?: string | null;
  git?: { file?: string; line?: number; commit?: string } | null;
}

export interface ScorableTrace {
  traceId: string;
  service?: string | null;
  status?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cost?: number | null;
  spans?: ScorableSpan[] | null;
}

/** The signals we weigh. Stable codes so a dashboard can aggregate them. */
export type SignalCode =
  | "error_span"
  | "warn_span"
  | "latency_outlier"
  | "cost_outlier"
  | "retry_loop"
  | "git_context"
  | "deep_nesting";

export interface TraceScore {
  /** 0..1 — how much this trace deserves a human's (or a judge's) attention. */
  score: number;
  /** Human-readable, evidence-bearing explanations, in weight order. */
  reasons: string[];
  /** The same explanations as stable codes, for aggregation. */
  signals: SignalCode[];
}

/** Typical numbers for one service, used to decide what "unusual" means. */
export interface ServiceBaseline {
  p50DurationMs?: number;
  p95DurationMs?: number;
  p50Cost?: number;
  p50Tokens?: number;
}

// ── Tunables ────────────────────────────────────────────────────────

/**
 * Signal weights. A trace's score is the clamped sum of the weights of the
 * signals it fires — so a single error is enough to clear any sane keep
 * threshold, while three soft signals have to agree before it does.
 * Exported so they can be tuned (or overridden per-org) without a code change.
 */
export const PRIORITY_WEIGHTS: Record<SignalCode, number> = {
  error_span: 0.6,
  warn_span: 0.18,
  latency_outlier: 0.14,
  cost_outlier: 0.12,
  retry_loop: 0.2,
  git_context: 0.14,
  deep_nesting: 0.08,
};

export const SIGNAL_LABELS: Record<SignalCode, string> = {
  error_span: "Errored span",
  warn_span: "Warning span",
  latency_outlier: "Latency outlier",
  cost_outlier: "Cost / token outlier",
  retry_loop: "Retry loop",
  git_context: "Actionable git origin",
  deep_nesting: "Deep span nesting",
};

/** At or above this score a trace is always kept, whatever the sample rate. */
export const HIGH_SCORE_THRESHOLD = 0.5;

/** Kept fraction of the healthy remainder when the caller doesn't say. */
export const DEFAULT_SAMPLE_RATE = 0.1;

/** How far past the baseline counts as "unusual". */
export const LATENCY_OUTLIER_MULTIPLE = 2;
export const COST_OUTLIER_MULTIPLE = 3;

/**
 * With no service baseline we can still spot a trace whose own shape is lopsided
 * — one span dominating the wall clock — but only once there are enough spans
 * for a median to mean anything.
 */
export const INTRA_TRACE_MIN_SPANS = 4;
export const INTRA_TRACE_LATENCY_MULTIPLE = 4;
export const INTRA_TRACE_MIN_SLOW_MS = 1000;

/** Absolute backstops, used only when the baseline can't say anything. */
export const COST_ABSOLUTE_USD = 1;
export const TOKENS_ABSOLUTE = 100_000;

/** The same span name failing this many times in one trace is a retry loop. */
export const RETRY_LOOP_MIN_REPEATS = 2;

/** Span-tree depth at which a run is structurally suspicious. */
export const DEEP_NESTING_DEPTH = 6;

/** A baseline built from fewer traces than this is noise, not a baseline. */
export const MIN_BASELINE_SAMPLES = 5;

/** How many reasons summarizeNoise() reports. */
export const TOP_REASONS_LIMIT = 5;

// ── Small numeric helpers ───────────────────────────────────────────

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Round to 3dp so scores compare/serialize cleanly. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Nearest-rank percentile over an already-ascending array. `0` when empty. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}

const spans = (trace: ScorableTrace): ScorableSpan[] => (Array.isArray(trace.spans) ? trace.spans : []);

const isError = (s: ScorableSpan): boolean =>
  s.status === "error" || (typeof s.error === "string" && s.error.trim().length > 0);

const isWarn = (s: ScorableSpan): boolean => s.status === "warn";

/** Wall-clock span of the trace: the furthest any span reached. */
export function traceDurationMs(trace: ScorableTrace): number {
  let end = 0;
  for (const s of spans(trace)) end = Math.max(end, num(s.startMs) + num(s.durationMs));
  return end;
}

/** Trace cost — the trace total when set, else the sum of its spans. */
export function traceCost(trace: ScorableTrace): number {
  const total = num(trace.cost);
  if (total > 0) return total;
  return spans(trace).reduce((a, s) => a + num(s.cost), 0);
}

/** Total tokens (in + out) — the trace totals when set, else the span sum. */
export function traceTokens(trace: ScorableTrace): number {
  const total = num(trace.tokensIn) + num(trace.tokensOut);
  if (total > 0) return total;
  return spans(trace).reduce((a, s) => a + num(s.tokensIn) + num(s.tokensOut), 0);
}

/** Deepest parent chain in the span tree. Cycle-safe (a bad SDK can send one). */
export function maxSpanDepth(trace: ScorableTrace): number {
  const list = spans(trace);
  if (list.length === 0) return 0;
  const parentOf = new Map<string, string | null>();
  for (const s of list) parentOf.set(s.id, s.parentId ?? null);

  let deepest = 0;
  for (const s of list) {
    let depth = 1;
    let cursor = s.parentId ?? null;
    const seen = new Set<string>([s.id]);
    while (cursor != null && parentOf.has(cursor) && !seen.has(cursor) && depth <= list.length) {
      seen.add(cursor);
      depth++;
      cursor = parentOf.get(cursor) ?? null;
    }
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}

// ── Baselines ───────────────────────────────────────────────────────

/**
 * Derive "normal" from a batch of traces for one service. Returns an empty
 * baseline below MIN_BASELINE_SAMPLES — claiming a p95 from three traces would
 * make every fourth trace an outlier.
 */
export function buildBaseline(traces: ScorableTrace[]): ServiceBaseline {
  const list = Array.isArray(traces) ? traces : [];
  if (list.length < MIN_BASELINE_SAMPLES) return {};

  const asc = (a: number, b: number): number => a - b;
  const durations = list.map(traceDurationMs).filter((d) => d > 0).sort(asc);
  const costs = list.map(traceCost).filter((c) => c > 0).sort(asc);
  const tokens = list.map(traceTokens).filter((t) => t > 0).sort(asc);

  return {
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    p50Cost: percentile(costs, 0.5),
    p50Tokens: percentile(tokens, 0.5),
  };
}

// ── Scoring ─────────────────────────────────────────────────────────

const short = (s: string, max = 120): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Score one trace on how much signal it carries. Pure: same trace (and same
 * baseline) always yields the same score and the same reasons.
 *
 * Pass the service baseline when you have one — without it, latency and cost
 * fall back to intra-trace shape and absolute backstops rather than silently
 * inventing a "normal".
 */
export function scoreTrace(trace: ScorableTrace, baseline?: ServiceBaseline): TraceScore {
  const list = spans(trace);
  const signals: SignalCode[] = [];
  const reasons: string[] = [];
  const fire = (code: SignalCode, reason: string): void => {
    signals.push(code);
    reasons.push(reason);
  };

  // 1. Errors — the strongest signal there is.
  const errorSpans = list.filter(isError);
  if (errorSpans.length > 0) {
    const first = errorSpans[0];
    const detail = first?.error ? `: ${short(first.error.trim())}` : "";
    fire(
      "error_span",
      errorSpans.length === 1
        ? `${first?.name ?? "a span"} errored${detail}`
        : `${errorSpans.length} spans errored, starting at ${first?.name ?? "unknown"}${detail}`
    );
  } else if (trace.status === "error") {
    // The rollup says error even though no span carries one — still keep it.
    fire("error_span", "trace rolled up to error with no failing span recorded");
  }

  // 2. Warnings — softer, but a run full of them is worth a look.
  const warnSpans = list.filter(isWarn);
  if (warnSpans.length > 0) {
    fire(
      "warn_span",
      warnSpans.length === 1
        ? `${warnSpans[0]?.name ?? "a span"} returned warn`
        : `${warnSpans.length} spans returned warn`
    );
  }

  // 3. Latency vs the service baseline (or vs the trace's own shape).
  const durationMs = traceDurationMs(trace);
  const p50Duration = num(baseline?.p50DurationMs);
  const p95Duration = num(baseline?.p95DurationMs);
  if (durationMs > 0 && (p95Duration > 0 || p50Duration > 0)) {
    const threshold = p95Duration > 0 ? p95Duration : p50Duration * LATENCY_OUTLIER_MULTIPLE;
    if (threshold > 0 && durationMs > threshold) {
      fire(
        "latency_outlier",
        `ran ${Math.round(durationMs)}ms against a ${Math.round(threshold)}ms baseline for ${trace.service ?? "this service"}`
      );
    }
  } else if (durationMs > 0 && list.length >= INTRA_TRACE_MIN_SPANS) {
    // No baseline yet: flag a single span that eats the run.
    const spanDurations = list.map((s) => num(s.durationMs)).filter((d) => d > 0).sort((a, b) => a - b);
    const median = percentile(spanDurations, 0.5);
    const slowest = list.reduce<ScorableSpan | null>(
      (worst, s) => (worst === null || num(s.durationMs) > num(worst.durationMs) ? s : worst),
      null
    );
    const slowestMs = num(slowest?.durationMs);
    if (median > 0 && slowestMs >= INTRA_TRACE_MIN_SLOW_MS && slowestMs > median * INTRA_TRACE_LATENCY_MULTIPLE) {
      fire(
        "latency_outlier",
        `${slowest?.name ?? "one span"} took ${Math.round(slowestMs)}ms — ${Math.round(slowestMs / median)}× the median span in this trace`
      );
    }
  }

  // 4. Cost / tokens.
  const cost = traceCost(trace);
  const tokens = traceTokens(trace);
  const p50Cost = num(baseline?.p50Cost);
  const p50Tokens = num(baseline?.p50Tokens);
  if (p50Cost > 0 && cost > p50Cost * COST_OUTLIER_MULTIPLE) {
    fire("cost_outlier", `cost $${cost.toFixed(4)} against a $${p50Cost.toFixed(4)} median`);
  } else if (p50Tokens > 0 && tokens > p50Tokens * COST_OUTLIER_MULTIPLE) {
    fire("cost_outlier", `${tokens} tokens against a ${Math.round(p50Tokens)}-token median`);
  } else if (p50Cost === 0 && p50Tokens === 0 && (cost >= COST_ABSOLUTE_USD || tokens >= TOKENS_ABSOLUTE)) {
    fire("cost_outlier", `expensive run — $${cost.toFixed(4)} / ${tokens} tokens`);
  }

  // 5. Retry loops — the same call failing over and over inside one run.
  const failuresByName = new Map<string, number>();
  for (const s of errorSpans) failuresByName.set(s.name, (failuresByName.get(s.name) ?? 0) + 1);
  let loopName = "";
  let loopCount = 0;
  for (const [name, count] of failuresByName) {
    if (count > loopCount) {
      loopName = name;
      loopCount = count;
    }
  }
  if (loopCount >= RETRY_LOOP_MIN_REPEATS) {
    fire("retry_loop", `retry loop — ${loopName} failed ${loopCount}× in one trace`);
  }

  // 6. Actionable git origin on the failing span: we can root-cause this one.
  const actionable = [...errorSpans, ...warnSpans].find((s) => typeof s.git?.file === "string" && s.git.file.length > 0);
  if (actionable?.git?.file) {
    fire("git_context", `failing span ${actionable.name} carries git origin ${actionable.git.file}:${actionable.git.line ?? 0}`);
  }

  // 7. Deep nesting — recursion or a runaway plan-execute loop.
  const depth = maxSpanDepth(trace);
  if (depth >= DEEP_NESTING_DEPTH) {
    fire("deep_nesting", `span tree is ${depth} levels deep`);
  }

  const raw = signals.reduce((a, code) => a + (PRIORITY_WEIGHTS[code] ?? 0), 0);
  return { score: round3(clamp01(raw)), reasons, signals };
}

// ── Sampling ────────────────────────────────────────────────────────

export interface SampleOptions {
  /** Fraction of the healthy remainder to keep (0..1). */
  sampleRate?: number;
  /** Score at or above which a trace is always kept. */
  keepAboveScore?: number;
  /** Baseline for the trace's service, when known. */
  baseline?: ServiceBaseline;
  /** Cap on reported reasons per summary. */
  topReasons?: number;
}

export interface SampleDecision extends TraceScore {
  /** True when the trace is retained. */
  keep: boolean;
  /** True when it was retained on signal rather than by winning the sample. */
  forced: boolean;
}

/**
 * FNV-1a over the trace id, mapped to [0,1). Deterministic and well spread, so
 * the same trace always lands on the same side of the sample rate — re-ingest,
 * retries and replays can't flip a trace in or out of the sample.
 */
export function hashUnitInterval(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

/** Score + keep/drop in one pass, with the reasoning attached. */
export function sampleDecision(trace: ScorableTrace, opts: SampleOptions = {}): SampleDecision {
  const scored = scoreTrace(trace, opts.baseline);
  const threshold = typeof opts.keepAboveScore === "number" ? opts.keepAboveScore : HIGH_SCORE_THRESHOLD;

  // Anything that failed, or that scores high, is never sampled away.
  const forced = scored.signals.includes("error_span") || scored.score >= threshold;
  if (forced) return { ...scored, keep: true, forced: true };

  const rate = clamp01(typeof opts.sampleRate === "number" && Number.isFinite(opts.sampleRate) ? opts.sampleRate : DEFAULT_SAMPLE_RATE);
  if (rate >= 1) return { ...scored, keep: true, forced: false };
  if (rate <= 0) return { ...scored, keep: false, forced: false };

  return { ...scored, keep: hashUnitInterval(trace.traceId) < rate, forced: false };
}

/**
 * Keep this trace? Always true for anything carrying an error or a high score;
 * the healthy remainder is sampled deterministically by trace id.
 */
export function shouldSample(trace: ScorableTrace, opts: SampleOptions = {}): boolean {
  return sampleDecision(trace, opts).keep;
}

// ── Aggregation for the dashboard ───────────────────────────────────

export interface NoiseSummary {
  total: number;
  kept: number;
  sampledOut: number;
  /** Kept because they carried signal (error / high score). */
  keptForSignal: number;
  /** Kept purely to preserve a healthy baseline sample. */
  keptBySampling: number;
  /** Fraction of the input retained, 0..1. */
  keptRatio: number;
  /** Fraction dropped as noise, 0..1. */
  noiseRatio: number;
  errorTraces: number;
  averageScore: number;
  topReasons: { signal: SignalCode; label: string; count: number }[];
}

/**
 * Roll a batch of traces up into "what did filtering actually buy us" numbers.
 * Baselines are derived per service from the batch itself unless the caller
 * supplies one, so a slow service isn't judged by a fast service's clock.
 */
export function summarizeNoise(traces: ScorableTrace[], opts: SampleOptions = {}): NoiseSummary {
  const list = Array.isArray(traces) ? traces : [];
  const limit = typeof opts.topReasons === "number" && opts.topReasons > 0 ? opts.topReasons : TOP_REASONS_LIMIT;

  const baselines = new Map<string, ServiceBaseline>();
  if (!opts.baseline) {
    const byService = new Map<string, ScorableTrace[]>();
    for (const t of list) {
      const key = t.service ?? "unknown";
      const group = byService.get(key);
      if (group) group.push(t);
      else byService.set(key, [t]);
    }
    for (const [key, group] of byService) baselines.set(key, buildBaseline(group));
  }

  let kept = 0;
  let keptForSignal = 0;
  let errorTraces = 0;
  let scoreSum = 0;
  const counts = new Map<SignalCode, number>();

  for (const t of list) {
    const baseline = opts.baseline ?? baselines.get(t.service ?? "unknown");
    const decision = sampleDecision(t, { ...opts, baseline });
    scoreSum += decision.score;
    if (decision.keep) kept++;
    if (decision.forced) keptForSignal++;
    if (decision.signals.includes("error_span")) errorTraces++;
    for (const code of decision.signals) counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const total = list.length;
  const topReasons = [...counts.entries()]
    .map(([signal, count]) => ({ signal, label: SIGNAL_LABELS[signal], count }))
    .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
    .slice(0, limit);

  return {
    total,
    kept,
    sampledOut: total - kept,
    keptForSignal,
    keptBySampling: kept - keptForSignal,
    keptRatio: total === 0 ? 0 : round3(kept / total),
    noiseRatio: total === 0 ? 0 : round3((total - kept) / total),
    errorTraces,
    averageScore: total === 0 ? 0 : round3(scoreSum / total),
    topReasons,
  };
}
