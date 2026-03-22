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

export async function buildApp() {
  const isDev = process.env["NODE_ENV"] !== "production";
  const app = Fastify({
    logger: isDev
      ? { level: "debug", transport: { target: "pino-pretty", options: { colorize: true } } }
      : { level: "info" },
  });

  // ── Core plugins ────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env["APP_URL"] ?? "http://localhost:3000",
    credentials: true,
  });
  await app.register(sensible);

  // ── Infrastructure plugins ───────────────────────────────────────
  await app.register(neo4jPlugin);
  await app.register(postgresPlugin);
  await app.register(redisPlugin);
  await app.register(s3Plugin);

  // ── Auth ────────────────────────────────────────────────────────
  await app.register(authPlugin);

  // ── Health check (no auth) ──────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    timestamp: Date.now(),
  }));

  app.get("/api/v1/health", async () => {
    const start = Date.now();
    const services: Record<string, { status: string; latencyMs?: number }> = {};

    // Neo4j
    try {
      const neo4jStart = Date.now();
      await app.neo4j.verifyConnectivity();
      services.neo4j = { status: "connected", latencyMs: Date.now() - neo4jStart };
    } catch {
      services.neo4j = { status: "disconnected" };
    }

    // Postgres
    try {
      const pgStart = Date.now();
      await app.pg`SELECT 1`;
      services.postgres = { status: "connected", latencyMs: Date.now() - pgStart };
    } catch {
      services.postgres = { status: "disconnected" };
    }

    // Redis
    try {
      const redisStart = Date.now();
      await app.redis.ping();
      services.redis = { status: "connected", latencyMs: Date.now() - redisStart };
    } catch {
      services.redis = { status: "disconnected" };
    }

    const allHealthy = Object.values(services).every((s) => s.status === "connected");

    return {
      status: allHealthy ? "ok" : "degraded",
      services,
      totalLatencyMs: Date.now() - start,
    };
  });

  // ── API routes ──────────────────────────────────────────────────
  await app.register(nodesPlugin,     { prefix: "/api/v1/nodes" });
  await app.register(edgesPlugin,     { prefix: "/api/v1/edges" });
  await app.register(snapshotsPlugin, { prefix: "/api/v1/snapshots" });
  await app.register(tracePlugin,     { prefix: "/api/v1/trace" });
  await app.register(replayPlugin,    { prefix: "/api/v1/replay" });
  await app.register(postmortemPlugin, { prefix: "/api/v1/postmortem" });

  // ── Webhooks (no auth — own signature verification) ─────────────
  await app.register(githubWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  await app.register(pagerdutyWebhookPlugin, { prefix: "/api/v1/webhooks" });
  await app.register(sentryWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  await app.register(datadogWebhookPlugin,   { prefix: "/api/v1/webhooks" });
  await app.register(linearWebhookPlugin,    { prefix: "/api/v1/webhooks" });
  await app.register(langsmithWebhookPlugin, { prefix: "/api/v1/webhooks" });

  return app;
}
