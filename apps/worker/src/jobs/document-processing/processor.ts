import type { JobLogContext } from "../../processors/systemHealth.js";
import { Queue } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "@ai-study-companion/config";
import type { Redis } from "ioredis";
import { logger } from "../../lib/logger.js";
import { processMaterialDocument } from "./service.js";
import {
  markDocumentJobCompleted,
  markDocumentJobFailed,
  markDocumentJobProcessing,
} from "../job-tracking.js";
import {
  documentJobId,
  documentProcessJobSchema,
  type DocumentProcessJobResult,
} from "./job-types.js";
import { knowledgeJobId } from "../knowledge-processing/job-types.js";
import { queueName } from "../../queues/index.js";

/**
 * `document.process` BullMQ processor. Thin glue: validate job data,
 * run the document service, log the observability contract, return a
 * JSON-safe result. All business logic lives in service.ts (testable
 * without Redis); all retry policy lives in BullMQ queue config.
 *
 * Failure semantics: transient errors rethrow for BullMQ retry with
 * backoff; permanent ones arrive as UnrecoverableError from the service.
 * Either way the material row carries FAILED + lastError and the durable
 * DocumentJob row mirrors it, while stored bytes stay intact for retry.
 */
export async function processDocumentProcess(
  data: unknown,
  ctx: JobLogContext,
  deps: {
    /** Knowledge-chain enqueue. Defaults to a BullMQ add on the shared connection. */
    enqueueKnowledge?: (materialId: string, correlationId: string) => Promise<string | null>;
    connection?: Redis | null;
  } = {}
): Promise<DocumentProcessJobResult> {
  const startedAt = Date.now();
  const parsed = documentProcessJobSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid document.process job data: ${parsed.error.message}`);
  }
  const job = parsed.data;

  logger.info(
    {
      jobId: ctx.jobId,
      queue: ctx.queue,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      correlationId: job.correlationId,
      materialId: job.materialId,
      status: "started",
    },
    "Processing document.process job"
  );

  const enqueueKnowledge =
    deps.enqueueKnowledge ??
    (async (materialId: string, correlationId: string): Promise<string | null> => {
      if (!deps.connection) return null;
      const queue = new Queue(queueName(QUEUE_NAMES.knowledge), {
        connection: deps.connection,
      });
      try {
        const added = await queue.add(
          JOB_NAMES.knowledgeProcess,
          {
            materialId,
            correlationId,
            enqueuedAt: new Date().toISOString(),
            manual: false,
          },
          {
            jobId: knowledgeJobId(materialId),
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          }
        );
        return added.id ?? null;
      } finally {
        await queue.close().catch(() => undefined);
      }
    });

  const stats = await (async () => {
    await markDocumentJobProcessing(job.materialId);
    try {
      return await processMaterialDocument(job.materialId, { enqueueKnowledge });
    } catch (error) {
      await markDocumentJobFailed(
        job.materialId,
        ctx.attempt,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  })();

  await markDocumentJobCompleted(job.materialId);

  const result: DocumentProcessJobResult = {
    status: "ready",
    materialId: stats.materialId,
    projectId: stats.projectId,
    pageCount: stats.pageCount,
    textPages: stats.textPages,
    ocrPages: stats.ocrPages,
    emptyPages: stats.emptyPages,
    imageCount: stats.imageCount,
    imagesSkipped: stats.imagesSkipped,
    durationMs: Date.now() - startedAt,
    correlationId: job.correlationId,
  };

  logger.info(
    {
      jobId: ctx.jobId,
      queue: ctx.queue,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      documentJobId: documentJobId(job.materialId),
      ...result,
      status: "completed",
    },
    "Completed document.process job"
  );

  return result;
}
