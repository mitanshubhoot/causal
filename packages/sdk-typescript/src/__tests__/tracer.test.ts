import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CausalTracer, type CausalTracerOptions, type SpanKind } from "../tracer.js";

/**
 * The tracer is the only thing between a customer's agent and our ingest
 * endpoint, so two properties matter more than anything else:
 *   1. `toPayload()` matches the wire contract in apps/api/src/routes/traces.ts
 *   2. telemetry never breaks the host app
 * Everything here is aimed at one of those.
 */

/** The `kind` values the ingest endpoint accepts (apps/api/src/services/traces.ts). */
const API_SPAN_KINDS = [
  "agent",
  "llm",
  "tool",
  "http",
  "db",
  "function",
  "skill",
  "workflow",
  "search",
  "shell",
] as const;

const API_SPAN_STATUSES = ["ok", "warn", "error"] as const;

/** A minimal `Response` stand-in — the tracer reads `ok`, `status`, `text`, `headers`. */
function res(status: number, body = "", headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

function newTracer(over: Partial<CausalTracerOptions> = {}): CausalTracer {
  return new CausalTracer({
    service: "booking-agent",
    apiKey: "causal_demo_key_2026",
    baseUrl: "https://api.example.test",
    orgId: "org_test",
    // Backoff is exercised for its call count, not its wall-clock behaviour.
    retryDelayMs: 0,
    ...over,
  });
}

/** The `(url, init)` a `fetch` mock was called with on attempt `n`. */
function callArgs(fetchMock: ReturnType<typeof vi.fn>, n = 0): [string, RequestInit] {
  const call = fetchMock.mock.calls[n];
  if (!call) throw new Error(`fetch was not called ${n + 1} time(s)`);
  return call as unknown as [string, RequestInit];
}

const spansOf = (payload: Record<string, unknown>): Array<Record<string, unknown>> =>
  payload["spans"] as Array<Record<string, unknown>>;

beforeEach(() => {
  // Never let a developer's real shell env leak into these assertions.
  delete process.env["CAUSAL_API_KEY"];
  delete process.env["CAUSAL_API_URL"];
  delete process.env["CAUSAL_ORG_ID"];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("span tree", () => {
  it("wires parentId from child() and from an explicit parent argument", () => {
    const t = newTracer().startTrace();
    const root = t.span("booking_agent.run", "agent", null);
    const plan = root.child("llm.plan", "llm");
    const search = plan.child("tool.search_flights", "tool");
    const sibling = t.span("tool.audit", "tool", root.id);
    const orphan = t.span("function.warmup", "function", null);

    const spans = spansOf(t.toPayload());
    const byId = new Map(spans.map((s) => [s["id"], s]));

    expect(byId.get(root.id)?.["parentId"]).toBeNull();
    expect(byId.get(plan.id)?.["parentId"]).toBe(root.id);
    expect(byId.get(search.id)?.["parentId"]).toBe(plan.id);
    expect(byId.get(sibling.id)?.["parentId"]).toBe(root.id);
    expect(byId.get(orphan.id)?.["parentId"]).toBeNull();

    // Every non-null parent must resolve to a span in the same trace, or ingest
    // writes a dangling edge.
    const ids = new Set(spans.map((s) => s["id"]));
    expect(ids.size).toBe(spans.length);
    for (const s of spans) {
      if (s["parentId"] !== null) expect(ids.has(s["parentId"])).toBe(true);
    }
  });

  it("nests spans under the ambient span inside trace() without being told to", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(202)));

    let rootId = "";
    let planId = "";
    let payload: Record<string, unknown> = {};
    await newTracer().trace("booking_agent.run", async (t, root) => {
      rootId = root.id;
      // No parentId argument anywhere — nesting comes from the ambient context.
      const plan = t.span("llm.plan", "llm");
      planId = plan.id;
      plan.end({ status: "ok" });
      payload = t.toPayload();
    });

    const plan = spansOf(payload).find((s) => s["id"] === planId);
    expect(plan?.["parentId"]).toBe(rootId);
  });

  it("records startMs relative to the trace and durationMs across the span's life", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T09:00:00.000Z"));

    const t = newTracer().startTrace();
    vi.advanceTimersByTime(120);
    const plan = t.span("llm.plan", "llm", null);
    vi.advanceTimersByTime(250);
    plan.end({ status: "ok" });
    vi.advanceTimersByTime(30);
    const call = t.span("http.book", "http", null);
    vi.advanceTimersByTime(1000);
    call.end({ status: "error", error: "504 from upstream" });

    const spans = spansOf(t.toPayload());
    expect(spans[0]).toMatchObject({ name: "llm.plan", startMs: 120, durationMs: 250 });
    expect(spans[1]).toMatchObject({ name: "http.book", startMs: 400, durationMs: 1000 });
    expect(t.toPayload()["startedAt"]).toBe("2026-08-11T09:00:00.000Z");
  });

  it("leaves a never-ended span at duration 0 and status ok rather than dropping it", () => {
    const t = newTracer().startTrace();
    t.span("tool.leaked", "tool", null);
    const spans = spansOf(t.toPayload());
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ durationMs: 0, status: "ok" });
  });
});

describe("span.end", () => {
  it("defaults to ok and honours an explicit status", () => {
    const t = newTracer().startTrace();
    const a = t.span("a", "tool", null);
    a.end();
    const b = t.span("b", "tool", null);
    b.end({ status: "warn" });

    const spans = spansOf(t.toPayload());
    expect(spans[0]?.["status"]).toBe("ok");
    expect(spans[1]?.["status"]).toBe("warn");
  });

  it("infers status=error from an error, but lets an explicit status win", () => {
    const t = newTracer().startTrace();
    const failed = t.span("http.book", "http", null);
    failed.end({ error: "ECONNRESET" });
    const degraded = t.span("http.retry", "http", null);
    degraded.end({ status: "warn", error: "retried once" });

    const spans = spansOf(t.toPayload());
    expect(spans[0]).toMatchObject({ status: "error", error: "ECONNRESET" });
    expect(spans[1]).toMatchObject({ status: "warn", error: "retried once" });
  });

  it("records economics, attributes, io and git verbatim", () => {
    const t = newTracer().startTrace();
    const s = t.span("llm.plan", "llm", null);
    s.end({
      status: "ok",
      tokensIn: 1200,
      tokensOut: 340,
      cost: 0.0182,
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }],
      io: { input: "book me a flight", output: "booked" },
      git: { file: "src/agent.ts", line: 42, commit: "abc1234" },
    });

    expect(spansOf(t.toPayload())[0]).toMatchObject({
      tokensIn: 1200,
      tokensOut: 340,
      cost: 0.0182,
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }],
      io: { input: "book me a flight", output: "booked" },
      git: { file: "src/agent.ts", line: 42, commit: "abc1234" },
    });
  });

  it("is idempotent — a second end() cannot rewrite the first", () => {
    vi.useFakeTimers();
    const t = newTracer().startTrace();
    const s = t.span("tool.charge", "tool", null);
    vi.advanceTimersByTime(100);
    s.end({ status: "error", error: "card declined" });
    vi.advanceTimersByTime(5000);
    s.end({ status: "ok" });

    expect(spansOf(t.toPayload())[0]).toMatchObject({
      status: "error",
      error: "card declined",
      durationMs: 100,
    });
  });
});

describe("toPayload — ingest wire contract", () => {
  it("emits exactly the trace fields POST /api/v1/traces accepts", () => {
    const tracer = newTracer({
      environment: "staging",
      model: "claude-sonnet-4-5",
      repo: "acme/booking",
      gitRef: "main",
      user: "u_1",
      sessionId: "sess_1",
      metadata: [{ label: "tier", value: "enterprise" }],
    });
    const t = tracer.startTrace("trace_abc");
    t.tokensIn = 1200;
    t.tokensOut = 340;
    t.cost = 0.0182;
    t.span("booking_agent.run", "agent", null).end({ status: "ok" });

    const payload = t.toPayload();
    expect(Object.keys(payload).sort()).toEqual([
      "cost",
      "environment",
      "gitRef",
      "metadata",
      "model",
      "repo",
      "service",
      "sessionId",
      "spans",
      "startedAt",
      "tokensIn",
      "tokensOut",
      "traceId",
      "user",
    ]);
    expect(payload).toMatchObject({
      traceId: "trace_abc",
      service: "booking-agent",
      environment: "staging",
      model: "claude-sonnet-4-5",
      repo: "acme/booking",
      gitRef: "main",
      user: "u_1",
      sessionId: "sess_1",
      metadata: [{ label: "tier", value: "enterprise" }],
      tokensIn: 1200,
      tokensOut: 340,
      cost: 0.0182,
    });
    expect(new Date(payload["startedAt"] as string).toISOString()).toBe(payload["startedAt"]);
  });

  it("defaults environment to production and generates a hex trace id", () => {
    const payload = newTracer().startTrace().toPayload();
    expect(payload["environment"]).toBe("production");
    expect(payload["traceId"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("emits spans whose required fields and enums the ingest endpoint accepts", () => {
    const t = newTracer().startTrace();
    const root = t.span("booking_agent.run", "agent", null);
    root.child("llm.plan", "llm").end({ status: "ok", tokensIn: 10, tokensOut: 5, cost: 0.001 });
    root.child("db.lookup", "db").end({ status: "warn" });
    root.end({ status: "error", error: "no seats" });

    const spans = spansOf(t.toPayload());
    expect(spans).toHaveLength(3);
    for (const s of spans) {
      expect(s["id"]).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof s["name"]).toBe("string");
      expect(s["parentId"] === null || typeof s["parentId"] === "string").toBe(true);
      expect(API_SPAN_KINDS).toContain(s["kind"] as SpanKind);
      expect(API_SPAN_STATUSES).toContain(s["status"] as (typeof API_SPAN_STATUSES)[number]);
      expect(Number.isFinite(s["startMs"])).toBe(true);
      expect(Number.isFinite(s["durationMs"])).toBe(true);
    }
    // The payload must survive a JSON round-trip unchanged — it goes over the wire.
    expect(JSON.parse(JSON.stringify(t.toPayload()))["spans"]).toEqual(spans);
  });
});

describe("export", () => {
  it("POSTs the payload to /api/v1/traces with auth and org headers", async () => {
    const fetchMock = vi.fn(async () => res(202));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer();
    const t = tracer.startTrace("trace_abc");
    t.span("booking_agent.run", "agent", null).end({ status: "ok" });
    await t.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = callArgs(fetchMock);
    expect(url).toBe("https://api.example.test/api/v1/traces");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer causal_demo_key_2026");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-causal-org-id"]).toBe("org_test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      traceId: "trace_abc",
      service: "booking-agent",
    });
  });

  it("strips a trailing slash from baseUrl so the path never doubles up", async () => {
    const fetchMock = vi.fn(async () => res(202));
    vi.stubGlobal("fetch", fetchMock);

    await newTracer({ baseUrl: "https://api.example.test/" }).startTrace().flush();
    expect(callArgs(fetchMock)[0]).toBe("https://api.example.test/api/v1/traces");
  });

  it("retries a 500 and gives up after maxRetries attempts", async () => {
    const fetchMock = vi.fn(async () => res(500, "upstream exploded"));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer({ maxRetries: 3 });
    await expect(tracer.export(tracer.startTrace())).rejects.toThrow(/Causal trace export failed: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops retrying as soon as an attempt succeeds", async () => {
    const fetchMock = vi
      .fn(async () => res(202))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(429));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer({ maxRetries: 5 });
    await expect(tracer.export(tracer.startTrace())).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network error too, not just a bad status", async () => {
    const fetchMock = vi
      .fn(async () => res(202))
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer({ maxRetries: 2 });
    await expect(tracer.export(tracer.startTrace())).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx that will never succeed", async () => {
    const fetchMock = vi.fn(async () => res(401, "bad api key"));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer({ maxRetries: 5 });
    await expect(tracer.export(tracer.startTrace())).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats maxRetries: 1 as 'do not retry'", async () => {
    const fetchMock = vi.fn(async () => res(500));
    vi.stubGlobal("fetch", fetchMock);

    const tracer = newTracer({ maxRetries: 1 });
    await expect(tracer.export(tracer.startTrace())).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("telemetry never breaks the host app", () => {
  it("returns the agent's value even when every export attempt 500s", async () => {
    const fetchMock = vi.fn(async () => res(500, "boom"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newTracer({ maxRetries: 2 }).trace("booking_agent.run", async (t) => {
      t.span("tool.search", "tool").end({ status: "ok" });
      return { bookingId: "bk_1" };
    });

    expect(out).toEqual({ bookingId: "bk_1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the agent's value when the network is down entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      })
    );
    await expect(newTracer({ maxRetries: 1 }).trace("run", async () => "done")).resolves.toBe("done");
  });

  it("fails open with no API key: records locally, sends nothing, throws nothing", async () => {
    const fetchMock = vi.fn(async () => res(202));
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // No apiKey option and no CAUSAL_API_KEY in the environment.
    const tracer = new CausalTracer({ service: "booking-agent", baseUrl: "https://api.example.test" });
    const out = await tracer.trace("run", async (t) => {
      t.span("tool.search", "tool").end({ status: "ok" });
      return "done";
    });

    expect(out).toBe("done");
    // A guaranteed 401 is not worth the round trip, so nothing goes out…
    expect(fetchMock).not.toHaveBeenCalled();
    // …and export() resolves rather than throwing.
    await expect(tracer.export(tracer.startTrace())).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("still flushes — and marks the root span errored — when the agent throws", async () => {
    const fetchMock = vi.fn(async () => res(202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      newTracer().trace("booking_agent.run", async (_t, root) => {
        root.child("tool.charge", "tool").end({ status: "error", error: "card declined" });
        throw new Error("payment failed");
      })
    ).rejects.toThrow("payment failed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(callArgs(fetchMock)[1].body as string) as {
      spans: Array<{ parentId: string | null }>;
    };
    const root = body.spans.find((s) => s.parentId === null);
    expect(root).toMatchObject({
      name: "booking_agent.run",
      kind: "agent",
      status: "error",
      error: "payment failed",
    });
    expect(body.spans).toHaveLength(2);
  });
});
