/**
 * Job type definitions. Foundation stage ships only `system.health`.
 * Feature jobs (document ingestion, embeddings, quiz generation) arrive later.
 */

export interface SystemHealthJobData {
  correlationId: string;
  enqueuedAt: string;
  note?: string;
}

export interface SystemHealthJobResult {
  status: "ok";
  correlationId: string;
  processedAt: string;
  workerVersion: string;
}
