import { Redis } from "ioredis";
import { workerConfig, isRedisConfigured } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * BullMQ / Upstash compatibility.
 *
 * BullMQ requires a persistent TCP Redis connection (blocking commands,
 * Lua scripts). It does NOT work with the `@upstash/redis` REST client.
 * The correct approach for Upstash with BullMQ is `ioredis` pointed at the
 * Upstash Redis TCP endpoint (rediss://…) with:
 *   - `maxRetriesPerRequest: null` (mandatory for BullMQ ≥ 5)
 *   - TLS enabled (Upstash endpoints are `rediss://`)
 *
 * Supported credential shapes:
 *   1. REDIS_URL=rediss://default:<token>@<host>:6379  (preferred)
 *   2. UPSTASH_REDIS_URL=https://<host> + UPSTASH_REDIS_TOKEN=<token>
 *      (host is converted from https:// to rediss:// automatically)
 *
 * Returns `null` when no credentials are configured so the worker can
 * boot in degraded local mode instead of crashing.
 *
 * See docs/DEVELOPMENT_DECISIONS.md for the full rationale.
 */

export type RedisConnectionResult =
  | { connection: Redis; mode: "connected"; describe: string }
  | { connection: null; mode: "unconfigured"; describe: string };

function buildRedisUrl(): string | null {
  if (workerConfig.REDIS_URL) {
    return workerConfig.REDIS_URL;
  }
  const { UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN } = workerConfig;
  if (UPSTASH_REDIS_URL && UPSTASH_REDIS_TOKEN) {
    return buildUpstashTcpUrl(UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN);
  }
  return null;
}

/**
 * Compose an ioredis-ready TCP URL from the Upstash pair. Pure (no I/O)
 * so the composition is unit-testable. A full TCP URL that already
 * carries credentials is returned verbatim — recomposing it would append
 * a second `:6379` (`host:6379:6379`), which ioredis rejects with
 * `TypeError: Invalid URL` (seen in production via the API rate limiter).
 */
export function buildUpstashTcpUrl(upstashRedisUrl: string, token: string): string | null {
  try {
    const url = new URL(upstashRedisUrl);
    if (url.username || url.password) return upstashRedisUrl;
    const password = encodeURIComponent(token);
    const port = url.port || "6379";
    const composed = `rediss://default:${password}@${url.hostname}:${port}`;
    new URL(composed);
    return composed;
  } catch {
    return null;
  }
}

/** Exported for unit testing without opening a connection. */
export function resolveRedisUrl(): string | null {
  return buildRedisUrl();
}

/** Returns true when BullMQ-required ioredis options are satisfied. */
export function bullMqConnectionOptions(url: string): {
  url: string;
  maxRetriesPerRequest: null;
} {
  void url;
  return { url, maxRetriesPerRequest: null };
}

export function createRedisConnection(): RedisConnectionResult {
  if (!isRedisConfigured()) {
    return { connection: null, mode: "unconfigured", describe: "Redis not configured" };
  }
  const url = buildRedisUrl();
  if (!url) {
    return { connection: null, mode: "unconfigured", describe: "Redis URL could not be resolved" };
  }
  const safeDescribe = url.replace(/:([^:@/]+)@/, ":***@");
  logger.info({ redis: safeDescribe }, "Connecting to Redis via ioredis (BullMQ-compatible)");

  const connection = new Redis(url, {
    // REQUIRED by BullMQ: disables per-request retry ceiling so blocking
    // commands (BLPOP etc.) can wait for jobs.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  connection.on("error", (error: Error) => {
    logger.error({ error: error.message }, "Redis connection error");
  });

  return { connection, mode: "connected", describe: safeDescribe };
}
