import fp from "fastify-plugin";
import neo4j, { Driver, Session } from "neo4j-driver";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    neo4j: {
      driver: Driver;
      session: () => Session;
      run: <T = unknown>(
        cypher: string,
        params?: Record<string, unknown>
      ) => Promise<T[]>;
    };
  }
}

const neo4jPlugin: FastifyPluginAsync = async (fastify) => {
  const driver = neo4j.driver(
    config.NEO4J_URI,
    neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD),
    {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 5000,
      logging: neo4j.logging.console("warn"),
    }
  );

  await driver.verifyConnectivity();
  fastify.log.info("Neo4j connected");

  const session = () => driver.session();

  async function run<T = unknown>(
    cypher: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const s = driver.session();
    try {
      const result = await s.run(cypher, params);
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await s.close();
    }
  }

  fastify.decorate("neo4j", { driver, session, run });

  fastify.addHook("onClose", async () => {
    await driver.close();
    fastify.log.info("Neo4j disconnected");
  });
};

export default fp(neo4jPlugin, { name: "neo4j" });
