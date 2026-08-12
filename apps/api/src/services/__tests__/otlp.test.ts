import { describe, it, expect } from "vitest";
import { convertOtlp, type OtlpPayload } from "../otlp.js";

const ns = (ms: number) => String(BigInt(ms) * 1_000_000n);

function payload(spans: Record<string, unknown>[], service = "booking-agent"): OtlpPayload {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
        scopeSpans: [{ spans: spans as never }],
      },
    ],
  };
}

describe("convertOtlp", () => {
  it("maps a root span and rebases offsets to the trace start", () => {
    const out = convertOtlp(
      payload([
        { traceId: "t1", spanId: "aaaa", name: "run", startTimeUnixNano: ns(1000), endTimeUnixNano: ns(3000) },
        { traceId: "t1", spanId: "bbbb", parentSpanId: "aaaa", name: "step", startTimeUnixNano: ns(1500), endTimeUnixNano: ns(2000) },
      ])
    );
    const t = out.get("t1")!;
    expect(t.service).toBe("booking-agent");
    expect(t.spans).toHaveLength(2);

    const root = t.spans.find((s) => s.id === "aaaa")!;
    expect(root.parentId).toBeNull();
    expect(root.startMs).toBe(0); // rebased
    expect(root.durationMs).toBe(2000);

    const child = t.spans.find((s) => s.id === "bbbb")!;
    expect(child.parentId).toBe("aaaa");
    expect(child.startMs).toBe(500);
    expect(child.durationMs).toBe(500);
  });

  it("treats an all-zero parentSpanId as a root", () => {
    const out = convertOtlp(
      payload([{ traceId: "t2", spanId: "aaaa", parentSpanId: "0000000000000000", name: "run" }])
    );
    expect(out.get("t2")!.spans[0]!.parentId).toBeNull();
  });

  it("promotes gen_ai token usage and model, and classifies the span as llm", () => {
    const out = convertOtlp(
      payload([
        {
          traceId: "t3",
          spanId: "aaaa",
          name: "chat",
          attributes: [
            { key: "gen_ai.system", value: { stringValue: "anthropic" } },
            { key: "gen_ai.request.model", value: { stringValue: "claude-sonnet-4-5" } },
            { key: "gen_ai.usage.input_tokens", value: { intValue: "1200" } },
            { key: "gen_ai.usage.output_tokens", value: { intValue: "340" } },
            { key: "gen_ai.prompt", value: { stringValue: "hello" } },
            { key: "gen_ai.completion", value: { stringValue: "hi" } },
          ],
        },
      ])
    );
    const t = out.get("t3")!;
    const s = t.spans[0]!;
    expect(s.kind).toBe("llm");
    expect(s.tokensIn).toBe(1200);
    expect(s.tokensOut).toBe(340);
    expect(s.io).toEqual({ input: "hello", output: "hi" });
    expect(t.model).toBe("claude-sonnet-4-5");
    // promoted attributes must not be duplicated into the attribute list
    expect(s.attributes?.some((a) => a.label === "gen_ai.usage.input_tokens")).toBe(false);
    expect(s.attributes?.some((a) => a.label === "gen_ai.system")).toBe(true);
  });

  it("supports legacy prompt/completion token attribute names", () => {
    const out = convertOtlp(
      payload([
        {
          traceId: "t4",
          spanId: "aaaa",
          name: "chat",
          attributes: [
            { key: "gen_ai.usage.prompt_tokens", value: { intValue: "10" } },
            { key: "gen_ai.usage.completion_tokens", value: { intValue: "20" } },
          ],
        },
      ])
    );
    const s = out.get("t4")!.spans[0]!;
    expect(s.tokensIn).toBe(10);
    expect(s.tokensOut).toBe(20);
  });

  it("marks ERROR status and takes the message from an exception event", () => {
    const out = convertOtlp(
      payload([
        {
          traceId: "t5",
          spanId: "aaaa",
          name: "tool.call",
          status: { code: 2 },
          events: [
            { name: "exception", attributes: [{ key: "exception.message", value: { stringValue: "KeyError: 'change'" } }] },
          ],
        },
      ])
    );
    const s = out.get("t5")!.spans[0]!;
    expect(s.status).toBe("error");
    expect(s.error).toBe("KeyError: 'change'");
  });

  it("derives git context from code.* attributes", () => {
    const out = convertOtlp(
      payload([
        {
          traceId: "t6",
          spanId: "aaaa",
          name: "fn",
          attributes: [
            { key: "code.filepath", value: { stringValue: "app/x.py" } },
            { key: "code.lineno", value: { intValue: "42" } },
            { key: "causal.git.commit", value: { stringValue: "b91f0ac4" } },
          ],
        },
      ])
    );
    expect(out.get("t6")!.spans[0]!.git).toEqual({ file: "app/x.py", line: 42, commit: "b91f0ac4" });
  });

  it("classifies db and http spans from semantic conventions", () => {
    const out = convertOtlp(
      payload([
        { traceId: "t7", spanId: "a1", name: "q", attributes: [{ key: "db.system", value: { stringValue: "postgres" } }] },
        { traceId: "t7", spanId: "a2", name: "r", attributes: [{ key: "http.request.method", value: { stringValue: "GET" } }] },
      ])
    );
    const spans = out.get("t7")!.spans;
    expect(spans.find((s) => s.id === "a1")!.kind).toBe("db");
    expect(spans.find((s) => s.id === "a2")!.kind).toBe("http");
  });

  it("groups spans from separate resourceSpans into one trace", () => {
    const out = convertOtlp({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "svc" } }] },
          scopeSpans: [{ spans: [{ traceId: "t8", spanId: "a1", name: "one" }] as never }],
        },
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "svc" } }] },
          scopeSpans: [{ spans: [{ traceId: "t8", spanId: "a2", name: "two" }] as never }],
        },
      ],
    });
    expect(out.size).toBe(1);
    expect(out.get("t8")!.spans).toHaveLength(2);
  });

  it("reads pre-1.0 instrumentationLibrarySpans", () => {
    const out = convertOtlp({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "old" } }] },
          instrumentationLibrarySpans: [{ spans: [{ traceId: "t9", spanId: "a1", name: "legacy" }] as never }],
        },
      ],
    });
    expect(out.get("t9")!.spans[0]!.name).toBe("legacy");
  });

  it("ignores spans without a trace or span id", () => {
    const out = convertOtlp(payload([{ spanId: "aaaa", name: "orphan" }, { traceId: "t10", name: "no-span-id" }]));
    expect(out.size).toBe(0);
  });
});
