import type { NextFunction, Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";
import { Redis } from "ioredis";
import { normalizeEmail } from "@ai-study-companion/validation";
import { config } from "../config/index.js";
import { RateLimitedError, toErrorPayload } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { isQueueConfigured, resolveRedisUrl } from "../lib/queues.js";
import { getRequestId } from "./requestId.js";

/**
 * Rate-limiting foundation.
 *
 * - Distributed store: fixed-window counters in Redis (Upstash or plain
 *   TCP) via `resolveRedisUrl`, so limits hold across API replicas.
 * - Graceful fallback: any Redis misconfiguration or runtime error drops
 *   back to the in-memory store for that key — limiting degrades to
 *   per-instance instead of failing open (no limiter) or closed (503).
 * - A single lazy Redis connection is shared by all limiters; it is never
 *   awaited at startup (lazyConnect), so a down Redis cannot block boot.
 */

const WINDOW_KEY_PREFIX = "ratelimit:";

/** Redis key for a limiter budget. Pure (no I/O) so tests can pin the format. */
export function rateLimitRedisKey(namespace: string, key: string): string {
  return `${WINDOW_KEY_PREFIX}${namespace}:${key}`;
}

let sharedRedis: Redis | null = null;
let redisWarned = false;

function getSharedRedis(): Redis | null {
  if (!isQueueConfigured()) return null;
  if (sharedRedis) return sharedRedis;
  const url = resolveRedisUrl();
  if (!url) return null;
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {
    // Fallback path already handles per-key errors; stay quiet after once.
    if (!redisWarned) {
      redisWarned = true;
      logger.warn("Rate-limit Redis unavailable; using in-memory fallback");
    }
  });
  sharedRedis = redis;
  return sharedRedis;
}

/**
 * express-rate-limit store: Redis fixed-window with MemoryStore fallback.
 * `init` receives the limiter's real windowMs so Redis TTLs always match.
 *
 * Namespace isolation: every limiter instance carries its own namespace
 * (`ratelimit:<namespace>:<key>`). Without it, limiters sharing a key
 * shape (e.g. the global IP limiter and the register IP limiter) would
 * increment the SAME Redis counter — every API request would burn the
 * register budget and lock out real users behind NAT IPs. The in-memory
 * fallback is already per-instance; the namespace gives Redis the same
 * isolation.
 */
class ResilientRateLimitStore {
  private readonly memory = new MemoryStore();
  private windowMs = 15 * 60 * 1000;

  constructor(private readonly namespace = "default") {}

  init(options: { windowMs?: number }): void {
    if (typeof options.windowMs === "number" && options.windowMs > 0) {
      this.windowMs = options.windowMs;
    }
    this.memory.init?.({ windowMs: this.windowMs } as never);
  }

  private redisKey(key: string): string {
    return rateLimitRedisKey(this.namespace, key);
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date | undefined }> {
    const redis = getSharedRedis();
    if (!redis) {
      return this.memory.increment(key);
    }
    try {
      const redisKey = this.redisKey(key);
      const totalHits = await redis.incr(redisKey);
      if (totalHits === 1) {
        await redis.pexpire(redisKey, this.windowMs);
      }
      const ttl = await redis.pttl(redisKey);
      return {
        totalHits,
        resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)),
      };
    } catch {
      return this.memory.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const redis = getSharedRedis();
      if (redis) {
        await redis.decr(this.redisKey(key));
        return;
      }
    } catch {
      // Fall through to memory.
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    try {
      const redis = getSharedRedis();
      if (redis) {
        await redis.del(this.redisKey(key), `mem:${key}`);
      }
    } catch {
      // Fall through to memory.
    }
    await this.memory.resetKey(key);
  }

  async shutdown(): Promise<void> {
    await this.memory.shutdown?.();
  }
}

/** Test helper: drop the shared connection (each suite starts clean). */
export async function closeRateLimitRedis(): Promise<void> {
  if (sharedRedis) {
    sharedRedis.disconnect();
    sharedRedis = null;
  }
  redisWarned = false;
}

function limitedHandler(req: Request, res: Response): void {
  const requestId = getRequestId(req);
  const error = new RateLimitedError();
  res.status(error.status).json(toErrorPayload(error, requestId));
}

export function createRateLimiter(options?: {
  windowMs?: number;
  max?: number;
  /** Redis key namespace (isolates limiter budgets sharing a key shape). */
  namespace?: string;
}) {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  const max = options?.max ?? (config.isProduction ? 300 : 1000);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new ResilientRateLimitStore(options?.namespace ?? "default") as never,
    handler: limitedHandler,
  });
}

export const globalRateLimiter = createRateLimiter({ namespace: "global" });

export function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction): void {
  globalRateLimiter(req, res, next);
}

/**
 * Stricter per-endpoint limiters for credential endpoints.
 *
 * - Login is keyed by IP + normalized email: IP rotation alone cannot
 *   brute-force one account, and one shared-NAT IP cannot lock out
 *   unrelated accounts. Requests without a parseable email fall back
 *   to IP-only (fail-closed counting, never fail-open).
 * - Limits are env-configurable so tests can trigger 429s deterministically
 *   without timing hacks (AUTH_LOGIN_RATE_LIMIT_MAX / _REGISTER_ / _WINDOW).
 */
export function createAuthLimiter(kind: "register" | "login", maxOverride?: number) {
  const max =
    maxOverride ??
    (kind === "register" ? config.AUTH_REGISTER_RATE_LIMIT_MAX : config.AUTH_LOGIN_RATE_LIMIT_MAX);
  return rateLimit({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new ResilientRateLimitStore(`auth-${kind}`) as never,
    keyGenerator: (req: Request): string => {
      const ip = req.ip ?? "unknown";
      if (kind !== "login") return ip;
      const raw = (req.body as { email?: unknown } | undefined)?.email;
      if (typeof raw !== "string" || raw.trim().length === 0) return ip;
      try {
        return `${ip}:${normalizeEmail(raw)}`;
      } catch {
        return ip;
      }
    },
    handler: limitedHandler,
  });
}
