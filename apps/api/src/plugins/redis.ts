import fp from "fastify-plugin";
import { Redis } from "ioredis";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: InstanceType<typeof Redis>;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const client = new Redis(config.REDIS_URL as string, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on("error", (err: Error) => fastify.log.error({ err }, "Redis error"));
  client.on("connect", () => fastify.log.info("Redis connected"));

  try {
    await client.connect();
    await client.ping();
  } catch (err) {
    fastify.log.warn({ err }, "Redis unreachable at startup — will retry on first query");
  }

  fastify.decorate("redis", client);

  fastify.addHook("onClose", async () => {
    await client.quit();
    fastify.log.info("Redis disconnected");
  });
};

export default fp(redisPlugin, { name: "redis" });
