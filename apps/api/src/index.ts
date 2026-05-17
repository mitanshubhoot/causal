import type { FastifyInstance } from "fastify";
import { buildApp } from "./factory.js";
import { config } from "./config.js";

const app: FastifyInstance = await buildApp();

// Ensure all plugins (neo4j, postgres, redis, auth, routes) are fully
// initialized before this module finishes loading. Without this, Vercel's
// adapter exports the app before app.ready() completes, and every incoming
// request hangs waiting for initialization that never finishes.
await app.ready();

// Vercel's Fastify adapter intercepts listen() in serverless context.
// In local dev this actually binds a port.
app.listen({ port: config.API_PORT, host: config.API_HOST }).catch((err) => {
  app.log.error(err);
  if (!process.env["VERCEL"]) process.exit(1);
});

// Graceful shutdown (local dev only — Vercel manages lifecycle in production)
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    process.exit(0);
  });
}

// Required export: Vercel's serverless runtime invokes the exported app
export default app;
