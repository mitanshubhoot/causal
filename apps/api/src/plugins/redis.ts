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
    lazyConnect: false,
  });

  client.on("error", (err: Error) => fastify.log.error({ err }, "Redis error"));
  client.on("connect", () => fastify.log.info("Redis connected"));

  await client.ping();

  fastify.decorate("redis", client);

  fastify.addHook("onClose", async () => {
    await client.quit();
    fastify.log.info("Redis disconnected");
  });
};

export default fp(redisPlugin, { name: "redis" });
