import type { FastifyRequest, FastifyReply } from "fastify";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: FastifyRequest) => string;
}

const store = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyGenerator } = options;

  const getKey = keyGenerator ?? ((req) => req.ip);

  return async function rateLimitMiddleware(req: FastifyRequest, reply: FastifyReply) {
    const key = getKey(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      reply.header("X-RateLimit-Limit", max);
      reply.header("X-RateLimit-Remaining", max - 1);
      reply.header("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));
      return;
    }

    if (entry.count >= max) {
      reply.header("X-RateLimit-Limit", max);
      reply.header("X-RateLimit-Remaining", 0);
      reply.header("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
      reply.header("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      reply.status(429).send({ error: "Too Many Requests", retryAfter: Math.ceil((entry.resetAt - now) / 1000) });
      return;
    }

    entry.count += 1;
    reply.header("X-RateLimit-Limit", max);
    reply.header("X-RateLimit-Remaining", max - entry.count);
    reply.header("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
  };
}

export const apiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
});

export const webhookRateLimiter = createRateLimiter({
  windowMs: 10_000,
  max: 30,
});

export function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

setInterval(cleanupExpiredEntries, 5 * 60_000);
