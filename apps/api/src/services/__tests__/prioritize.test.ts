import { describe, expect, it } from "vitest";
import {
  buildBaseline,
  hashUnitInterval,
  sampleDecision,
  scoreTrace,
  shouldSample,
  summarizeNoise,
  DEEP_NESTING_DEPTH,
  HIGH_SCORE_THRESHOLD,
  PRIORITY_WEIGHTS,
  type ScorableSpan,
  type ScorableTrace,
} from "../prioritize.js";

// ── Builders ────────────────────────────────────────────────────────

function span(over: Partial<ScorableSpan> & Pick<ScorableSpan, "id">): ScorableSpan {
  return { name: over.id, kind: "function", status: "ok", startMs: 0, durationMs: 10, ...over };
}

function trace(over: Partial<ScorableTrace> = {}): ScorableTrace {
  return {
    traceId: "trace_1",
    service: "booking-agent",
    status: "ok",
    cost: 0,
    tokensIn: 0,
    tokensOut: 0,
    spans: [span({ id: "root", parentId: null })],
    ...over,
  };
}

/** A boring, cheap, fast, entirely successful run — the 99% case. */
function healthyTrace(id = "trace_healthy"): ScorableTrace {
  return trace({
    traceId: id,
    cost: 0.0004,
    tokensIn: 300,
    tokensOut: 80,
    spans: [
      span({ id: "root", parentId: null, kind: "agent", durationMs: 220 }),
      span({ id: "plan", parentId: "root", kind: "llm", startMs: 5, durationMs: 120 }),
      span({ id: "lookup", parentId: "root", kind: "db", startMs: 130, durationMs: 30 }),
    ],
  });
}

// ── scoreTrace ──────────────────────────────────────────────────────

describe("scoreTrace — errors dominate", () => {
  it("scores any trace with an errored span high", () => {
    const scored = scoreTrace(
      trace({
        status: "error",
        spans: [
          span({ id: "root", parentId: null, kind: "agent" }),
          span({ id: "charge", parentId: "root", kind: "tool", status: "error", error: "402 card_declined" }),
        ],
      })
    );
    expect(scored.signals).toContain("error_span");
    expect(scored.score).toBeGreaterThanOrEqual(PRIORITY_WEIGHTS.error_span);
    expect(scored.score).toBeGreaterThanOrEqual(HIGH_SCORE_THRESHOLD);
    expect(scored.reasons.join(" ")).toContain("402 card_declined");
  });

  it("treats a span carrying an error message as failed even when status says ok", () => {
    const scored = scoreTrace(
      trace({ spans: [span({ id: "root", parentId: null, status: "ok", error: "ETIMEDOUT" })] })
    );
    expect(scored.signals).toContain("error_span");
  });

  it("keeps an error rollup with no failing span — we still want to look at it", () => {
    const scored = scoreTrace(trace({ status: "error", spans: [span({ id: "root", parentId: null })] }));
    expect(scored.signals).toContain("error_span");
    expect(scored.reasons.join(" ")).toMatch(/rolled up to error/);
  });

  it("never exceeds 1 even when every signal fires", () => {
    const deep: ScorableSpan[] = [span({ id: "s0", parentId: null, status: "error", error: "boom" })];
    for (let i = 1; i <= DEEP_NESTING_DEPTH + 2; i++) {
      deep.push(
        span({ id: `s${i}`, name: "tool.retry", parentId: `s${i - 1}`, status: "error", error: "boom", durationMs: 5000 })
      );
    }
    deep.push(span({ id: "warn", parentId: "s0", status: "warn" }));
    const scored = scoreTrace(
      trace({ status: "error", cost: 12, tokensIn: 500_000, tokensOut: 10_000, spans: deep })
    );
    expect(scored.score).toBe(1);
    expect(scored.score).toBeLessThanOrEqual(1);
  });
});

describe("scoreTrace — healthy traces are quiet", () => {
  it("scores a cheap, fast, successful run at zero with no reasons", () => {
    const scored = scoreTrace(healthyTrace());
    expect(scored.score).toBe(0);
    expect(scored.reasons).toEqual([]);
    expect(scored.signals).toEqual([]);
    expect(scored.score).toBeLessThan(HIGH_SCORE_THRESHOLD);
  });

  it("scores an empty trace at zero rather than crashing", () => {
    expect(scoreTrace({ traceId: "t", spans: [] }).score).toBe(0);
    expect(scoreTrace({ traceId: "t" }).score).toBe(0);
  });

  it("gives a warn-only trace a low score that still stays under the keep threshold", () => {
    const scored = scoreTrace(
      trace({ status: "warn", spans: [span({ id: "root", parentId: null, status: "warn" })] })
    );
    expect(scored.signals).toEqual(["warn_span"]);
    expect(scored.score).toBe(PRIORITY_WEIGHTS.warn_span);
    expect(scored.score).toBeLessThan(HIGH_SCORE_THRESHOLD);
  });
});

describe("scoreTrace — retry loops", () => {
  it("detects the same span name failing repeatedly in one trace", () => {
    const scored = scoreTrace(
      trace({
        status: "error",
        spans: [
          span({ id: "root", parentId: null, kind: "agent" }),
          span({ id: "a1", name: "tool.charge_card", parentId: "root", status: "error", error: "502" }),
          span({ id: "a2", name: "tool.charge_card", parentId: "root", status: "error", error: "502" }),
          span({ id: "a3", name: "tool.charge_card", parentId: "root", status: "error", error: "502" }),
        ],
      })
    );
    expect(scored.signals).toContain("retry_loop");
    expect(scored.reasons.join(" ")).toContain("tool.charge_card failed 3×");
  });

  it("does not call distinct failures a retry loop", () => {
    const scored = scoreTrace(
      trace({
        status: "error",
        spans: [
          span({ id: "root", parentId: null }),
          span({ id: "a", name: "tool.charge_card", parentId: "root", status: "error", error: "502" }),
          span({ id: "b", name: "tool.send_receipt", parentId: "root", status: "error", error: "500" }),
        ],
      })
    );
    expect(scored.signals).not.toContain("retry_loop");
  });

  it("does not call a repeated *successful* span a retry loop", () => {
    const scored = scoreTrace(
      trace({
        spans: [
          span({ id: "root", parentId: null }),
          span({ id: "a", name: "tool.search", parentId: "root" }),
          span({ id: "b", name: "tool.search", parentId: "root" }),
          span({ id: "c", name: "tool.search", parentId: "root" }),
        ],
      })
    );
    expect(scored.signals).toEqual([]);
  });
});

describe("scoreTrace — the softer signals", () => {
  it("flags a failing span that carries git context as actionable", () => {
    const scored = scoreTrace(
      trace({
        status: "error",
        spans: [
          span({
            id: "root",
            name: "payments.charge",
            parentId: null,
            status: "error",
            error: "boom",
            git: { file: "src/payments.ts", line: 88, commit: "abc1234" },
          }),
        ],
      })
    );
    expect(scored.signals).toContain("git_context");
    expect(scored.reasons.join(" ")).toContain("src/payments.ts:88");
  });

  it("flags latency past the service baseline", () => {
    const slow = trace({ spans: [span({ id: "root", parentId: null, durationMs: 9000 })] });
    expect(scoreTrace(slow, { p50DurationMs: 400, p95DurationMs: 900 }).signals).toContain("latency_outlier");
    // …and the same trace against a slow baseline is unremarkable.
    expect(scoreTrace(slow, { p50DurationMs: 8000, p95DurationMs: 20000 }).signals).not.toContain("latency_outlier");
  });

  it("falls back to the trace's own shape when there is no baseline", () => {
    const scored = scoreTrace(
      trace({
        spans: [
          span({ id: "root", parentId: null, durationMs: 20 }),
          span({ id: "a", parentId: "root", durationMs: 20 }),
          span({ id: "b", parentId: "root", durationMs: 25 }),
          span({ id: "hog", name: "tool.scrape", parentId: "root", durationMs: 8000 }),
        ],
      })
    );
    expect(scored.signals).toContain("latency_outlier");
    expect(scored.reasons.join(" ")).toContain("tool.scrape");
  });

  it("flags cost against the baseline, and absolute cost without one", () => {
    const pricey = trace({ cost: 0.9, spans: [span({ id: "root", parentId: null })] });
    expect(scoreTrace(pricey, { p50Cost: 0.01 }).signals).toContain("cost_outlier");
    // No baseline and under the absolute backstop → not a signal.
    expect(scoreTrace(pricey).signals).not.toContain("cost_outlier");
    expect(scoreTrace(trace({ cost: 4.2, spans: [span({ id: "root", parentId: null })] })).signals).toContain(
      "cost_outlier"
    );
  });

  it("flags a deeply nested span tree", () => {
    const chain: ScorableSpan[] = [span({ id: "s0", parentId: null })];
    for (let i = 1; i < DEEP_NESTING_DEPTH; i++) chain.push(span({ id: `s${i}`, parentId: `s${i - 1}` }));
    expect(scoreTrace(trace({ spans: chain })).signals).toContain("deep_nesting");
    expect(scoreTrace(trace({ spans: chain.slice(0, 2) })).signals).not.toContain("deep_nesting");
  });

  it("survives a cyclic parent chain from a misbehaving SDK", () => {
    const scored = scoreTrace(
      trace({
        spans: [span({ id: "a", parentId: "b" }), span({ id: "b", parentId: "a" })],
      })
    );
    expect(Number.isFinite(scored.score)).toBe(true);
  });
});

// ── shouldSample ────────────────────────────────────────────────────

describe("shouldSample — errors are never sampled away", () => {
  it("keeps an errored trace even at a zero sample rate", () => {
    const failed = trace({
      traceId: "trace_error",
      status: "error",
      spans: [span({ id: "root", parentId: null, status: "error", error: "boom" })],
    });
    expect(shouldSample(failed, { sampleRate: 0 })).toBe(true);
    expect(shouldSample(failed, { sampleRate: 0.000001 })).toBe(true);
    expect(sampleDecision(failed, { sampleRate: 0 }).forced).toBe(true);
  });

  it("keeps a high-scoring healthy trace on signal, not on luck", () => {
    // warn + latency + cost + nesting clears the threshold with no error at all.
    const chain: ScorableSpan[] = [span({ id: "s0", parentId: null, status: "warn", durationMs: 9000 })];
    for (let i = 1; i < DEEP_NESTING_DEPTH; i++) chain.push(span({ id: `s${i}`, parentId: `s${i - 1}` }));
    const noisy = trace({ traceId: "trace_noisy", cost: 3, spans: chain });
    const decision = sampleDecision(noisy, { sampleRate: 0, baseline: { p50DurationMs: 100, p95DurationMs: 200 } });
    expect(decision.score).toBeGreaterThanOrEqual(HIGH_SCORE_THRESHOLD);
    expect(decision.keep).toBe(true);
    expect(decision.forced).toBe(true);
    expect(decision.signals).not.toContain("error_span");
  });

  it("drops the healthy remainder at rate 0 and keeps all of it at rate 1", () => {
    const healthy = healthyTrace();
    expect(shouldSample(healthy, { sampleRate: 0 })).toBe(false);
    expect(shouldSample(healthy, { sampleRate: 1 })).toBe(true);
    expect(sampleDecision(healthy, { sampleRate: 1 }).forced).toBe(false);
  });

  it("honours an explicit keepAboveScore", () => {
    const warned = trace({
      traceId: "trace_warn",
      status: "warn",
      spans: [span({ id: "root", parentId: null, status: "warn" })],
    });
    expect(shouldSample(warned, { sampleRate: 0, keepAboveScore: 0.1 })).toBe(true);
    expect(shouldSample(warned, { sampleRate: 0, keepAboveScore: 0.9 })).toBe(false);
  });
});

describe("shouldSample — determinism", () => {
  it("returns the same decision for the same trace id, every time", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `trace_${i}`);
    for (const id of ids) {
      const first = shouldSample(healthyTrace(id), { sampleRate: 0.5 });
      for (let i = 0; i < 20; i++) {
        // A freshly-built (but equal) trace must land on the same side.
        expect(shouldSample(healthyTrace(id), { sampleRate: 0.5 })).toBe(first);
      }
    }
  });

  it("hashes ids into [0,1) stably", () => {
    expect(hashUnitInterval("trace_1")).toBe(hashUnitInterval("trace_1"));
    expect(hashUnitInterval("trace_1")).not.toBe(hashUnitInterval("trace_2"));
    for (const id of ["", "a", "trace_1", "0123456789abcdef"]) {
      const h = hashUnitInterval(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("keeps roughly the requested fraction of healthy traces", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `trace_${i}`);
    const kept = ids.filter((id) => shouldSample(healthyTrace(id), { sampleRate: 0.25 })).length;
    expect(kept / ids.length).toBeGreaterThan(0.15);
    expect(kept / ids.length).toBeLessThan(0.35);
  });

  it("is monotonic in the sample rate — a bigger rate never drops a kept trace", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `trace_${i}`);
    for (const id of ids) {
      const t = healthyTrace(id);
      if (shouldSample(t, { sampleRate: 0.2 })) expect(shouldSample(t, { sampleRate: 0.8 })).toBe(true);
    }
  });
});

// ── buildBaseline / summarizeNoise ──────────────────────────────────

describe("buildBaseline", () => {
  it("refuses to invent a baseline from too few traces", () => {
    expect(buildBaseline([healthyTrace("a"), healthyTrace("b")])).toEqual({});
  });

  it("derives p50/p95 duration once there is enough history", () => {
    const traces = Array.from({ length: 10 }, (_, i) =>
      trace({ traceId: `t${i}`, cost: 0.01, spans: [span({ id: "root", parentId: null, durationMs: (i + 1) * 100 })] })
    );
    const baseline = buildBaseline(traces);
    expect(baseline.p50DurationMs).toBe(500);
    expect(baseline.p95DurationMs).toBe(1000);
    expect(baseline.p50Cost).toBeCloseTo(0.01, 10);
  });
});

describe("summarizeNoise", () => {
  it("accounts for every trace and ranks the reasons", () => {
    const traces: ScorableTrace[] = [
      ...Array.from({ length: 20 }, (_, i) => healthyTrace(`healthy_${i}`)),
      trace({
        traceId: "err_1",
        status: "error",
        spans: [
          span({ id: "root", parentId: null }),
          span({
            id: "a",
            name: "tool.charge",
            parentId: "root",
            status: "error",
            error: "502",
            git: { file: "src/pay.ts", line: 12, commit: "deadbee" },
          }),
          span({ id: "b", name: "tool.charge", parentId: "root", status: "error", error: "502" }),
        ],
      }),
      trace({
        traceId: "err_2",
        status: "error",
        spans: [span({ id: "root", parentId: null, status: "error", error: "boom" })],
      }),
    ];

    const summary = summarizeNoise(traces, { sampleRate: 0.1 });
    expect(summary.total).toBe(22);
    expect(summary.kept + summary.sampledOut).toBe(22);
    expect(summary.keptForSignal).toBe(2);
    expect(summary.keptBySampling).toBe(summary.kept - 2);
    expect(summary.errorTraces).toBe(2);
    expect(summary.sampledOut).toBeGreaterThan(0);
    expect(summary.keptRatio + summary.noiseRatio).toBeCloseTo(1, 10);
    expect(summary.topReasons[0]).toMatchObject({ signal: "error_span", count: 2 });
    expect(summary.topReasons.map((r) => r.signal)).toContain("retry_loop");
  });

  it("keeps everything at rate 1 and only the signal at rate 0", () => {
    const traces = [
      ...Array.from({ length: 5 }, (_, i) => healthyTrace(`h_${i}`)),
      trace({ traceId: "e", status: "error", spans: [span({ id: "root", parentId: null, status: "error", error: "x" })] }),
    ];
    expect(summarizeNoise(traces, { sampleRate: 1 }).kept).toBe(6);
    const strict = summarizeNoise(traces, { sampleRate: 0 });
    expect(strict.kept).toBe(1);
    expect(strict.sampledOut).toBe(5);
  });

  it("handles an empty batch without dividing by zero", () => {
    expect(summarizeNoise([])).toMatchObject({
      total: 0,
      kept: 0,
      sampledOut: 0,
      keptRatio: 0,
      noiseRatio: 0,
      averageScore: 0,
      topReasons: [],
    });
  });
});
