import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFastifyStub, type Row } from "./pg-stub.js";
import { runEval } from "../evals.js";
import { spanSignature } from "../datasets.js";

/**
 * An eval run's job is to turn evidence into a defensible verdict. These tests
 * pin the four things a user actually relies on:
 *
 *   1. an assertion that fails makes the CASE fail, and says which one and why
 *   2. `delta` reports movement against the previous run — and never invents a
 *      regression for a case that has no baseline
 *   3. the run records what it gated (release, commit) and who ACTUALLY judged it
 *   4. every case in the dataset is judged before the run claims `complete`
 *
 * The signature evaluator is deterministic with no provider configured, which is
 * the default here, so most of these run without a model.
 */

/**
 * Mock the BYOK layer, not a provider SDK. `runEval` resolves its judge per
 * workspace through `llm.ts`, so that is the real seam — and mocking it keeps
 * these tests true whichever provider an org runs on. `model: null` is how "no
 * provider is reachable" is signalled, which drops the run to the signature judge.
 */
const llm = vi.hoisted(() => ({
  model: null as string | null,
  reply: "",
  calls: 0,
}));

vi.mock("../llm.js", () => ({
  resolveForPurpose: async () =>
    llm.model ? { provider: "anthropic", model: llm.model, source: "org" } : null,
  complete: async () => {
    llm.calls++;
    return llm.model
      ? { text: llm.reply, model: llm.model, provider: "anthropic", tokensIn: 120, tokensOut: 40 }
      : null;
  },
}));

beforeEach(() => {
  llm.model = null;
  llm.reply = "";
  llm.calls = 0;
});

const SIGNATURE = spanSignature({
  name: "tool.resolve_rollout_flag",
  kind: "tool",
  status: "error",
  error: "AttributeError: no attribute 'checkout_v2_enabled'",
});

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const DATASET_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

/** Promoted well before any evidence, so recurrences count. */
const PROMOTED_AT = new Date("2026-08-01T00:00:00Z");
const SEEN_AT = new Date("2026-08-10T00:00:00Z");

interface Options {
  /** Production spans the evidence query returns. */
  spans?: Row[];
  /** How this case did in the previous complete run (undefined → no baseline). */
  previouslyPassed?: boolean;
  assertions?: unknown[];
  /** The dataset's golden cases. Served page by page, like the real table. */
  items?: Row[];
}

function goldenItem(id: string, assertions?: unknown[]): Row {
  return {
    id,
    dataset_id: DATASET_ID,
    trace_id: "t-1",
    finding_id: null,
    title: "Checkout survives a missing rollout flag",
    input: { failingSpan: { name: "tool.resolve_rollout_flag" } },
    expected: { behaviour: "degrades to legacy" },
    span_signature: SIGNATURE,
    assertions: assertions ?? [
      { id: "a1", kind: "must_not_raise", description: "resolver does not raise", target: "span.status != error" },
    ],
    tags: ["rollout"],
    severity: "critical",
    difficulty: "regression",
    notes: null,
    created_at: PROMOTED_AT,
  };
}

function stub(opts: Options = {}) {
  const spans = opts.spans ?? [];
  const items = opts.items ?? [goldenItem(ITEM_ID, opts.assertions)];
  return createFastifyStub((q): Row[] => {
    // getDatasetMeta → the dataset row and its true item count
    if (/FROM datasets/.test(q.text) && /SELECT id, name/.test(q.text)) {
      return [{ id: DATASET_ID, name: "checkout-regressions", description: null, created_at: PROMOTED_AT, item_count: items.length }];
    }
    // listAllDatasetItems → one page of golden cases (… LIMIT ? OFFSET ?)
    if (/FROM dataset_items/.test(q.text)) {
      const offset = Number(q.values[q.values.length - 1] ?? 0);
      const limit = Number(q.values[q.values.length - 2] ?? items.length);
      return items.slice(offset, offset + limit);
    }
    // previousVerdicts. Matched BEFORE the eval_runs branch below: this query
    // selects from eval_results but contains an `eval_runs … LIMIT 1` subquery,
    // so a looser branch order silently answers it with the wrong fixture.
    if (/FROM eval_results res/.test(q.text)) {
      return opts.previouslyPassed === undefined
        ? []
        : [{ dataset_item_id: ITEM_ID, passed: opts.previouslyPassed }];
    }
    // getDataset → its most recent run (before this one)
    if (/FROM eval_runs/.test(q.text) && /ORDER BY started_at DESC/.test(q.text) && /LIMIT 1/.test(q.text)) {
      return [];
    }
    // the new run row
    if (/INSERT INTO eval_runs/.test(q.text)) {
      return [{ id: RUN_ID, started_at: SEEN_AT }];
    }
    // evidence: recent production spans
    if (/FROM spans/.test(q.text)) return spans;
    return [];
  });
}

/** The PendingResult rows handed to the bulk insert. */
function insertedResults(h: ReturnType<typeof stub>): Row[] {
  const q = h.pg.queries.find((x) => /INSERT INTO eval_results/.test(x.text));
  const bulk = q?.values.find((v) => typeof v === "object" && v !== null && "__bulk" in (v as object)) as
    | { __bulk: Row[] }
    | undefined;
  return bulk?.__bulk ?? [];
}

const errorSpan = {
  trace_id: "t-bad",
  span_id: "s-1",
  name: "tool.resolve_rollout_flag",
  kind: "tool",
  status: "error",
  error: "AttributeError: no attribute 'checkout_v2_enabled'",
  io: null,
  service: "storefront-checkout",
  started_at: SEEN_AT,
};
const okSpan = { ...errorSpan, trace_id: "t-ok", span_id: "s-2", status: "ok", error: null };

describe("runEval — assertions", () => {
  it("fails the case when a must_not_raise assertion is contradicted, naming the trace", async () => {
    const h = stub({ spans: [errorSpan] });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    const [row] = insertedResults(h);
    expect(row?.["passed"]).toBe(false);
    const assertions = (row?.["assertion_results"] as { __json: Array<{ id: string; passed: boolean; detail: string }> })
      .__json;
    expect(assertions).toHaveLength(1);
    expect(assertions[0]!.passed).toBe(false);
    // The detail must point at real evidence, not just say "failed".
    expect(assertions[0]!.detail).toContain("t-bad");
    expect(run?.score).toBe(0);
  });

  it("passes and cites how many clean runs backed the verdict", async () => {
    const h = stub({ spans: [okSpan, { ...okSpan, trace_id: "t-ok-2", span_id: "s-3" }] });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    const assertions = (insertedResults(h)[0]?.["assertion_results"] as {
      __json: Array<{ passed: boolean; detail: string }>;
    }).__json;
    expect(assertions[0]!.passed).toBe(true);
    expect(assertions[0]!.detail).toMatch(/2 production run/);
  });

  it("records one result per assertion, so nothing is silently unchecked", async () => {
    const h = stub({
      spans: [okSpan],
      assertions: [
        { id: "a1", kind: "must_not_raise", description: "no raise", target: "x" },
        { id: "a2", kind: "must_call_tool", description: "tool ran", target: "y" },
        { id: "a3", kind: "must_contain", description: "text present", target: "z" },
      ],
    });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    const assertions = (insertedResults(h)[0]?.["assertion_results"] as {
      __json: Array<{ id: string; detail: string }>;
    }).__json;
    expect(assertions.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    // An assertion this evaluator cannot check must SAY so rather than tick silently.
    expect(assertions[2]!.detail).toMatch(/unproven/);
  });

  it("treats a case with no assertions as signature-only, not as vacuously passing", async () => {
    const h = stub({ spans: [errorSpan], assertions: [] });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    const [row] = insertedResults(h);
    expect((row?.["assertion_results"] as { __json: unknown[] }).__json).toEqual([]);
    // The signature still recurred, so the case still fails.
    expect(row?.["passed"]).toBe(false);
  });
});

describe("runEval — delta", () => {
  it("reports `regressed` when a passing case starts failing", async () => {
    const h = stub({ spans: [errorSpan], previouslyPassed: true });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    expect(insertedResults(h)[0]?.["delta"]).toBe("regressed");
  });

  it("reports `fixed` when a failing case starts passing", async () => {
    const h = stub({ spans: [okSpan], previouslyPassed: false });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    expect(insertedResults(h)[0]?.["delta"]).toBe("fixed");
  });

  it("reports `unchanged` when the verdict held", async () => {
    const h = stub({ spans: [okSpan], previouslyPassed: true });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    expect(insertedResults(h)[0]?.["delta"]).toBe("unchanged");
  });

  it("never calls a first-ever failure a regression — there is no baseline to regress from", async () => {
    const h = stub({ spans: [errorSpan] }); // no previous run
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    const [row] = insertedResults(h);
    expect(row?.["passed"]).toBe(false);
    expect(row?.["delta"]).toBe("unchanged");
  });

  it("compares only against COMPLETE runs, so a failed run is not a baseline", async () => {
    const h = stub({ spans: [okSpan] });
    await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    const q = h.pg.queries.find((x) => /FROM eval_results res/.test(x.text));
    expect(q?.text).toMatch(/status = 'complete'/);
  });
});

describe("runEval — run identity", () => {
  it("records the release and commit it gated, and the judge that scored it", async () => {
    const h = stub({ spans: [okSpan] });
    const run = await runEval(h.fastify, "org1", {
      datasetId: DATASET_ID,
      release: "storefront-2026.08.12",
      commit: "c02b1d5e",
    });

    expect(run?.release).toBe("storefront-2026.08.12");
    expect(run?.commit).toBe("c02b1d5e");
    expect(run?.judgeModel).toBe("deterministic");

    const insert = h.pg.queries.find((x) => /INSERT INTO eval_runs/.test(x.text));
    expect(insert?.values).toContain("storefront-2026.08.12");
    expect(insert?.values).toContain("c02b1d5e");
  });

  it("leaves release and commit null rather than inventing them", async () => {
    const h = stub({ spans: [okSpan] });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    expect(run?.release).toBeNull();
    expect(run?.commit).toBeNull();
  });

  it("names the model that ACTUALLY judged, whichever provider the workspace runs on", async () => {
    llm.model = "gemini-2.0-flash";
    llm.reply = '{"passed": true, "score": 0.9, "reason": "the resolver degraded to legacy in every run"}';
    const h = stub({ spans: [okSpan] });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    expect(llm.calls).toBe(1);
    expect(run?.judgeModel).toBe("gemini-2.0-flash");
    const actual = (insertedResults(h)[0]?.["actual"] as { __json: Record<string, unknown> }).__json;
    expect(actual["judge"]).toBe("gemini-2.0-flash");
    // Real usage from the provider — the evidence behind any future cost claim.
    expect(actual["judgeTokensIn"]).toBe(120);
  });

  it("records `deterministic` when no provider is reachable, so the gate never implies a semantic judge it did not run", async () => {
    const h = stub({ spans: [okSpan] });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    expect(llm.calls).toBe(0);
    expect(run?.judgeModel).toBe("deterministic");
    const actual = (insertedResults(h)[0]?.["actual"] as { __json: Record<string, unknown> }).__json;
    expect(actual["judge"]).toBe("deterministic");
    expect(actual["judgeTokensIn"]).toBeNull();
  });

  it("reports cost as null rather than $0.0000, which nothing here measured", async () => {
    const h = stub({ spans: [okSpan] });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });
    expect(run?.costUsd).toBeNull();
    // Never written as 0 either — the column default carries "not measured".
    expect(Object.keys(insertedResults(h)[0] ?? {})).not.toContain("cost_usd");
  });
});

describe("runEval — coverage", () => {
  it("judges every case, not just the newest page, before claiming `complete`", async () => {
    // One case past the page size: a paged run that stopped at the first page
    // would report a clean 500 and drop the oldest, longest-standing case.
    const items = Array.from({ length: 501 }, (_, i) => goldenItem(`item-${i}`));
    const h = stub({ spans: [okSpan], items });
    const run = await runEval(h.fastify, "org1", { datasetId: DATASET_ID });

    expect(run?.status).toBe("complete");
    expect(run?.total).toBe(501);
    expect(insertedResults(h)).toHaveLength(501);
  });
});
