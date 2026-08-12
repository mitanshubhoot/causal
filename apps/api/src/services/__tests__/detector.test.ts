import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createFastifyStub, type PgStub, type Row } from "./pg-stub.js";

/**
 * The detector's judge is an LLM, so everything it returns is untrusted input.
 * These tests drive `runDetector` with a stubbed Anthropic client and a stubbed
 * pg, and assert that the Verdict zod schema coerces the judge's output into
 * something the CHECK constraints on `trace_findings` will accept.
 */

const judge = vi.hoisted(() => ({
  /** Raw assistant text the stubbed judge replies with. */
  reply: "",
  /** When set, `messages.create` rejects with it. */
  fail: null as Error | null,
  calls: 0,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class {
    messages = {
      create: async (): Promise<{ content: Array<{ type: string; text: string }> }> => {
        judge.calls++;
        if (judge.fail) throw judge.fail;
        return { content: [{ type: "text", text: judge.reply }] };
      },
    };
  },
}));

const ORG = "org_test";
const TRACE_ID = "trace_1";

type RunDetector = (fastify: FastifyInstance, orgId: string, traceId: string) => Promise<Row | null>;

/**
 * Import `detector.ts` fresh. `config` snapshots `process.env` at import time
 * and the Anthropic client is a module singleton, so env has to be set before
 * the import and the registry reset to change it.
 */
async function loadDetector(minConfidence = "0"): Promise<RunDetector> {
  vi.resetModules();
  // Any key that isn't the "sk-ant-..." placeholder takes detector.ts out of
  // demo mode, so the (mocked) LLM judge runs instead of the heuristic.
  process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-key-not-a-placeholder";
  process.env["MIN_CONFIDENCE_THRESHOLD"] = minConfidence;
  process.env["ENABLE_SLACK_NOTIFICATIONS"] = "false";
  process.env["ENABLE_AUTO_RCA"] = "false";
  const mod = await import("../detector.js");
  return mod.runDetector as RunDetector;
}

function spanRow(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    parent_id: null,
    name: `span.${id}`,
    kind: "tool",
    start_ms: 0,
    duration_ms: 10,
    status: "ok",
    attributes: [],
    io: null,
    git: null,
    code: null,
    tokens_in: null,
    tokens_out: null,
    cost: null,
    error: null,
    ...over,
  };
}

/** A stubbed fastify whose `getTrace` returns `spans` and whose writes are recorded. */
function stubFor(spans: Row[]): { fastify: FastifyInstance; pg: PgStub } {
  return createFastifyStub((q) => {
    if (/FROM traces\b/.test(q.text)) {
      return [
        {
          id: TRACE_ID,
          service: "booking-agent",
          environment: "production",
          root_name: "booking_agent.run",
          status: "error",
          model: "claude-sonnet-4-5",
          tokens_in: 0,
          tokens_out: 0,
          cost: 0,
          span_count: spans.length,
          repo: null,
          git_ref: null,
          user_id: null,
          session_id: null,
          metadata: [],
          started_at: new Date("2026-08-11T09:00:00.000Z"),
        },
      ];
    }
    if (/FROM spans\b/.test(q.text)) return spans;
    if (/FROM trace_findings\b/.test(q.text)) return [];
    if (/FROM detectors\b/.test(q.text)) return [{ id: "detector_1" }];
    return [];
  });
}

/** Whether the run was recorded as identified (that INSERT carries `finding_id`). */
function recordedIdentified(pg: PgStub): boolean {
  const run = pg.find(/INSERT INTO detector_runs/);
  if (!run) throw new Error("no detector_runs INSERT recorded");
  return /finding_id/.test(run.text);
}

let runDetector: RunDetector;

beforeAll(async () => {
  runDetector = await loadDetector("0");
});

beforeEach(() => {
  judge.reply = "";
  judge.fail = null;
  judge.calls = 0;
});

describe("Verdict validation — enum coercion", () => {
  it("coerces a detector outside the enum to tool_failure", async () => {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "cosmic_ray",
      severity: "critical",
      confidence: 0.9,
      title: "Something exploded",
      summary: "The judge invented a class we do not have a column value for.",
      triggeredSpanId: "s1",
    });
    const { fastify } = stubFor([spanRow("s1")]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["detector"]).toBe("tool_failure");
  });

  it("coerces a severity outside the enum to medium", async () => {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "hallucination",
      severity: "apocalyptic",
      confidence: 0.9,
      title: "Fabricated a booking reference",
      triggeredSpanId: "s1",
    });
    const { fastify } = stubFor([spanRow("s1")]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["severity"]).toBe("medium");
    expect(result?.["detector"]).toBe("hallucination");
    // summary is optional on the wire but never null in the row.
    expect(result?.["summary"]).toBe("");
  });
});

describe("Verdict validation — confidence coercion", () => {
  async function confidenceOf(confidence: unknown): Promise<number> {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "tool_failure",
      severity: "high",
      confidence,
      title: "Payment API returned 500",
      triggeredSpanId: "s1",
    });
    const { fastify } = stubFor([spanRow("s1")]);
    const result = await runDetector(fastify, ORG, TRACE_ID);
    return result?.["confidence"] as number;
  }

  it("reads a percentage-style 95 as 0.95", async () => {
    expect(await confidenceOf(95)).toBeCloseTo(0.95, 10);
  });

  it("clamps anything above 100 to 1", async () => {
    expect(await confidenceOf(150)).toBe(1);
    expect(await confidenceOf(1000)).toBe(1);
  });

  it("clamps a negative confidence to 0", async () => {
    expect(await confidenceOf(-5)).toBe(0);
  });

  it("coerces a numeric string", async () => {
    expect(await confidenceOf("0.75")).toBeCloseTo(0.75, 10);
  });

  it("never leaves confidence outside [0, 1] — the range the CHECK constraint allows", async () => {
    for (const raw of [0, 0.5, 1, 1.5, 95, 150, -1]) {
      const c = await confidenceOf(raw);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("treats 1.5 as 1.5 percent — a known wart in the >1 heuristic", async () => {
    // `n > 1 ? n / 100 : n` assumes anything above 1 is a percentage, so a judge
    // that overshoots slightly (1.5) collapses to 0.015 rather than clamping to
    // 1. Locked in deliberately: the constraint is satisfied either way, and
    // changing it should be a conscious decision, not an accident.
    expect(await confidenceOf(1.5)).toBeCloseTo(0.015, 10);
  });
});

describe("Verdict validation — triggeredSpanId", () => {
  it("falls back to the first error span when the judge names a span that does not exist", async () => {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "tool_failure",
      severity: "critical",
      confidence: 0.9,
      title: "Booking tool failed",
      triggeredSpanId: "span_that_never_existed",
    });
    const { fastify } = stubFor([
      spanRow("s1", { status: "ok" }),
      spanRow("s2", { status: "error", error: "HTTP 500" }),
      spanRow("s3", { status: "error", error: "downstream gave up" }),
    ]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["triggeredSpanId"]).toBe("s2");
  });

  it("falls back to the first span when nothing errored", async () => {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "intent_drift",
      severity: "medium",
      confidence: 0.8,
      title: "Answered a different question",
      triggeredSpanId: "nope",
    });
    const { fastify } = stubFor([spanRow("s1"), spanRow("s2")]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["triggeredSpanId"]).toBe("s1");
  });

  it("keeps a span id that really is in the trace", async () => {
    judge.reply = JSON.stringify({
      identified: true,
      detector: "tool_failure",
      severity: "critical",
      confidence: 0.9,
      title: "Booking tool failed",
      triggeredSpanId: "s3",
    });
    const { fastify } = stubFor([spanRow("s1"), spanRow("s2", { status: "error" }), spanRow("s3")]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["triggeredSpanId"]).toBe("s3");
  });
});

describe("runDetector — judge failure modes", () => {
  it("falls back to the heuristic when the judge returns unparseable output", async () => {
    judge.reply = "I am terribly sorry, I cannot comply.";
    const { fastify } = stubFor([
      spanRow("s1"),
      spanRow("s2", { status: "error", error: "connect ECONNREFUSED", kind: "http" }),
    ]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(result?.["detector"]).toBe("tool_failure");
    expect(result?.["confidence"]).toBe(0.92);
    expect(result?.["triggeredSpanId"]).toBe("s2");
    expect(String(result?.["title"])).toContain("ECONNREFUSED");
  });

  it("falls back to the heuristic when the judge's JSON fails the schema", async () => {
    // title is required and must be non-empty — safeParse fails, verdict is null.
    judge.reply = JSON.stringify({
      identified: true,
      detector: "hallucination",
      severity: "critical",
      confidence: 0.99,
      title: "",
      triggeredSpanId: "s2",
    });
    const { fastify } = stubFor([spanRow("s1"), spanRow("s2", { status: "error", error: "boom", kind: "llm" })]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    // The heuristic reads the span kind, not the judge's discarded verdict.
    expect(result?.["detector"]).toBe("hallucination");
    expect(result?.["confidence"]).toBe(0.92);
  });

  it("survives the judge throwing, and still records a run", async () => {
    judge.fail = new Error("anthropic exploded");
    const { fastify, pg } = stubFor([spanRow("s1", { status: "warn" })]);

    const result = await runDetector(fastify, ORG, TRACE_ID);
    expect(judge.calls).toBe(1);
    // warn-only trace → heuristic intent_drift at 0.8.
    expect(result?.["detector"]).toBe("intent_drift");
    expect(recordedIdentified(pg)).toBe(true);
  });

  it("records a clean run and writes no finding when the judge says identified=false", async () => {
    judge.reply = JSON.stringify({
      identified: false,
      detector: "tool_failure",
      severity: "medium",
      confidence: 0.1,
      title: "Healthy run",
      triggeredSpanId: "s1",
    });
    const { fastify, pg } = stubFor([spanRow("s1")]);

    expect(await runDetector(fastify, ORG, TRACE_ID)).toBeNull();
    expect(pg.find(/INSERT INTO trace_findings/)).toBeUndefined();
    expect(recordedIdentified(pg)).toBe(false);
  });

  it("returns null for a trace that does not exist", async () => {
    const { fastify, pg } = createFastifyStub(() => []);
    expect(await runDetector(fastify, ORG, "missing")).toBeNull();
    expect(pg.find(/INSERT INTO detector_runs/)).toBeUndefined();
  });
});

describe("runDetector — confidence floor", () => {
  it("discards a verdict below MIN_CONFIDENCE_THRESHOLD without writing a finding", async () => {
    const strict = await loadDetector("0.9");
    judge.reply = JSON.stringify({
      identified: true,
      detector: "safety",
      severity: "high",
      confidence: 0.6,
      title: "Maybe leaked a token",
      triggeredSpanId: "s1",
    });
    const { fastify, pg } = stubFor([spanRow("s1")]);

    expect(await strict(fastify, ORG, TRACE_ID)).toBeNull();
    expect(pg.find(/INSERT INTO trace_findings/)).toBeUndefined();
    expect(recordedIdentified(pg)).toBe(false);
  });
});
