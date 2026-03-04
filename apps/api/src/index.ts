import { config } from "./config.js";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance | null = null;

async function main() {
  app = await buildApp();

  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
    app.log.info(`Causal API running on http://${config.API_HOST}:${config.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (app) {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
    }
    process.exit(0);
  });
}

main();
