import type { FastifyPluginAsync } from "fastify";
import { ingestOtlp, type OtlpPayload } from "../services/otlp.js";
import { runDetector } from "../services/detector.js";
import { config } from "../config.js";

/**
 * OTLP/HTTP ingest, mounted at the standard collector path so an unmodified
 * OpenTelemetry SDK can export straight to Causal:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.causal.dev
 *   OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer $CAUSAL_API_KEY"
 *
 * JSON encoding only — protobuf would need a decoder dependency, and every OTel
 * SDK can be configured for OTLP/HTTP+JSON.
 */
const otlpPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/traces", async (request, reply) => {
    const { orgId } = request.authUser;
    const body = request.body as OtlpPayload | undefined;

    if (!body || !Array.isArray(body.resourceSpans)) {
      // OTLP's error shape, not ours.
      return reply.code(400).send({ code: 3, message: "expected an OTLP payload with resourceSpans" });
    }

    const result = await ingestOtlp(fastify, orgId, body);

    if (config.ENABLE_DETECTORS && result.traces > 0) {
      // A batched trace may still be arriving, so scoring is best-effort here.
      setImmediate(async () => {
        try {
          for (const rs of body.resourceSpans ?? []) {
            for (const scope of rs.scopeSpans ?? []) {
              const first = scope.spans?.[0];
              if (first?.traceId) await runDetector(fastify, orgId, first.traceId);
            }
          }
        } catch (err) {
          fastify.log.error({ err }, "detector failed after OTLP ingest");
        }
      });
    }

    // OTLP expects a (possibly empty) ExportTraceServiceResponse.
    return reply.code(200).send({ partialSuccess: {} });
  });
};

export default otlpPlugin;
