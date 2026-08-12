import type { FastifyInstance } from "fastify";
import type { IngestSpan, SpanKind } from "./traces.js";

/**
 * OpenTelemetry OTLP/HTTP JSON ingest.
 *
 * Lets any standard OTel SDK export to Causal (`OTEL_EXPORTER_OTLP_ENDPOINT`),
 * mapping OTel spans — including the `gen_ai.*` semantic conventions emitted by
 * LLM instrumentation — onto Causal's span model.
 *
 * Unlike the native endpoint, this UPSERTS: OTLP exporters batch, so one trace
 * commonly arrives across several requests and later batches must merge into
 * the existing trace rather than replace it.
 */

// ── OTLP wire types (the subset we consume) ─────────────────────────
interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: AnyValue[] };
}
interface KeyValue { key: string; value?: AnyValue }
interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: KeyValue[];
  status?: { code?: number; message?: string };
  events?: { name?: string; attributes?: KeyValue[] }[];
}
export interface OtlpPayload {
  resourceSpans?: {
    resource?: { attributes?: KeyValue[] };
    scopeSpans?: { spans?: OtlpSpan[] }[];
    // pre-1.0 exporters
    instrumentationLibrarySpans?: { spans?: OtlpSpan[] }[];
  }[];
}

function attrValue(v?: AnyValue): string | undefined {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return String(v.intValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue !== undefined) return String(v.boolValue);
  if (v.arrayValue?.values) return v.arrayValue.values.map((x) => attrValue(x) ?? "").join(", ");
  return undefined;
}

function toMap(attrs?: KeyValue[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of attrs ?? []) {
    const val = attrValue(a.value);
    if (a.key && val !== undefined) m.set(a.key, val);
  }
  return m;
}

function num(m: Map<string, string>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = m.get(k);
    if (v !== undefined) {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function str(m: Map<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = m.get(k);
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/** OTel SpanKind enum → our vocabulary, refined by semantic-convention attrs. */
function inferKind(span: OtlpSpan, a: Map<string, string>): SpanKind {
  // gen_ai.* is the LLM semantic convention — the strongest signal we have.
  if (str(a, "gen_ai.system", "gen_ai.request.model", "llm.request.model", "gen_ai.operation.name")) return "llm";
  if (str(a, "db.system", "db.statement", "db.query.text")) return "db";
  if (str(a, "http.request.method", "http.method", "url.full")) return "http";
  if (str(a, "tool.name", "gen_ai.tool.name")) return "tool";
  if (str(a, "agent.name", "gen_ai.agent.name")) return "agent";
  const n = (span.name ?? "").toLowerCase();
  if (n.includes("websearch") || n.includes("search") || n.includes("retriev")) return "search";
  if (n.startsWith("bash") || n.includes("shell") || n.includes("exec")) return "shell";
  if (n.includes("workflow")) return "workflow";
  if (n.includes("skill")) return "skill";
  switch (span.kind) {
    case 3: return "http";   // CLIENT
    case 2: return "http";   // SERVER
    case 4:
    case 5: return "workflow"; // PRODUCER / CONSUMER
    default: return "function";
  }
}

const ZERO_SPAN = "0000000000000000";

function nanoToMs(v?: string | number): number {
  if (v === undefined) return 0;
  return Number(BigInt(String(v).split(".")[0] ?? "0") / 1_000_000n);
}

/** Convert one OTLP payload into Causal traces keyed by trace id. */
export function convertOtlp(payload: OtlpPayload): Map<string, {
  service: string;
  model?: string;
  spans: IngestSpan[];
  startedAtMs: number;
}> {
  const out = new Map<string, { service: string; model?: string; spans: IngestSpan[]; startedAtMs: number }>();

  for (const rs of payload.resourceSpans ?? []) {
    const res = toMap(rs.resource?.attributes);
    const service = str(res, "service.name") ?? "unknown-service";
    const scopes = [...(rs.scopeSpans ?? []), ...(rs.instrumentationLibrarySpans ?? [])];

    for (const scope of scopes) {
      for (const s of scope.spans ?? []) {
        const traceId = s.traceId;
        if (!traceId || !s.spanId) continue;
        const a = toMap(s.attributes);

        const startMsAbs = nanoToMs(s.startTimeUnixNano);
        const endMsAbs = nanoToMs(s.endTimeUnixNano);

        const parent = s.parentSpanId && s.parentSpanId !== ZERO_SPAN ? s.parentSpanId : null;
        const statusCode = s.status?.code ?? 0;

        // gen_ai token usage — both current and legacy attribute names.
        const tokensIn = num(a, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.usage.prompt_tokens");
        const tokensOut = num(a, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.usage.completion_tokens");
        const cost = num(a, "gen_ai.usage.cost", "llm.usage.cost");

        const input = str(a, "gen_ai.prompt", "gen_ai.input.messages", "llm.prompts", "input.value");
        const output = str(a, "gen_ai.completion", "gen_ai.output.messages", "llm.completions", "output.value");

        const file = str(a, "code.filepath", "code.file.path");
        const lineNo = num(a, "code.lineno", "code.line.number");
        const commit = str(a, "vcs.repository.ref.revision", "causal.git.commit", "code.commit");

        // Everything not already promoted becomes a visible attribute.
        const promoted = new Set([
          "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "llm.usage.prompt_tokens",
          "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "llm.usage.completion_tokens",
          "gen_ai.prompt", "gen_ai.completion", "gen_ai.input.messages", "gen_ai.output.messages",
          "llm.prompts", "llm.completions", "input.value", "output.value",
        ]);
        const attributes = [...a.entries()]
          .filter(([k]) => !promoted.has(k))
          .slice(0, 24)
          .map(([label, value]) => ({ label, value: value.slice(0, 500) }));

        // An exception event carries the real error text.
        const exception = (s.events ?? []).find((e) => e.name === "exception");
        const exAttrs = toMap(exception?.attributes);
        const errorText =
          s.status?.message ||
          str(exAttrs, "exception.message") ||
          (statusCode === 2 ? "span reported ERROR status" : undefined);

        const span: IngestSpan = {
          id: s.spanId,
          parentId: parent,
          name: s.name ?? "span",
          kind: inferKind(s, a),
          startMs: startMsAbs, // normalized to trace-relative below
          durationMs: Math.max(0, endMsAbs - startMsAbs),
          status: statusCode === 2 ? "error" : "ok",
          attributes,
          ...(input || output ? { io: { ...(input ? { input } : {}), ...(output ? { output } : {}) } } : {}),
          ...(file ? { git: { file, line: lineNo ?? 0, commit: commit ?? "unknown" } } : {}),
          ...(tokensIn !== undefined ? { tokensIn } : {}),
          ...(tokensOut !== undefined ? { tokensOut } : {}),
          ...(cost !== undefined ? { cost } : {}),
          ...(errorText ? { error: errorText } : {}),
        };

        const model = str(a, "gen_ai.response.model", "gen_ai.request.model", "llm.request.model");
        const entry = out.get(traceId);
        if (entry) {
          entry.spans.push(span);
          entry.startedAtMs = Math.min(entry.startedAtMs, startMsAbs || entry.startedAtMs);
          if (!entry.model && model) entry.model = model;
        } else {
          out.set(traceId, { service, spans: [span], startedAtMs: startMsAbs, ...(model ? { model } : {}) });
        }
      }
    }
  }

  // Rebase span offsets to be relative to the trace start.
  for (const t of out.values()) {
    for (const s of t.spans) s.startMs = Math.max(0, (s.startMs ?? 0) - t.startedAtMs);
  }
  return out;
}

/**
 * Upsert a batch of OTLP spans. Merges into an existing trace instead of
 * replacing it, because OTel exporters send a trace across several batches.
 */
export async function ingestOtlp(
  fastify: FastifyInstance,
  orgId: string,
  payload: OtlpPayload
): Promise<{ traces: number; spans: number }> {
  const converted = convertOtlp(payload);
  let spanCount = 0;

  for (const [traceId, t] of converted) {
    const root = t.spans.find((s) => !s.parentId);
    await fastify.pg.begin(async (tx) => {
      const sql = tx as unknown as typeof fastify.pg;

      await sql`
        INSERT INTO traces (id, org_id, service, environment, root_name, status, model, span_count, started_at)
        VALUES (${traceId}, ${orgId}, ${t.service}, 'production', ${root?.name ?? null}, 'ok',
                ${t.model ?? null}, 0, ${new Date(t.startedAtMs || Date.now())})
        ON CONFLICT (org_id, id) DO UPDATE
          SET root_name = COALESCE(traces.root_name, EXCLUDED.root_name),
              model     = COALESCE(traces.model, EXCLUDED.model)
      `;

      const rows = t.spans.map((s) => ({
        trace_id: traceId,
        id: s.id,
        org_id: orgId,
        parent_id: s.parentId ?? null,
        name: s.name,
        kind: s.kind,
        start_ms: s.startMs ?? 0,
        duration_ms: s.durationMs ?? 0,
        status: s.status ?? "ok",
        attributes: sql.json(s.attributes ?? []),
        io: sql.json(s.io ?? null),
        git: sql.json(s.git ?? null),
        code: sql.json(null as never),
        tokens_in: s.tokensIn ?? null,
        tokens_out: s.tokensOut ?? null,
        cost: s.cost ?? null,
        error: s.error ?? null,
      }));
      await sql`
        INSERT INTO spans ${sql(rows, "trace_id", "id", "org_id", "parent_id", "name", "kind", "start_ms", "duration_ms", "status", "attributes", "io", "git", "code", "tokens_in", "tokens_out", "cost", "error")}
        ON CONFLICT (org_id, trace_id, id) DO UPDATE SET
          name = EXCLUDED.name, kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id,
          start_ms = EXCLUDED.start_ms, duration_ms = EXCLUDED.duration_ms, status = EXCLUDED.status,
          attributes = EXCLUDED.attributes, io = EXCLUDED.io, git = EXCLUDED.git,
          tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out, cost = EXCLUDED.cost,
          error = EXCLUDED.error
      `;

      // Recompute trace rollups from everything stored so far.
      await sql`
        UPDATE traces t SET
          span_count = agg.n,
          tokens_in  = agg.ti,
          tokens_out = agg.to_,
          cost       = agg.c,
          status     = agg.st
        FROM (
          SELECT COUNT(*) AS n,
                 COALESCE(SUM(tokens_in), 0)  AS ti,
                 COALESCE(SUM(tokens_out), 0) AS to_,
                 COALESCE(SUM(cost), 0)       AS c,
                 CASE WHEN bool_or(status = 'error') THEN 'error'
                      WHEN bool_or(status = 'warn')  THEN 'warn'
                      ELSE 'ok' END           AS st
          FROM spans WHERE org_id = ${orgId} AND trace_id = ${traceId}
        ) agg
        WHERE t.org_id = ${orgId} AND t.id = ${traceId}
      `;
      spanCount += t.spans.length;
    });
  }

  return { traces: converted.size, spans: spanCount };
}
