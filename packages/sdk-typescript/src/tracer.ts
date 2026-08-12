/**
 * Causal tracer — capture agent runs as traces of spans and export them to the
 * Causal ingest endpoint (`POST /api/v1/traces`). Dependency-free; uses the
 * global `fetch` (Node 18+).
 *
 * Usage:
 *   const tracer = new CausalTracer({ service: "booking-agent" });
 *   await tracer.trace("booking_agent.run", async (t) => {
 *     const plan = t.span("llm.plan", "llm");
 *     // ... call the model ...
 *     plan.end({ status: "ok", io: { input, output } });
 *   });
 */

export type SpanKind = "agent" | "llm" | "tool" | "http" | "db" | "function";
export type SpanStatus = "ok" | "warn" | "error";

export interface CausalTracerOptions {
  service: string;
  apiKey?: string;
  baseUrl?: string;
  orgId?: string;
  environment?: string;
  model?: string;
}

export interface SpanEndOptions {
  status?: SpanStatus;
  error?: string;
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
}

interface RecordedSpan {
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
  error?: string;
}

function genId(len = 16): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

export class CausalSpan {
  private readonly startedAt = Date.now();
  private ended = false;
  constructor(
    private readonly rec: RecordedSpan,
    private readonly trace: CausalTrace
  ) {}
  get id(): string {
    return this.rec.id;
  }
  /** Create a child span nested under this one. */
  child(name: string, kind: SpanKind): CausalSpan {
    return this.trace.span(name, kind, this.rec.id);
  }
  end(opts: SpanEndOptions = {}): void {
    if (this.ended) return;
    this.ended = true;
    this.rec.durationMs = Math.max(0, Date.now() - this.startedAt);
    this.rec.status = opts.status ?? "ok";
    if (opts.attributes) this.rec.attributes = opts.attributes;
    if (opts.io) this.rec.io = opts.io;
    if (opts.git) this.rec.git = opts.git;
    if (opts.error) {
      this.rec.error = opts.error;
      if (!opts.status) this.rec.status = "error";
    }
  }
}

export class CausalTrace {
  readonly traceId: string;
  private readonly start: number;
  private readonly spans: RecordedSpan[] = [];
  tokensIn = 0;
  tokensOut = 0;
  cost = 0;

  constructor(
    private readonly tracer: CausalTracer,
    traceId?: string
  ) {
    this.traceId = traceId ?? genId(16);
    this.start = Date.now();
  }

  /** Open a span. Pass `parentId` to nest it, else it hangs off the trace root. */
  span(name: string, kind: SpanKind = "function", parentId: string | null = null): CausalSpan {
    const rec: RecordedSpan = {
      id: genId(8),
      parentId,
      name,
      kind,
      startMs: Math.max(0, Date.now() - this.start),
      durationMs: 0,
      status: "ok",
    };
    this.spans.push(rec);
    return new CausalSpan(rec, this);
  }

  /** Ship the trace to Causal. Safe to call once at the end of a run. */
  async flush(): Promise<void> {
    await this.tracer.export(this);
  }

  toPayload(): Record<string, unknown> {
    return {
      traceId: this.traceId,
      service: this.tracer.service,
      environment: this.tracer.environment,
      model: this.tracer.model,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cost: this.cost,
      startedAt: new Date(this.start).toISOString(),
      spans: this.spans.map((s) => ({ ...s })),
    };
  }
}

export class CausalTracer {
  readonly service: string;
  readonly environment: string;
  readonly model?: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId: string;

  constructor(opts: CausalTracerOptions) {
    this.service = opts.service;
    this.environment = opts.environment ?? "production";
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? process.env["CAUSAL_API_KEY"] ?? "";
    this.baseUrl = (opts.baseUrl ?? process.env["CAUSAL_API_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
    this.orgId = opts.orgId ?? process.env["CAUSAL_ORG_ID"] ?? "default";
  }

  startTrace(traceId?: string): CausalTrace {
    return new CausalTrace(this, traceId);
  }

  /** Run `fn` as a single traced run: opens a root agent span, times it, and
   *  flushes on completion (even on error). */
  async trace<T>(name: string, fn: (t: CausalTrace, root: CausalSpan) => Promise<T>): Promise<T> {
    const t = this.startTrace();
    const root = t.span(name, "agent", null);
    try {
      const out = await fn(t, root);
      root.end({ status: "ok" });
      return out;
    } catch (err) {
      root.end({ status: "error", error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      try {
        await t.flush();
      } catch {
        // never let telemetry break the agent
      }
    }
  }

  async export(t: CausalTrace): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        "x-causal-org-id": this.orgId,
      },
      body: JSON.stringify(t.toPayload()),
    });
    if (!res.ok) {
      throw new Error(`Causal trace export failed: ${res.status}`);
    }
  }
}
