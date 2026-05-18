// ─────────────────────────────────────────────────────────────────────
// Vercel Fastify entrypoint.
//
// Vercel's Fastify framework preset (`@vercel/fastify`) imports this module
// and INTERCEPTS the `fastify.listen()` call to route requests through the
// serverless function. For the interception to take effect before requests
// arrive, the module MUST finish top-level evaluation synchronously. Using
// top-level `await` (e.g. `await buildApp()` or `await app.ready()`) means
// the module never returns, the listen() hook never fires, and every
// request hits an `INTERNAL_FUNCTION_INVOCATION_TIMEOUT`.
//
// Pattern straight from https://vercel.com/docs/frameworks/backend/fastify:
//
//   import Fastify from 'fastify';
//   const fastify = Fastify({ logger: true });
//   fastify.get('/', ...);
//   fastify.listen({ port: 3000 });
//
// We follow that contract: Fastify() is synchronous, register() calls are
// NOT awaited (Fastify queues them and runs them during ready(), which the
// adapter triggers on the first request), and listen() is called at the
// top level synchronously.
// ─────────────────────────────────────────────────────────────────────

console.error(`[boot] ${new Date().toISOString()} module-eval:start`);

import Fastify from "fastify";
import { registerApp } from "./factory.js";
import { config } from "./config.js";

console.error(`[boot] ${new Date().toISOString()} imports:done`);

const isLocalDev =
  process.env["NODE_ENV"] !== "production" && !process.env["VERCEL"];

const app = Fastify({
  logger: isLocalDev
    ? { level: "debug", transport: { target: "pino-pretty", options: { colorize: true } } }
    : { level: "info" },
  disableRequestLogging: false,
});

console.error(`[boot] ${new Date().toISOString()} fastify:instantiated`);

// Schedule all plugin/route registrations — DO NOT await.
// Fastify queues these and runs them during ready(), which is triggered
// automatically by the first request handler in the serverless adapter.
registerApp(app);

console.error(`[boot] ${new Date().toISOString()} routes:queued`);

// Calling listen() is required for Vercel's Fastify preset to detect this
// module as the entrypoint and wrap the instance. The adapter prevents the
// actual TCP bind in serverless and routes incoming requests through the
// Fastify instance instead.
app.listen({ port: config.API_PORT, host: config.API_HOST }, (err) => {
  if (err) {
    console.error("[boot] listen:error", err);
    if (!process.env["VERCEL"]) process.exit(1);
    return;
  }
  console.error(`[boot] ${new Date().toISOString()} listen:ok`);
});

console.error(`[boot] ${new Date().toISOString()} module-eval:end`);

// Graceful shutdown for local dev — Vercel manages function lifecycle.
if (!process.env["VERCEL"]) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

export default app;
