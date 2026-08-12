import type { FastifyInstance, FastifyRequest } from "fastify";
import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

// Plugins
import neo4jPlugin from "./plugins/neo4j.js";
import postgresPlugin from "./plugins/postgres.js";
import redisPlugin from "./plugins/redis.js";
import s3Plugin from "./plugins/s3.js";
import authPlugin from "./middleware/auth.js";

// Routes
import nodesPlugin from "./routes/nodes.js";
import edgesPlugin from "./routes/edges.js";
import tracePlugin from "./routes/trace.js";
import tracesPlugin from "./routes/traces.js";
import replayPlugin from "./routes/replay.js";
import postmortemPlugin from "./routes/postmortem.js";
import snapshotsPlugin from "./routes/snapshots.js";

// Webhooks
import githubWebhookPlugin from "./routes/webhooks/github.js";
import pagerdutyWebhookPlugin from "./routes/webhooks/pagerduty.js";
import sentryWebhookPlugin from "./routes/webhooks/sentry.js";
import datadogWebhookPlugin from "./routes/webhooks/datadog.js";
import linearWebhookPlugin from "./routes/webhooks/linear.js";
import langsmithWebhookPlugin from "./routes/webhooks/langsmith.js";

/**
 * Register all plugins and routes against a Fastify instance.
 *
 * IMPORTANT: this function is intentionally synchronous and does NOT await
 * any `register()` call. Vercel's Fastify framework preset wraps
 * `fastify.listen()` and requires the module to finish evaluation
 * synchronously so that the wrapper can hook into the instance before any
 * request arrives. Top-level `await` here breaks that contract and causes
 * `INTERNAL_FUNCTION_INVOCATION_TIMEOUT` on every request.
 *
 * Fastify queues `register()` calls and runs them lazily during `ready()`,
 * which is triggered automatically by the first request (or by `listen()`
 * in local dev). Errors during registration surface as request errors,
 * not as boot failures.
 */
export function registerApp(app: FastifyInstance): void {
  // Core plugins — APP_URL may be a comma-separated list of allowed origins.
  const corsOrigins = (process.env["APP_URL"] ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.register(cors, {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });
  app.register(sensible);

  // Capture the raw request body for webhook HMAC verification. The webhook
  // handlers read `request.rawBody`; without this parser it was always
  // undefined, so createHmac().update(undefined) threw on every signed
  // delivery. Still parses JSON exactly as before.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body;
      if (body === undefined || body === "") return done(null, undefined);
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error);
      }
    }
  );

  // Infrastructure plugins (lazy DB connections inside)
  app.register(neo4jPlugin);
  app.register(postgresPlugin);
  app.register(redisPlugin);
  app.register(s3Plugin);

  // Auth
  app.register(authPlugin);

  // NOTE: the plain `/health` route lives in index.ts (registered before this
  // deferred plugin). Re-registering it here caused FST_ERR_DUPLICATED_ROUTE,
  // which made ready() reject and left the whole API unbootable.
  app.get("/api/v1/health", async () => {
    const start = Date.now();
    const services: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    try {
      const t = Date.now();
      await app.neo4j.run("RETURN 1");
      services["neo4j"] = { status: "connected", latencyMs: Date.now() - t };
    } catch (err) {
      services["neo4j"] = { status: "disconnected", error: String(err).slice(0, 200) };
    }

    try {
      const t = Date.now();
      await app.pg`SELECT 1`;
      services["postgres"] = { status: "connected", latencyMs: Date.now() - t };
    } catch (err) {
      services["postgres"] = { status: "disconnected", error: String(err).slice(0, 200) };
    }

    try {
      const t = Date.now();
      await app.redis.ping();
      services["redis"] = { status: "connected", latencyMs: Date.now() - t };
    } catch (err) {
      services["redis"] = { status: "disconnected", error: String(err).slice(0, 200) };
    }

    const allHealthy = Object.values(services).every((s) => s.status === "connected");

    return {
      status: allHealthy ? "ok" : "degraded",
      services,
      totalLatencyMs: Date.now() - start,
    };
  });

  // API routes
  app.register(nodesPlugin,      { prefix: "/api/v1/nodes" });
  app.register(edgesPlugin,      { prefix: "/api/v1/edges" });
  app.register(snapshotsPlugin,  { prefix: "/api/v1/snapshots" });
  app.register(tracePlugin,      { prefix: "/api/v1/trace" });
  app.register(tracesPlugin,     { prefix: "/api/v1/traces" });
  app.register(replayPlugin,     { prefix: "/api/v1/replay" });
  app.register(postmortemPlugin, { prefix: "/api/v1/postmortem" });

  // Webhooks (own signature verification, no auth plugin)
  app.register(githubWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  app.register(pagerdutyWebhookPlugin, { prefix: "/api/v1/webhooks" });
  app.register(sentryWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  app.register(datadogWebhookPlugin,   { prefix: "/api/v1/webhooks" });
  app.register(linearWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  app.register(langsmithWebhookPlugin, { prefix: "/api/v1/webhooks" });
}

/**
 * Build a fully-registered Fastify app. Used by local dev (apps/api/src/index.ts
 * in non-serverless mode) and by tests. For Vercel, prefer `registerApp` on a
 * synchronously-instantiated Fastify instance.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const isLocalDev =
    process.env["NODE_ENV"] !== "production" && !process.env["VERCEL"];
  const app = Fastify({
    logger: isLocalDev
      ? { level: "debug", transport: { target: "pino-pretty", options: { colorize: true } } }
      : { level: "info" },
  });
  registerApp(app);
  await app.ready();
  return app;
}
