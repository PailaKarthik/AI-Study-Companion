import * as Sentry from "@sentry/node";
import { Worker, type Job } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "@ai-study-companion/config";
import { disconnectPrisma } from "@ai-study-companion/db";
import { isRedisConfigured, workerConfig } from "./config/index.js";
import { createRedisConnection } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { processSystemHealth } from "./processors/systemHealth.js";
import { processDocumentProcess } from "./jobs/document-processing/processor.js";
import { processKnowledgeProcess } from "./jobs/knowledge-processing/processor.js";
import { processAiEvaluate } from "./jobs/ai-evaluation/processor.js";
import { createQueue } from "./queues/index.js";
import type { SystemHealthJobData } from "./jobs/types.js";
import type { DocumentProcessJobData } from "./jobs/document-processing/job-types.js";
import type { KnowledgeProcessJobData } from "./jobs/knowledge-processing/job-types.js";
import type { AiEvaluateJobData } from "./jobs/ai-evaluation/job-types.js";

if (workerConfig.SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: workerConfig.SENTRY_DSN,
      environment: workerConfig.SENTRY_ENVIRONMENT,
      tracesSampleRate: 0.1,
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Sentry init failed; continuing without Sentry"
    );
  }
}

const bootTime = Date.now();

export function uptimeSeconds(): number {
  return Math.floor((Date.now() - bootTime) / 1000);
}

async function bootstrap(): Promise<void> {
  logger.info(
    {
      env: workerConfig.NODE_ENV,
      version: workerConfig.version,
      concurrency: workerConfig.WORKER_CONCURRENCY,
      redisConfigured: isRedisConfigured(),
    },
    "Worker booting"
  );

  if (!isRedisConfigured()) {
    logger.warn(
      "Redis is not configured (REDIS_URL / UPSTASH_REDIS_URL+TOKEN absent). " +
        "Worker running in degraded bootstrap mode: no queues consumed. " +
        "Set Redis credentials and restart to process jobs."
    );
    // Keep the process alive in dev so `pnpm dev:worker` visibly runs.
    // In production without Redis this is a configuration error.
    if (workerConfig.isProduction) {
      throw new Error("Redis must be configured in production");
    }
    return;
  }

  const { connection } = createRedisConnection();
  if (!connection) {
    throw new Error("Failed to create Redis connection");
  }
  await connection.ping().catch((error: Error) => {
    logger.error({ error: error.message }, "Redis ping failed at boot");
    throw error;
  });
  logger.info("Redis connection established");

  const systemWorker = new Worker<SystemHealthJobData>(
    `aistudy.${QUEUE_NAMES.system}`,
    async (job: Job<SystemHealthJobData>) => {
      if (job.name === JOB_NAMES.systemHealth) {
        return processSystemHealth(job.data, {
          jobId: job.id,
          queue: job.queueName,
          jobName: job.name,
          attempt: job.attemptsMade + 1,
          correlationId: job.data.correlationId,
        });
      }
      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: workerConfig.WORKER_CONCURRENCY,
    }
  );

  systemWorker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, queue: job.queueName, jobName: job.name, status: "completed" },
      "Job completed"
    );
  });

  systemWorker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        queue: job?.queueName ?? "unknown",
        jobName: job?.name ?? "unknown",
        attempt: (job?.attemptsMade ?? 0) + 1,
        status: "failed",
        error: error.message,
      },
      "Job failed"
    );
    if (workerConfig.SENTRY_DSN) {
      Sentry.captureException(error);
    }
  });

  // Document pipeline: blob bytes → pdfjs text → OCR fallback →
  // embedded images → DocumentPages → READY → chained knowledge job.
  // Attempts/backoff come from the queue defaults (5 attempts,
  // exponential 5s — matching DocumentJob.maxAttempts); permanent
  // failures arrive as UnrecoverableError from the service.
  const documentWorker = new Worker<DocumentProcessJobData>(
    `aistudy.${QUEUE_NAMES.documents}`,
    async (job: Job<DocumentProcessJobData>) => {
      if (job.name === JOB_NAMES.documentProcess) {
        return processDocumentProcess(
          job.data,
          {
            jobId: job.id,
            queue: job.queueName,
            jobName: job.name,
            attempt: job.attemptsMade + 1,
            correlationId: job.data.correlationId,
          },
          { connection }
        );
      }
      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: workerConfig.WORKER_CONCURRENCY,
    }
  );

  documentWorker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, queue: job.queueName, jobName: job.name, status: "completed" },
      "Job completed"
    );
  });

  documentWorker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        queue: job?.queueName ?? "unknown",
        jobName: job?.name ?? "unknown",
        attempt: (job?.attemptsMade ?? 0) + 1,
        status: "failed",
        error: error.message,
      },
      "Job failed"
    );
    if (workerConfig.SENTRY_DSN) {
      Sentry.captureException(error);
    }
  });

  const knowledgeWorker = new Worker<KnowledgeProcessJobData>(
    `aistudy.${QUEUE_NAMES.knowledge}`,
    async (job: Job<KnowledgeProcessJobData>) => {
      if (job.name === JOB_NAMES.knowledgeProcess) {
        return processKnowledgeProcess(job.data, {
          jobId: job.id,
          queue: job.queueName,
          jobName: job.name,
          attempt: job.attemptsMade + 1,
          correlationId: job.data.correlationId,
        });
      }
      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: workerConfig.WORKER_CONCURRENCY,
    }
  );

  knowledgeWorker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, queue: job.queueName, jobName: job.name, status: "completed" },
      "Job completed"
    );
  });

  knowledgeWorker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        queue: job?.queueName ?? "unknown",
        jobName: job?.name ?? "unknown",
        attempt: (job?.attemptsMade ?? 0) + 1,
        status: "failed",
        error: error.message,
      },
      "Job failed"
    );
    if (workerConfig.SENTRY_DSN) {
      Sentry.captureException(error);
    }
  });

  const evaluationsWorker = new Worker<AiEvaluateJobData>(
    `aistudy.${QUEUE_NAMES.evaluations}`,
    async (job: Job<AiEvaluateJobData>) => {
      if (job.name === JOB_NAMES.aiEvaluate) {
        return processAiEvaluate(job.data, {
          jobId: job.id,
          queue: job.queueName,
          jobName: job.name,
          attempt: job.attemptsMade + 1,
          correlationId: job.data.correlationId,
        });
      }
      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection,
      concurrency: workerConfig.WORKER_CONCURRENCY,
    }
  );

  evaluationsWorker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, queue: job.queueName, jobName: job.name, status: "completed" },
      "Job completed"
    );
  });

  evaluationsWorker.on("failed", (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        queue: job?.queueName ?? "unknown",
        jobName: job?.name ?? "unknown",
        attempt: (job?.attemptsMade ?? 0) + 1,
        status: "failed",
        error: error.message,
      },
      "Job failed"
    );
    if (workerConfig.SENTRY_DSN) {
      Sentry.captureException(error);
    }
  });

  // Enqueue a bootstrap self-test so operators can verify Redis <-> worker.
  // Deterministic jobId (dashes only — BullMQ rejects `:` in custom ids):
  // concurrent boots (autoscale) collapse into one self-test instead of
  // spamming the system queue.
  const queue = createQueue(QUEUE_NAMES.system, connection);
  const correlationId = `boot-${Date.now()}`;
  const testJob = await queue.add(
    JOB_NAMES.systemHealth,
    {
      correlationId,
      enqueuedAt: new Date().toISOString(),
      note: "bootstrap self-test",
    } satisfies SystemHealthJobData,
    { jobId: "system-bootstrap-self-test" }
  );
  logger.info(
    { jobId: testJob.id, jobName: JOB_NAMES.systemHealth, correlationId },
    "Enqueued bootstrap system.health job"
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down worker");
    // Close order: stop accepting new jobs first (workers), then the
    // producer queue, then Redis, then the DB pool. BullMQ re-queues any
    // active job whose lock lapses, and every processor is idempotent, so
    // a mid-job shutdown redelivers instead of losing work.
    await evaluationsWorker.close();
    await knowledgeWorker.close();
    await documentWorker.close();
    await systemWorker.close();
    await queue.close();
    connection.disconnect();
    await disconnectPrisma().catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Prisma disconnect failed"
      );
    });
    process.exit(0);
  };

  const handleSignal = (signal: string): void => {
    // Force-exit if graceful shutdown hangs (e.g. a stuck connection).
    setTimeout(() => process.exit(0), 15_000).unref();
    void shutdown(signal);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  logger.info("Worker ready and consuming queues");
}

// Only auto-boot when executed directly (`tsx watch src/worker.ts`),
// not when imported by tests.
const isDirectRun =
  process.argv[1] != null &&
  (process.argv[1].endsWith("worker.ts") || process.argv[1].endsWith("worker.js"));

if (isDirectRun) {
  bootstrap().catch((error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Worker failed to boot"
    );
    process.exit(1);
  });
}

export { bootstrap };
