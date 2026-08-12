import { describe, expect, it } from "vitest";
import { ingestTrace, type IngestSpan, type IngestTrace } from "../traces.js";
import { createFastifyStub, isBulk, unwrapJson, type Row } from "./pg-stub.js";

const ORG = "org_test";

function span(over: Partial<IngestSpan> & Pick<IngestSpan, "id">): IngestSpan {
  return { name: over.id, kind: "function", ...over };
}

/** Ingest a trace against a stubbed pg and hand back the recorded `traces` row. */
async function ingest(over: Partial<IngestTrace> = {}): Promise<{ row: Row; spans: Row[] }> {
  const { fastify, pg } = createFastifyStub();
  const trace: IngestTrace = {
    traceId: "trace_1",
    service: "booking-agent",
    spans: [],
    ...over,
  };
  await ingestTrace(fastify, ORG, trace);
  const row = pg.insertInto("traces");
  if (!row) throw new Error("no INSERT INTO traces recorded");
  const bulk = pg.find(/INSERT INTO spans/)?.values[0];
  return { row, spans: isBulk(bulk) ? bulk.__bulk : [] };
}

describe("ingestTrace — status rollup", () => {
  it("rolls a single error span up to an error trace", async () => {
    const { row } = await ingest({
      spans: [span({ id: "a", status: "ok" }), span({ id: "b", status: "error" }), span({ id: "c", status: "warn" })],
    });
    expect(row["status"]).toBe("error");
  });

  it("rolls warn up only when nothing errored", async () => {
    const { row } = await ingest({
      spans: [span({ id: "a", status: "ok" }), span({ id: "b", status: "warn" })],
    });
    expect(row["status"]).toBe("warn");
  });

  it("stays ok when every span is ok — and when status is omitted entirely", async () => {
    const allOk = await ingest({ spans: [span({ id: "a", status: "ok" }), span({ id: "b", status: "ok" })] });
    expect(allOk.row["status"]).toBe("ok");

    const noStatus = await ingest({ spans: [span({ id: "a" }), span({ id: "b" })] });
    expect(noStatus.row["status"]).toBe("ok");
    // …and the spans themselves default to "ok" on the way into the table.
    expect(noStatus.spans.map((s) => s["status"])).toEqual(["ok", "ok"]);
  });

  it("is ok for an empty trace", async () => {
    const { row } = await ingest({ spans: [] });
    expect(row["status"]).toBe("ok");
    expect(row["span_count"]).toBe(0);
    expect(row["root_name"]).toBeNull();
  });
});

describe("ingestTrace — span economics rollup", () => {
  it("prefers the sum of the spans over client-supplied trace totals", async () => {
    const { row } = await ingest({
      // The client claims these; the spans disagree. The spans win.
      tokensIn: 1,
      tokensOut: 2,
      cost: 0.5,
      spans: [
        span({ id: "a", kind: "llm", tokensIn: 100, tokensOut: 40, cost: 0.01 }),
        span({ id: "b", kind: "llm", tokensIn: 250, tokensOut: 60, cost: 0.02 }),
        span({ id: "c", kind: "tool" }),
      ],
    });
    expect(row["tokens_in"]).toBe(350);
    expect(row["tokens_out"]).toBe(100);
    expect(row["cost"]).toBeCloseTo(0.03, 10);
  });

  it("falls back to the client totals when no span carries economics", async () => {
    const { row } = await ingest({
      tokensIn: 1200,
      tokensOut: 300,
      cost: 0.42,
      spans: [span({ id: "a", kind: "tool" }), span({ id: "b", kind: "http" })],
    });
    expect(row["tokens_in"]).toBe(1200);
    expect(row["tokens_out"]).toBe(300);
    expect(row["cost"]).toBe(0.42);
  });

  it("is zero when neither the spans nor the client supply anything", async () => {
    const { row } = await ingest({ spans: [span({ id: "a" })] });
    expect(row["tokens_in"]).toBe(0);
    expect(row["tokens_out"]).toBe(0);
    expect(row["cost"]).toBe(0);
  });
});

describe("ingestTrace — startedAt", () => {
  it("keeps a valid ISO timestamp", async () => {
    const iso = "2026-08-11T09:30:00.000Z";
    const { row } = await ingest({ startedAt: iso });
    expect(row["started_at"]).toBeInstanceOf(Date);
    expect((row["started_at"] as Date).toISOString()).toBe(iso);
  });

  it("falls back to now when startedAt is unparseable", async () => {
    const before = Date.now();
    const { row } = await ingest({ startedAt: "not-a-timestamp" });
    const after = Date.now();

    const startedAt = row["started_at"];
    expect(startedAt).toBeInstanceOf(Date);
    const ms = (startedAt as Date).getTime();
    expect(Number.isNaN(ms)).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("falls back to now when startedAt is absent", async () => {
    const before = Date.now();
    const { row } = await ingest({});
    expect((row["started_at"] as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("ingestTrace — write shape", () => {
  it("replaces any prior version of the trace before re-inserting it", async () => {
    const { fastify, pg } = createFastifyStub();
    await ingestTrace(fastify, ORG, {
      traceId: "trace_1",
      service: "svc",
      spans: [span({ id: "a" })],
    });

    const del = pg.find(/DELETE FROM traces/);
    expect(del).toBeDefined();
    expect(del?.values).toEqual(["trace_1", ORG]);
    // The delete has to precede the insert, or the re-ingest would drop the new row.
    expect(pg.queries.indexOf(del!)).toBeLessThan(pg.queries.findIndex((q) => /INSERT INTO traces/.test(q.text)));
  });

  it("takes the root name from the parentless span and scopes every row to the org", async () => {
    const { row, spans } = await ingest({
      spans: [
        span({ id: "root", name: "booking_agent.run", kind: "agent", parentId: null }),
        span({ id: "child", name: "llm.plan", kind: "llm", parentId: "root" }),
      ],
    });
    expect(row["root_name"]).toBe("booking_agent.run");
    expect(row["org_id"]).toBe(ORG);
    expect(row["span_count"]).toBe(2);
    expect(spans.map((s) => s["org_id"])).toEqual([ORG, ORG]);
    expect(spans.map((s) => s["parent_id"])).toEqual([null, "root"]);
  });

  it("sends jsonb columns through sql.json rather than as raw values", async () => {
    const { row, spans } = await ingest({
      metadata: [{ label: "env", value: "prod" }],
      spans: [span({ id: "a", attributes: [{ label: "model", value: "claude" }], io: { input: "hi", output: "yo" } })],
    });
    expect(unwrapJson(row["metadata"])).toEqual([{ label: "env", value: "prod" }]);
    expect(unwrapJson(spans[0]?.["attributes"])).toEqual([{ label: "model", value: "claude" }]);
    expect(unwrapJson(spans[0]?.["io"])).toEqual({ input: "hi", output: "yo" });
    // Absent jsonb stays null rather than becoming a PG array literal.
    expect(unwrapJson(spans[0]?.["git"])).toBeNull();
    expect(unwrapJson(spans[0]?.["code"])).toBeNull();
  });

  it("skips the bulk span insert entirely for a trace with no spans", async () => {
    const { fastify, pg } = createFastifyStub();
    const result = await ingestTrace(fastify, ORG, { traceId: "t", service: "svc", spans: [] });
    expect(pg.find(/INSERT INTO spans/)).toBeUndefined();
    expect(result).toEqual({ traceId: "t", spanCount: 0 });
  });
});
