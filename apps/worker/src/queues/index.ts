import { Queue, type JobsOptions } from "bullmq";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from "@ai-study-companion/config";
import type { Redis } from "ioredis";

/**
 * Queue naming convention: `aistudy.<queue>` (e.g. `aistudy.system`).
 * Central factory keeps retry/backoff policy consistent.
 */

export function queueName(name: QueueName): string {
  return `aistudy.${name}`;
}

export const defaultJobOptions: JobsOptions = {
  attempts: DEFAULT_JOB_OPTIONS.attempts,
  backoff: { ...DEFAULT_JOB_OPTIONS.backoff },
  removeOnComplete: DEFAULT_JOB_OPTIONS.removeOnComplete,
  removeOnFail: DEFAULT_JOB_OPTIONS.removeOnFail,
};

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(queueName(name), {
    connection,
    defaultJobOptions,
  });
}

export function systemQueueName(): string {
  return queueName(QUEUE_NAMES.system);
}
