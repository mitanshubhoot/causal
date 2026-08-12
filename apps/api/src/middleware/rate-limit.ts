import type { FastifyRequest, FastifyReply } from "fastify";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: FastifyRequest) => string;
}

interface Counter {
  count: number;
  resetAt: number;
}

// Fallback only. On serverless this Map lives for one instance and dies with
// it, so a caller spread across cold starts was never limited at all — Redis
// below is the real counter; this keeps local dev (and a Redis outage) working.
const store = new Map<string, Counter>();

// A Redis that is down fails every command, and retrying it on every request
// puts the connect timeout in front of the handler. Once it fails, stay on the
// in-memory counter until this passes.
const REDIS_COOLDOWN_MS = 30_000;
let redisDownUntil = 0;

/**
 * Fixed window keyed by the window index, so the counter cannot outlive the
 * window it belongs to even if EXPIRE is lost. Returns null when Redis is
 * unavailable, which is the caller's signal to fall back in-memory.
 */
async function countInRedis(
  req: FastifyRequest,
  key: string,
  windowMs: number,
  now: number
): Promise<Counter | null> {
  const redis = req.server.redis;
  if (!redis || now < redisDownUntil) return null;

  const bucket = Math.floor(now / windowMs);
  const resetAt = (bucket + 1) * windowMs;
  try {
    const results = await redis.multi().incr(`ratelimit:${key}:${bucket}`).pexpire(`ratelimit:${key}:${bucket}`, windowMs).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    if (!count) return null; // a reply we cannot read must not be treated as "1 request so far"
    return { count, resetAt };
  } catch (err) {
    redisDownUntil = now + REDIS_COOLDOWN_MS;
    req.log.warn({ err }, "rate limit falling back to in-memory counter — Redis unavailable");
    return null;
  }
}

function countInMemory(key: string, windowMs: number, now: number): Counter {
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    store.set(key, fresh);
    return fresh;
  }
  entry.count += 1;
  return entry;
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyGenerator } = options;

  const getKey = keyGenerator ?? ((req) => req.ip);

  return async function rateLimitMiddleware(req: FastifyRequest, reply: FastifyReply) {
    const key = getKey(req);
    const now = Date.now();
    const { count, resetAt } = (await countInRedis(req, key, windowMs, now)) ?? countInMemory(key, windowMs, now);

    reply.header("X-RateLimit-Limit", max);
    reply.header("X-RateLimit-Remaining", Math.max(0, max - count));
    reply.header("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

    if (count > max) {
      const retryAfter = Math.ceil((resetAt - now) / 1000);
      reply.header("Retry-After", retryAfter);
      reply.status(429).send({ error: "Too Many Requests", retryAfter });
    }
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
