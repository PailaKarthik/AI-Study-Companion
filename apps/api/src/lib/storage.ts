import {
  RedisStorageProvider,
  createStorageProviderFromEnv,
  type StorageProvider,
} from "@ai-study-companion/db";
import { Redis } from "ioredis";
import { config } from "../config/index.js";
import { resolveRedisUrl } from "./queues.js";
import { logger } from "./logger.js";

/**
 * Process-wide StorageProvider for Neon Object Storage (S3-compatible
 * bucket). Built lazily once from validated config; creating one per
 * request would leak S3 clients/sockets.
 *
 * Transports:
 * - `neon` (default): the real bucket. Null when credentials are absent
 *   → services fail file operations honestly (503 upload / FAILED
 *   material with a clear message) instead of falling back anywhere.
 * - `memory`: explicit in-process test double (unit/integration suites).
 * - `redis`: explicit Redis-backed test transport so two-process E2E
 *   (API + worker) shares bytes without bucket credentials.
 * `memory`/`redis` are refused in production at config load.
 * Tests may also inject their own provider via the service `storage`
 * parameter.
 */

let provider: StorageProvider | null | undefined;
let redisClient: Redis | null = null;

function buildProvider(): StorageProvider | null {
  try {
    if (config.STORAGE_PROVIDER === "redis") {
      const url = resolveRedisUrl();
      if (!url) {
        logger.error("STORAGE_PROVIDER=redis but no Redis URL is configured");
        return null;
      }
      redisClient = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
      });
      redisClient.on("error", (error: Error) => {
        logger.error({ error: error.message }, "Storage Redis connection error");
      });
      return new RedisStorageProvider(redisClient);
    }
    return createStorageProviderFromEnv({
      provider: config.STORAGE_PROVIDER,
      bucket: config.STORAGE_BUCKET,
      endpoint: config.AWS_ENDPOINT_URL_S3,
      region: config.AWS_REGION,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      nodeEnv: config.NODE_ENV,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "File storage misconfigured; file operations will fail honestly"
    );
    return null;
  }
}

/** Shared provider, or null when storage is unconfigured. */
export function getApiStorage(): StorageProvider | null {
  if (provider === undefined) {
    provider = buildProvider();
  }
  return provider;
}

/** Test/process-exit helper. No-op when never built. */
export function resetApiStorage(): void {
  provider = undefined;
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
