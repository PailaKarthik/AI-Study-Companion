import { z } from "zod";

/**
 * knowledge.process job: chunk a READY material's DocumentPages, embed new
 * or changed chunks with Gemini, persist vectors + FTS, mark knowledge READY.
 * Safe to run repeatedly — chunk indexes are deterministic and content
 * hashes skip unchanged work (see idempotency.ts).
 */
export const knowledgeProcessJobSchema = z.object({
  materialId: z.string().uuid(),
  /** Operator/reindex correlation id for log tracing. */
  correlationId: z.string().min(1).max(128),
  enqueuedAt: z.string().datetime(),
  /** True when triggered by POST /api/materials/:id/reindex. */
  manual: z.boolean().default(false),
});

export type KnowledgeProcessJobData = z.infer<typeof knowledgeProcessJobSchema>;

export interface KnowledgeProcessJobResult {
  status: "ready" | "failed";
  materialId: string;
  projectId: string;
  chunkCount: number;
  embeddedChunkCount: number;
  skippedChunkCount: number;
  failedChunkCount: number;
  skippedEmptyPages: number[];
  durationMs: number;
  correlationId: string;
}

/**
 * Deterministic BullMQ jobId so duplicate enqueues collapse in Redis.
 * Dashes, never colons: BullMQ rejects custom ids containing `:`.
 */
export function knowledgeJobId(materialId: string): string {
  return `knowledge-${materialId}`;
}
