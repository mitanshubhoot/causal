import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ingestTrace, listTraces, getTrace, type IngestTrace } from "../services/traces.js";
import { runDetector } from "../services/detector.js";
import { runRca, getRca } from "../services/rca.js";
import { getProvenance } from "../services/provenance.js";
import { listDetectors, getDetector, listFindings, resolveFinding } from "../services/detectors.js";
import { askCopilot, getCopilotHistory } from "../services/copilot.js";
import { config } from "../config.js";

// tokens_in/tokens_out are INTEGER and cost is NUMERIC(12,6) (004_traces.sql,
// 006_observability_v2.sql), so an unbounded value is a 22003 from Postgres —
// a 500 on schema-valid input. The per-span caps are set so that the rollup of
// a full 2000-span trace still fits its own columns.
const MAX_SPAN_TOKENS = 1_000_000;
const MAX_SPAN_COST = 500;
const MAX_TRACE_TOKENS = 2_147_483_647;
const MAX_TRACE_COST = 999_999;

const SpanSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1),
  kind: z.enum(["agent", "llm", "tool", "http", "db", "function", "skill", "workflow", "search", "shell"]),
  startMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["ok", "warn", "error"]).optional(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  io: z.object({ input: z.string().optional(), output: z.string().optional() }).optional(),
  git: z.object({ file: z.string(), line: z.number().int(), commit: z.string() }).optional(),
  code: z
    .object({
      lang: z.string(),
      startLine: z.number().int(),
      lines: z.array(z.object({ n: z.number().int(), text: z.string(), marked: z.boolean().optional() })),
    })
    .optional(),
  tokensIn: z.number().int().nonnegative().max(MAX_SPAN_TOKENS).optional(),
  tokensOut: z.number().int().nonnegative().max(MAX_SPAN_TOKENS).optional(),
  cost: z.number().nonnegative().max(MAX_SPAN_COST).optional(),
  error: z.string().optional(),
});

const IngestSchema = z.object({
  traceId: z.string().min(1),
  service: z.string().min(1),
  environment: z.string().optional(),
  model: z.string().optional(),
  tokensIn: z.number().int().nonnegative().max(MAX_TRACE_TOKENS).optional(),
  tokensOut: z.number().int().nonnegative().max(MAX_TRACE_TOKENS).optional(),
  cost: z.number().nonnegative().max(MAX_TRACE_COST).optional(),
  // must parse as a date — an invalid string used to blow up the INSERT
  startedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "startedAt must be a valid date").optional(),
  repo: z.string().optional(),
  gitRef: z.string().optional(),
  user: z.string().optional(),
  sessionId: z.string().optional(),
  metadata: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  spans: z.array(SpanSchema).max(2000),
});

const tracesPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/traces — ingest a trace + its spans (OTLP-lite JSON).
  fastify.post("/", async (request, reply) => {
    const { orgId } = request.authUser;
    const body = IngestSchema.parse(request.body) as IngestTrace;
    const result = await ingestTrace(fastify, orgId, body);

    // Run the detector inline (fire-and-forget) when enabled — no separate
    // worker/queue needed at this scale (our "lighter than TraceRoot" choice).
    if (config.ENABLE_DETECTORS) {
      setImmediate(async () => {
        try {
          await runDetector(fastify, orgId, result.traceId);
        } catch (err) {
          fastify.log.error({ err, traceId: result.traceId }, "inline detector failed");
        }
      });
    }

    return reply.code(201).send(result);
  });

  // GET /api/v1/traces — list recent traces for the org.
  fastify.get<{ Querystring: { limit?: string } }>("/", async (request) => {
    const { orgId } = request.authUser;
    // Clamp both ends — a negative limit used to reach `LIMIT ${limit}`.
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const traces = await listTraces(fastify, orgId, limit);
    return { traces, count: traces.length };
  });

  // GET /api/v1/traces/:id — a trace with its spans and detector finding.
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { orgId } = request.authUser;
    const trace = await getTrace(fastify, orgId, request.params.id);
    if (!trace) return reply.notFound("Trace not found");
    return trace;
  });

  // POST /api/v1/traces/:id/detect — run the LLM-as-judge detector on a trace.
  fastify.post<{ Params: { id: string } }>("/:id/detect", async (request, reply) => {
    const { orgId } = request.authUser;
    const finding = await runDetector(fastify, orgId, request.params.id);
    if (!finding) return { identified: false };
    return finding;
  });

  // POST /api/v1/traces/:id/rca — root-cause the latest finding + propose a fix.
  fastify.post<{ Params: { id: string } }>("/:id/rca", async (request, reply) => {
    const { orgId } = request.authUser;
    const rca = await runRca(fastify, orgId, request.params.id);
    if (!rca) return reply.badRequest("No finding to root-cause on this trace");
    return rca;
  });

  // GET /api/v1/traces/:id/rca — the latest RCA run for a trace.
  fastify.get<{ Params: { id: string } }>("/:id/rca", async (request, reply) => {
    const { orgId } = request.authUser;
    const rca = await getRca(fastify, orgId, request.params.id);
    if (!rca) return reply.notFound("No RCA run for this trace");
    return rca;
  });

  // GET /api/v1/traces/:id/provenance — link the trace's commit to causal nodes.
  fastify.get<{ Params: { id: string } }>("/:id/provenance", async (request, reply) => {
    const { orgId } = request.authUser;
    const prov = await getProvenance(fastify, orgId, request.params.id);
    if (!prov) return reply.notFound("Trace not found");
    return prov;
  });

  // ── Causal Copilot ────────────────────────────────────────────────
  // POST /api/v1/traces/:id/ask — answer a question grounded in the trace.
  fastify.post<{ Params: { id: string }; Body: { question?: string } }>("/:id/ask", async (request, reply) => {
    const { orgId } = request.authUser;
    const question = z.string().min(1).max(2000).safeParse((request.body ?? {}).question);
    if (!question.success) return reply.badRequest("question is required");
    const result = await askCopilot(fastify, orgId, request.params.id, question.data);
    if (!result) return reply.notFound("Trace not found");
    return result;
  });

  // GET /api/v1/traces/:id/ask — conversation history for the trace.
  fastify.get<{ Params: { id: string } }>("/:id/ask", async (request) => {
    const { orgId } = request.authUser;
    return { messages: await getCopilotHistory(fastify, orgId, request.params.id) };
  });
};

/** Detector + finding routes (mounted at /api/v1). */
export const detectorsPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/detectors — definitions with open/total finding counts.
  fastify.get("/detectors", async (request) => {
    const { orgId } = request.authUser;
    const detectors = await listDetectors(fastify, orgId);
    return { detectors, count: detectors.length };
  });

  // GET /api/v1/detectors/:name — one detector with findings + runs history.
  fastify.get<{ Params: { name: string } }>("/detectors/:name", async (request, reply) => {
    const { orgId } = request.authUser;
    const detector = await getDetector(fastify, orgId, request.params.name);
    if (!detector) return reply.notFound("Detector not found");
    return detector;
  });

  // GET /api/v1/findings — org-wide findings feed for the dashboard.
  fastify.get<{ Querystring: { limit?: string } }>("/findings", async (request) => {
    const { orgId } = request.authUser;
    // Clamp both ends — a negative limit used to reach `LIMIT ${limit}`.
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const findings = await listFindings(fastify, orgId, limit);
    return { findings, count: findings.length };
  });

  // POST /api/v1/findings/:id/resolve — resolve or reopen a finding.
  fastify.post<{ Params: { id: string }; Body: { resolved?: boolean } }>("/findings/:id/resolve", async (request, reply) => {
    const { orgId } = request.authUser;
    const resolved = (request.body ?? {}).resolved !== false;
    const ok = await resolveFinding(fastify, orgId, request.params.id, resolved);
    if (!ok) return reply.notFound("Finding not found");
    return { findingId: request.params.id, resolved };
  });
};

export default tracesPlugin;
