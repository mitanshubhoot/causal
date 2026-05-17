import { buildApp } from "./factory.js";
import { config } from "./config.js";

const app = await buildApp();

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
