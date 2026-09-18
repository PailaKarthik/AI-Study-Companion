import { randomUUID } from "node:crypto";
import type { SystemHealthJobData, SystemHealthJobResult } from "../jobs/types.js";
import { workerConfig } from "../config/index.js";
import { logger } from "../lib/logger.js";

export interface JobLogContext {
  jobId?: string;
  queue: string;
  jobName: string;
  attempt: number;
  correlationId: string;
}

/**
 * Infrastructure verification job: `system.health`.
 * Proves the worker can receive a job from Redis, execute it, log with
 * correlation IDs, and return a result — without external credentials.
 */
export async function processSystemHealth(
  data: SystemHealthJobData,
  ctx: JobLogContext
): Promise<SystemHealthJobResult> {
  const startedAt = Date.now();
  const correlationId = data.correlationId || randomUUID();

  logger.info(
    {
      jobId: ctx.jobId,
      queue: ctx.queue,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      correlationId,
      status: "started",
    },
    "Processing system.health job"
  );

  // Simulate a trivial check (no external I/O, no setTimeout mocks of business logic).
  const result: SystemHealthJobResult = {
    status: "ok",
    correlationId,
    processedAt: new Date().toISOString(),
    workerVersion: workerConfig.version,
  };

  logger.info(
    {
      jobId: ctx.jobId,
      queue: ctx.queue,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      correlationId,
      durationMs: Date.now() - startedAt,
      status: "completed",
    },
    "Completed system.health job"
  );

  return result;
}
