import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ingestTrace, listTraces, getTrace, type IngestTrace } from "../services/traces.js";

const SpanSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().min(1),
  kind: z.enum(["agent", "llm", "tool", "http", "db", "function"]),
  startMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["ok", "warn", "error"]).optional(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  io: z.object({ input: z.string().optional(), output: z.string().optional() }).optional(),
  git: z.object({ file: z.string(), line: z.number().int(), commit: z.string() }).optional(),
  error: z.string().optional(),
});

const IngestSchema = z.object({
  traceId: z.string().min(1),
  service: z.string().min(1),
  environment: z.string().optional(),
  model: z.string().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  startedAt: z.string().optional(),
  spans: z.array(SpanSchema).max(2000),
});

const tracesPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/traces — ingest a trace + its spans (OTLP-lite JSON).
  fastify.post("/", async (request, reply) => {
    const { orgId } = request.authUser;
    const body = IngestSchema.parse(request.body) as IngestTrace;
    const result = await ingestTrace(fastify, orgId, body);
    return reply.code(201).send(result);
  });

  // GET /api/v1/traces — list recent traces for the org.
  fastify.get<{ Querystring: { limit?: string } }>("/", async (request) => {
    const { orgId } = request.authUser;
    const limit = Math.min(Number(request.query.limit) || 100, 500);
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
};

export default tracesPlugin;
