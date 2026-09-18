import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { JOB_NAMES, QUEUE_NAMES } from "@ai-study-companion/config";
import { config, isRedisConfigured } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * Producer-side BullMQ access for the API (enqueue only — the worker
 * consumes). Mirrors the worker's connection rules: ioredis TCP with
 * `maxRetriesPerRequest: null`, same credential shapes, no new Redis.
 *
 * A single lazy Queue is shared process-wide; creating one per request
 * would leak connections. When Redis is unconfigured, callers get a
 * clear 503 path instead of a hang (see materialsService.reindexMaterial).
 */

let queue: Queue | null = null;
let evalQueue: Queue | null = null;
let documentQueue: Queue | null = null;
let connection: Redis | null = null;

/** Redis URL for BullMQ (Upstash rediss or plain TCP). Shared with rate limiting. */
export function resolveRedisUrl(): string | null {
  if (config.REDIS_URL) return config.REDIS_URL;
  if (config.UPSTASH_REDIS_URL && config.UPSTASH_REDIS_TOKEN) {
    try {
      const url = new URL(config.UPSTASH_REDIS_URL);
      const password = encodeURIComponent(config.UPSTASH_REDIS_TOKEN);
      return `rediss://default:${password}@${url.host}:6379`;
    } catch {
      return null;
    }
  }
  return null;
}

export function isQueueConfigured(): boolean {
  return isRedisConfigured() && resolveRedisUrl() !== null;
}

function getKnowledgeQueue(): Queue {
  if (queue) return queue;
  const url = resolveRedisUrl();
  if (!url) {
    throw new Error("Job queue is not configured (no Redis credentials).");
  }
  connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  connection.on("error", (error: Error) => {
    logger.error({ error: error.message }, "API queue Redis connection error");
  });
  queue = new Queue(`aistudy.${QUEUE_NAMES.knowledge}`, {
    connection,
    defaultJobOptions: {
      // Matches DocumentJob.maxAttempts (schema default 5) so the durable
      // row and the transport agree on the retry budget shown in admin.
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return queue;
}

/**
 * Enqueue knowledge processing for a material. Deterministic jobId
 * (`knowledge-<materialId>`, dashes only — BullMQ rejects `:` in custom
 * ids) collapses duplicate enqueues in Redis, so double-clicks and
 * retried requests cannot fork parallel jobs.
 */
export async function enqueueKnowledgeProcessing(materialId: string): Promise<string | null> {
  const q = getKnowledgeQueue();
  const job = await q.add(
    JOB_NAMES.knowledgeProcess,
    {
      materialId,
      correlationId: `reindex-${materialId}-${Date.now()}`,
      enqueuedAt: new Date().toISOString(),
      manual: true,
    },
    { jobId: `knowledge-${materialId}` }
  );
  return job.id ?? null;
}

/**
 * Enqueue document processing for a material (upload or reprocess).
 * Deterministic jobId (`document-<materialId>`, dashes only — BullMQ
 * rejects `:` in custom ids) collapses duplicate enqueues in Redis;
 * attempts/backoff mirror DocumentJob.maxAttempts (schema default 5) so
 * the durable row and the transport agree.
 */
export async function enqueueDocumentProcessing(
  materialId: string,
  manual = false
): Promise<string | null> {
  const q = getDocumentQueue();
  const job = await q.add(
    JOB_NAMES.documentProcess,
    {
      materialId,
      correlationId: `document-${materialId}-${Date.now()}`,
      enqueuedAt: new Date().toISOString(),
      manual,
    },
    { jobId: `document-${materialId}` }
  );
  return job.id ?? null;
}

function getDocumentQueue(): Queue {
  if (documentQueue) return documentQueue;
  const url = resolveRedisUrl();
  if (!url) {
    throw new Error("Job queue is not configured (no Redis credentials).");
  }
  documentQueue = new Queue(`aistudy.${QUEUE_NAMES.documents}`, {
    connection: getSharedConnection(url),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return documentQueue;
}

function getSharedConnection(url: string): Redis {
  if (!connection) {
    connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on("error", (error: Error) => {
      logger.error({ error: error.message }, "API queue Redis connection error");
    });
  }
  return connection;
}

/** Test/process-exit helper. No-op when never connected. */
export async function closeQueues(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (documentQueue) {
    await documentQueue.close();
    documentQueue = null;
  }
  if (evalQueue) {
    await evalQueue.close();
    evalQueue = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

export type AIEvaluationTarget = "tutor_message" | "quiz_attempt" | "quiz" | "recommendation";

function getEvaluationsQueue(): Queue {
  if (evalQueue) return evalQueue;
  const url = resolveRedisUrl();
  if (!url) {
    throw new Error("Job queue is not configured (no Redis credentials).");
  }
  if (!connection) {
    connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on("error", (error: Error) => {
      logger.error({ error: error.message }, "API queue Redis connection error");
    });
  }
  evalQueue = new Queue(`aistudy.${QUEUE_NAMES.evaluations}`, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return evalQueue;
}

/**
 * Enqueue deterministic AI quality evaluation for a persisted target.
 * Best-effort by design: evaluation never blocks UX, so callers catch
 * failures and continue. Deterministic jobId (`ai-eval-<type>-<id>`,
 * dashes only — BullMQ rejects `:` in custom ids) collapses duplicate
 * enqueues; the processor also skips existing rows.
 */
export async function enqueueAIEvaluation(
  targetType: AIEvaluationTarget,
  targetId: string,
  correlationId: string
): Promise<string | null> {
  const q = getEvaluationsQueue();
  const job = await q.add(
    JOB_NAMES.aiEvaluate,
    {
      targetType,
      targetId,
      correlationId,
      enqueuedAt: new Date().toISOString(),
    },
    { jobId: `ai-eval-${targetType}-${targetId}` }
  );
  return job.id ?? null;
}
