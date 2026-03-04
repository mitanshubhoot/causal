import fp from "fastify-plugin";
import postgres from "postgres";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    pg: postgres.Sql;
  }
}

const postgresPlugin: FastifyPluginAsync = async (fastify) => {
  const sql = postgres(config.POSTGRES_URL, {
    max: 20,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    onnotice: (n) => fastify.log.debug({ notice: n }, "pg notice"),
  });

  // Verify connection
  await sql`SELECT 1`;
  fastify.log.info("PostgreSQL connected");

  fastify.decorate("pg", sql);

  fastify.addHook("onClose", async () => {
    await sql.end();
    fastify.log.info("PostgreSQL disconnected");
  });
};

export default fp(postgresPlugin, { name: "postgres" });
