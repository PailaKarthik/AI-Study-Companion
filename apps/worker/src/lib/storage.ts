import {
  RedisStorageProvider,
  createStorageProviderFromEnv,
  type StorageProvider,
} from "@ai-study-companion/db";
import { Redis } from "ioredis";
import { workerConfig } from "../config/index.js";
import { logger } from "./logger.js";
import { resolveRedisUrl } from "./redis.js";

/**
 * Process-wide StorageProvider for Neon Object Storage. Built lazily
 * once from validated worker config. Returns null when the bucket is
 * unconfigured — the document service then fails materials honestly
 * (FAILED + clear lastError) instead of assuming bytes in PostgreSQL.
 * `redis` selects the shared test transport (two-process E2E without
 * bucket credentials). Tests inject their own provider via the service
 * `storage` option.
 */

let provider: StorageProvider | null | undefined;
let redisClient: Redis | null = null;

function buildProvider(): StorageProvider | null {
  try {
    if (workerConfig.STORAGE_PROVIDER === "redis") {
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
      provider: workerConfig.STORAGE_PROVIDER,
      bucket: workerConfig.STORAGE_BUCKET,
      endpoint: workerConfig.AWS_ENDPOINT_URL_S3,
      region: workerConfig.AWS_REGION,
      accessKeyId: workerConfig.AWS_ACCESS_KEY_ID,
      secretAccessKey: workerConfig.AWS_SECRET_ACCESS_KEY,
      nodeEnv: workerConfig.NODE_ENV,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "File storage misconfigured; document jobs will fail honestly"
    );
    return null;
  }
}

/** Shared provider, or null when storage is unconfigured. */
export function getWorkerStorage(): StorageProvider | null {
  if (provider === undefined) {
    provider = buildProvider();
  }
  return provider;
}

/** Test helper. No-op when never built. */
export function resetWorkerStorage(): void {
  provider = undefined;
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
