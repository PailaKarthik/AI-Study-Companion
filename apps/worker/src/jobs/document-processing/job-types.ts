import { z } from "zod";

/**
 * document.process job: parse an uploaded PDF (pdfjs-dist), OCR
 * image-only pages (tesseract.js), extract embedded images (sharp),
 * persist DocumentPages + image blobs, mark the material READY, then
 * chain the knowledge job. Consumed from the `aistudy.documents` queue.
 *
 * Safe to run repeatedly — pages upsert by (materialId, pageNumber),
 * image blobs upsert by deterministic storageKey, and material/job
 * transitions derive from the database, never memory.
 */
export const documentProcessJobSchema = z.object({
  materialId: z.string().uuid(),
  /** Operator/upload/reprocess correlation id for log tracing. */
  correlationId: z.string().min(1).max(128),
  enqueuedAt: z.string().datetime(),
  /** True when triggered by POST /api/materials/:id/reprocess. */
  manual: z.boolean().default(false),
});

export type DocumentProcessJobData = z.infer<typeof documentProcessJobSchema>;

export interface DocumentProcessJobResult {
  status: "ready" | "failed";
  materialId: string;
  projectId: string;
  pageCount: number;
  textPages: number;
  ocrPages: number;
  emptyPages: number[];
  imageCount: number;
  imagesSkipped: number;
  durationMs: number;
  correlationId: string;
}

/**
 * Deterministic BullMQ jobId so duplicate enqueues collapse in Redis.
 * Dashes, never colons: BullMQ rejects custom ids containing `:`.
 */
export function documentJobId(materialId: string): string {
  return `document-${materialId}`;
}
