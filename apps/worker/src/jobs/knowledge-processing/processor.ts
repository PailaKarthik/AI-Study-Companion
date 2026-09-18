import type { JobLogContext } from "../../processors/systemHealth.js";
import { workerConfig } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { processMaterialKnowledge } from "./service.js";
import { markJobCompleted, markJobFailed, markJobProcessing } from "../job-tracking.js";
import { knowledgeProcessJobSchema, type KnowledgeProcessJobResult } from "./job-types.js";

/**
 * `knowledge.process` BullMQ processor. Thin glue: validate job data,
 * run the knowledge service, log the observability contract, return a
 * JSON-safe result. All business logic lives in service.ts (testable
 * without Redis); all retry policy lives in BullMQ queue config.
 *
 * Failure semantics: transient errors rethrow for BullMQ retry with
 * backoff; permanent ones arrive as UnrecoverableError from the service.
 * Either way the material row carries FAILED + knowledgeError while the
 * PDF itself stays READY and usable.
 */
export async function processKnowledgeProcess(
  data: unknown,
  ctx: JobLogContext
): Promise<KnowledgeProcessJobResult> {
  const startedAt = Date.now();
  const parsed = knowledgeProcessJobSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid knowledge.process job data: ${parsed.error.message}`);
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
    "Processing knowledge.process job"
  );

  // Mock provider is only acceptable in tests — never silently embed
  // production content with deterministic fake vectors.
  const allowMockProvider = workerConfig.NODE_ENV === "test" && !workerConfig.GEMINI_API_KEY;

  const stats = await (async () => {
    await markJobProcessing(job.materialId);
    try {
      return await processMaterialKnowledge(job.materialId, { allowMockProvider });
    } catch (error) {
      await markJobFailed(
        job.materialId,
        ctx.attempt,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  })();

  await markJobCompleted(job.materialId);

  const result: KnowledgeProcessJobResult = {
    status: "ready",
    materialId: stats.materialId,
    projectId: stats.projectId,
    chunkCount: stats.chunkCount,
    embeddedChunkCount: stats.embeddedChunkCount,
    skippedChunkCount: stats.skippedChunkCount,
    failedChunkCount: stats.failedChunkCount,
    skippedEmptyPages: stats.skippedEmptyPages,
    durationMs: Date.now() - startedAt,
    correlationId: job.correlationId,
  };

  logger.info(
    {
      jobId: ctx.jobId,
      queue: ctx.queue,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      ...result,
      status: "completed",
    },
    "Completed knowledge.process job"
  );

  return result;
}
