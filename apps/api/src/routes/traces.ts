import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ingestTrace, listTraces, getTrace, type IngestTrace } from "../services/traces.js";
import { runDetector } from "../services/detector.js";
import { runRca, getRca } from "../services/rca.js";
import { getProvenance } from "../services/provenance.js";
import { config } from "../config.js";

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
};

export default tracesPlugin;
