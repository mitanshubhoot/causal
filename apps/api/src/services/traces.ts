import type { FastifyInstance } from "fastify";

// ── Wire shapes (match the web product surface) ──────────────────────
export interface IngestSpan {
  id: string;
  parentId?: string | null;
  name: string;
  kind: "agent" | "llm" | "tool" | "http" | "db" | "function";
  startMs?: number;
  durationMs?: number;
  status?: "ok" | "warn" | "error";
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
  error?: string;
}

export interface IngestTrace {
  traceId: string;
  service: string;
  environment?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  startedAt?: string;
  spans: IngestSpan[];
}

function rollupStatus(spans: IngestSpan[]): "ok" | "warn" | "error" {
  if (spans.some((s) => s.status === "error")) return "error";
  if (spans.some((s) => s.status === "warn")) return "warn";
  return "ok";
}

/**
 * Ingest a trace + its spans. Idempotent on trace id — re-ingesting a trace
 * replaces its spans (spans cascade-delete with the trace row).
 */
export async function ingestTrace(fastify: FastifyInstance, orgId: string, t: IngestTrace): Promise<{ traceId: string; spanCount: number }> {
  const spans = t.spans ?? [];
  const root = spans.find((s) => !s.parentId);
  const status = rollupStatus(spans);
  const startedAt = t.startedAt ? new Date(t.startedAt) : new Date();

  await fastify.pg.begin(async (tx) => {
    // porsager types the tx handle as TransactionSql (not directly callable in
    // some versions); it supports the same tagged-template + bulk-insert API.
    const sql = tx as unknown as typeof fastify.pg;
    // Replace any prior version of this trace (cascades to spans).
    await sql`DELETE FROM traces WHERE id = ${t.traceId} AND org_id = ${orgId}`;

    await sql`
      INSERT INTO traces (id, org_id, service, environment, root_name, status, model, tokens_in, tokens_out, cost, span_count, started_at)
      VALUES (
        ${t.traceId}, ${orgId}, ${t.service}, ${t.environment ?? "production"},
        ${root?.name ?? null}, ${status}, ${t.model ?? null},
        ${t.tokensIn ?? 0}, ${t.tokensOut ?? 0}, ${t.cost ?? 0}, ${spans.length}, ${startedAt}
      )
    `;

    if (spans.length > 0) {
      const rows = spans.map((s) => ({
        trace_id: t.traceId,
        id: s.id,
        org_id: orgId,
        parent_id: s.parentId ?? null,
        name: s.name,
        kind: s.kind,
        start_ms: s.startMs ?? 0,
        duration_ms: s.durationMs ?? 0,
        status: s.status ?? "ok",
        attributes: JSON.stringify(s.attributes ?? []),
        io: s.io ? JSON.stringify(s.io) : null,
        git: s.git ? JSON.stringify(s.git) : null,
        error: s.error ?? null,
      }));
      await sql`
        INSERT INTO spans ${sql(rows, "trace_id", "id", "org_id", "parent_id", "name", "kind", "start_ms", "duration_ms", "status", "attributes", "io", "git", "error")}
      `;
    }
  });

  return { traceId: t.traceId, spanCount: spans.length };
}

/** List recent traces for an org (newest first). */
export async function listTraces(fastify: FastifyInstance, orgId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
  const rows = (await fastify.pg`
    SELECT id, service, environment, root_name, status, model, tokens_in, tokens_out, cost, span_count, started_at
    FROM traces
    WHERE org_id = ${orgId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r["id"],
    service: r["service"],
    environment: r["environment"],
    name: r["root_name"],
    status: r["status"],
    model: r["model"],
    tokensIn: Number(r["tokens_in"]),
    tokensOut: Number(r["tokens_out"]),
    cost: Number(r["cost"]),
    spanCount: Number(r["span_count"]),
    startedAt: r["started_at"],
  }));
}

/** Fetch a trace with its spans and (if any) its detector finding. */
export async function getTrace(fastify: FastifyInstance, orgId: string, traceId: string): Promise<Record<string, unknown> | null> {
  const traceRows = (await fastify.pg`
    SELECT id, service, environment, root_name, status, model, tokens_in, tokens_out, cost, span_count, started_at
    FROM traces
    WHERE id = ${traceId} AND org_id = ${orgId}
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  const trace = traceRows[0];
  if (!trace) return null;

  const spanRows = (await fastify.pg`
    SELECT id, parent_id, name, kind, start_ms, duration_ms, status, attributes, io, git, error
    FROM spans
    WHERE trace_id = ${traceId} AND org_id = ${orgId}
    ORDER BY start_ms ASC
  `) as Array<Record<string, unknown>>;

  const findingRows = (await fastify.pg`
    SELECT detector, title, severity, confidence, summary, triggered_span_id, judge_model
    FROM trace_findings
    WHERE trace_id = ${traceId} AND org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  const f = findingRows[0];

  return {
    traceId: trace["id"],
    service: trace["service"],
    environment: trace["environment"],
    title: trace["root_name"],
    status: trace["status"],
    model: trace["model"],
    tokensIn: Number(trace["tokens_in"]),
    tokensOut: Number(trace["tokens_out"]),
    cost: Number(trace["cost"]),
    startedAt: trace["started_at"],
    spans: spanRows.map((s) => ({
      id: s["id"],
      parentId: s["parent_id"],
      name: s["name"],
      kind: s["kind"],
      startMs: Number(s["start_ms"]),
      durationMs: Number(s["duration_ms"]),
      status: s["status"],
      attributes: s["attributes"] ?? [],
      io: s["io"] ?? undefined,
      git: s["git"] ?? undefined,
      error: s["error"] ?? undefined,
    })),
    finding: f
      ? {
          detector: f["detector"],
          title: f["title"],
          severity: f["severity"],
          confidence: Number(f["confidence"]),
          summary: f["summary"],
          triggeredSpanId: f["triggered_span_id"],
          judgeModel: f["judge_model"],
        }
      : null,
  };
}
