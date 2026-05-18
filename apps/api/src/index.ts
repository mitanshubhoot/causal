// ─────────────────────────────────────────────────────────────────────
// Vercel Fastify entrypoint.
//
// The module must finish top-level evaluation FAST so Vercel's
// @vercel/fastify preset can hook fastify.listen() before any request
// arrives. To keep cold-start cheap we:
//
//   1. Import ONLY fastify + config at the top level (~50 ms).
//   2. Defer the heavy plugin/route registration (AWS SDK, neo4j,
//      ioredis, postgres, openai, anthropic, octokit, slack, etc.)
//      into a single async plugin via app.register(...). Fastify
//      runs that plugin's body during ready(), which the adapter
//      triggers on the first request — keeping the cold-start path
//      out of the 10 s Hobby function timeout.
//   3. Call app.listen() synchronously at the top level so Vercel's
//      adapter wraps the instance.
//
// console.error lines emit boot timestamps so we can verify in the
// runtime logs exactly how long each phase takes.
// ─────────────────────────────────────────────────────────────────────

console.error(`[boot] ${new Date().toISOString()} module:start`);

import Fastify from "fastify";
import { config } from "./config.js";

console.error(`[boot] ${new Date().toISOString()} module:imports-done`);

const isLocalDev =
  process.env["NODE_ENV"] !== "production" && !process.env["VERCEL"];

const app = Fastify({
  logger: isLocalDev
    ? { level: "debug", transport: { target: "pino-pretty", options: { colorize: true } } }
    : { level: "info" },
});

// Immediate health endpoint — registered before the heavy async plugin
// so a warm instance can answer /health without waiting for plugin load
// (cold start still has to wait for ready() to drain the queue once).
app.get("/health", async () => ({
  status: "ok",
  version: "0.1.0",
  timestamp: Date.now(),
  cold: !globalThis.__causalReady,
}));

// Single deferred plugin that dynamically imports factory.js. The
// dynamic import only runs when Fastify calls ready(), which means it
// is OUT of the synchronous module evaluation path. This is critical
// for Vercel Fastify cold starts: factory.js transitively imports
// @aws-sdk/client-s3, neo4j-driver, ioredis, postgres, openai,
// @anthropic-ai/sdk, octokit, and @slack/web-api — easily 1-2 s of
// pure module-load CPU on a serverless cold node.
app.register(async (instance) => {
  console.error(`[boot] ${new Date().toISOString()} factory:loading`);
  const { registerApp } = await import("./factory.js");
  console.error(`[boot] ${new Date().toISOString()} factory:loaded`);
  registerApp(instance);
  console.error(`[boot] ${new Date().toISOString()} factory:registered`);
});

// Set a global after ready() to surface warm/cold state on /health.
app
  .ready()
  .then(() => {
    (globalThis as { __causalReady?: boolean }).__causalReady = true;
    console.error(`[boot] ${new Date().toISOString()} app:ready`);
    return undefined;
  })
  .then(undefined, (err: unknown) => {
    console.error(`[boot] ${new Date().toISOString()} app:ready-error`, err);
  });

console.error(`[boot] ${new Date().toISOString()} module:calling-listen`);

// Vercel's @vercel/fastify preset intercepts listen() — the actual TCP
// bind only happens in local dev (when VERCEL is unset).
app.listen({ port: config.API_PORT, host: config.API_HOST }, (err) => {
  if (err) {
    console.error("[boot] listen:error", err);
    if (!process.env["VERCEL"]) process.exit(1);
    return;
  }
  console.error(`[boot] ${new Date().toISOString()} listen:ok`);
});

console.error(`[boot] ${new Date().toISOString()} module:end`);

// Graceful shutdown is only relevant for local dev — Vercel manages
// function lifecycle in serverless.
if (!process.env["VERCEL"]) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __causalReady: boolean | undefined;
}

export default app;
