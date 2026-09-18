import { getPrisma } from "@ai-study-companion/db";
import { logger } from "../lib/logger.js";
import { documentJobId } from "./document-processing/job-types.js";
import { knowledgeJobId } from "./knowledge-processing/job-types.js";

/**
 * Durable background-job bookkeeping (Prompt 11). The admin jobs
 * explorer reads persisted DocumentJob rows — NOT live BullMQ state —
 * for history, so the worker must keep those rows truthful.
 *
 * Semantics:
 * - Rows are created by the API at enqueue time (upsert by deterministic
 *   jobId); the worker only transitions them via updateMany, which is a
 *   deliberate no-op when the row predates this change.
 * - Status writes never fail a job: throwing away completed work over a
 *   bookkeeping write would be worse than a stale row. Failures are
 *   logged with full context instead. Chunk/material writes keep their
 *   existing throw semantics — only the DocumentJob mirror is lenient.
 */

async function markByJobId(
  jobId: string,
  materialId: string,
  data: {
    status: "PROCESSING" | "COMPLETED" | "FAILED";
    attempt?: number;
    error?: string;
  }
): Promise<void> {
  const db = getPrisma();
  if (!db) {
    logger.warn({ materialId }, "Skipping job state mark: database unconfigured");
    return;
  }
  try {
    await db.documentJob.updateMany({
      where: { jobId },
      data: {
        status: data.status,
        ...(data.status === "PROCESSING"
          ? { startedAt: new Date(), error: null }
          : data.status === "COMPLETED"
            ? { completedAt: new Date(), error: null }
            : {
                completedAt: new Date(),
                ...(data.attempt !== undefined ? { attempts: data.attempt } : {}),
                error: (data.error ?? "failed").slice(0, 2000),
              }),
      },
    });
  } catch (error) {
    logger.error(
      { materialId, jobId, error: error instanceof Error ? error.message : String(error) },
      "Failed to mark job state"
    );
  }
}

export async function markJobProcessing(materialId: string): Promise<void> {
  await markByJobId(knowledgeJobId(materialId), materialId, { status: "PROCESSING" });
}

export async function markJobCompleted(materialId: string): Promise<void> {
  await markByJobId(knowledgeJobId(materialId), materialId, { status: "COMPLETED" });
}

export async function markJobFailed(
  materialId: string,
  attempt: number,
  error: string
): Promise<void> {
  await markByJobId(knowledgeJobId(materialId), materialId, {
    status: "FAILED",
    attempt,
    error,
  });
}

/** Document-pipeline mirrors (jobId `document-<materialId>`). Same lenient semantics. */
export async function markDocumentJobProcessing(materialId: string): Promise<void> {
  await markByJobId(documentJobId(materialId), materialId, { status: "PROCESSING" });
}

export async function markDocumentJobCompleted(materialId: string): Promise<void> {
  await markByJobId(documentJobId(materialId), materialId, { status: "COMPLETED" });
}

export async function markDocumentJobFailed(
  materialId: string,
  attempt: number,
  error: string
): Promise<void> {
  await markByJobId(documentJobId(materialId), materialId, {
    status: "FAILED",
    attempt,
    error,
  });
}
