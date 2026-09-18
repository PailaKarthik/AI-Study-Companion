import { UnrecoverableError } from "bullmq";
import { getBlobRecord, getPrisma, type Prisma, type PrismaClient } from "@ai-study-companion/db";
import {
  GeminiEmbeddingProvider,
  MockEmbeddingProvider,
  recordEmbeddingUsage,
  type EmbeddingProvider,
} from "@ai-study-companion/ai";
import { workerConfig } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { estimateTokens, planChunks, type ChunkPlanItem } from "./chunker.js";
import { diffChunkPlan, type StoredChunkState } from "./idempotency.js";

export interface KnowledgeServiceOptions {
  db?: PrismaClient | null;
  embedder?: EmbeddingProvider;
  targetTokens?: number;
  overlapTokens?: number;
  maxPages?: number;
  allowMockProvider?: boolean;
}

export interface KnowledgeProcessStats {
  materialId: string;
  projectId: string;
  chunkCount: number;
  embeddedChunkCount: number;
  skippedChunkCount: number;
  failedChunkCount: number;
  skippedEmptyPages: number[];
  durationMs: number;
}

interface StoredRow {
  chunkIndex: number;
  contentHash: string | null;
  hasEmbedding: boolean;
}

function resolveDb(explicit?: PrismaClient | null): PrismaClient {
  const db = explicit ?? getPrisma();
  if (!db) {
    // Deployment misconfiguration — retrying cannot fix it.
    throw new UnrecoverableError(
      "Database is not configured (DATABASE_URL missing); cannot process knowledge."
    );
  }
  return db;
}

function resolveEmbedder(explicit?: EmbeddingProvider, allowMock = false): EmbeddingProvider {
  if (explicit) return explicit;
  if (workerConfig.GEMINI_API_KEY) {
    return new GeminiEmbeddingProvider({
      apiKey: workerConfig.GEMINI_API_KEY,
      model: workerConfig.GEMINI_EMBEDDING_MODEL,
    });
  }
  if (allowMock || workerConfig.NODE_ENV === "test") {
    return new MockEmbeddingProvider();
  }
  throw new UnrecoverableError(
    "GEMINI_API_KEY is not configured; cannot embed chunks. Set the key or run tests with an injected provider."
  );
}

async function loadStoredStates(db: PrismaClient, materialId: string): Promise<StoredRow[]> {
  const rows = await db.$queryRaw<StoredRow[]>`
    SELECT "chunkIndex" AS "chunkIndex",
           "contentHash" AS "contentHash",
           ("embedding" IS NOT NULL) AS "hasEmbedding"
    FROM "knowledge_chunks"
    WHERE "materialId" = ${materialId}::uuid
    ORDER BY "chunkIndex" ASC
  `;
  return rows.map((r) => ({
    chunkIndex: Number(r.chunkIndex),
    contentHash: r.contentHash,
    hasEmbedding: r.hasEmbedding,
  }));
}

async function failMaterial(db: PrismaClient, materialId: string, message: string): Promise<void> {
  await db.material
    .update({
      where: { id: materialId },
      data: {
        knowledgeStatus: "FAILED",
        knowledgeUpdatedAt: new Date(),
        knowledgeError: message.slice(0, 2000),
      },
    })
    .catch((error: unknown) => {
      logger.error(
        { materialId, error: error instanceof Error ? error.message : String(error) },
        "Failed to record knowledge failure state"
      );
    });
}

/**
 * Process one material's knowledge: clean pages → deterministic chunks →
 * embed new/changed chunks → persist vectors → drop stale → mark READY.
 *
 * Idempotent by construction (see idempotency.ts): re-running with the
 * same pages reproduces the same plan, skips identical chunks, and only
 * embeds what changed. Material.status is never touched — embedding
 * failures must not mark a valid PDF as failed.
 */
export async function processMaterialKnowledge(
  materialId: string,
  options: KnowledgeServiceOptions = {}
): Promise<KnowledgeProcessStats> {
  const startedAt = Date.now();
  const db = resolveDb(options.db);
  const embedder = resolveEmbedder(options.embedder, options.allowMockProvider);
  const targetTokens = options.targetTokens ?? workerConfig.KNOWLEDGE_CHUNK_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens ?? workerConfig.KNOWLEDGE_CHUNK_OVERLAP_TOKENS;
  const maxPages = options.maxPages ?? workerConfig.KNOWLEDGE_MAX_PAGES_PER_JOB;

  const material = await db.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      projectId: true,
      ownerId: true,
      status: true,
      filename: true,
      storageKey: true,
    },
  });
  if (!material) {
    throw new UnrecoverableError(`Material ${materialId} does not exist; not retrying.`);
  }
  if (material.status === "FAILED") {
    await failMaterial(
      db,
      materialId,
      "Document processing failed; knowledge requires READY pages."
    );
    throw new UnrecoverableError(
      `Material ${materialId} failed document processing; not retrying.`
    );
  }
  if (material.status !== "READY") {
    // Transient: the document worker may still be working. BullMQ retries.
    throw new Error(
      `Material ${materialId} is ${material.status}, not READY; deferring knowledge processing.`
    );
  }

  await db.material.update({
    where: { id: materialId },
    data: { knowledgeStatus: "PROCESSING", knowledgeUpdatedAt: new Date(), knowledgeError: null },
  });

  try {
    // The source object's metadata row lives in PostgreSQL; the bytes
    // live in the bucket. The knowledge pass itself consumes
    // DocumentPages, but a missing metadata row distinguishes
    // legacy/empty rows (re-upload) from uploaded files still awaiting
    // text extraction (extraction stage).
    const [record, pages] = await Promise.all([
      getBlobRecord(db, material.storageKey).catch(() => null),
      db.documentPage.findMany({
        where: { materialId },
        select: { id: true, pageNumber: true, extractedText: true },
        orderBy: { pageNumber: "asc" },
      }),
    ]);
    if (pages.length === 0 && !record) {
      await failMaterial(
        db,
        materialId,
        "No source file in object storage and no extracted pages."
      );
      throw new UnrecoverableError(
        `Material ${materialId} has no stored file; re-upload the PDF and retry.`
      );
    }
    if (pages.length === 0) {
      await failMaterial(
        db,
        materialId,
        "Document text extraction has not run for this upload yet."
      );
      throw new UnrecoverableError(
        `Material ${materialId} has no extracted pages yet; text extraction must run before knowledge indexing.`
      );
    }
    if (pages.length > maxPages) {
      throw new UnrecoverableError(
        `Material ${materialId} has ${pages.length} pages (limit ${maxPages}); split the document instead of silently truncating.`
      );
    }

    const plan = planChunks(
      pages.map((p) => ({ pageId: p.id, pageNumber: p.pageNumber, text: p.extractedText })),
      { targetTokens, overlapTokens }
    );
    if (plan.chunks.length === 0) {
      await failMaterial(db, materialId, "No extractable text on any page; nothing to index.");
      throw new UnrecoverableError(
        `Material ${materialId} yielded zero chunks; not retrying. Reprocess the document first.`
      );
    }

    const stored = await loadStoredStates(db, materialId);
    const storedStates: StoredChunkState[] = stored.map((s) => ({
      chunkIndex: s.chunkIndex,
      contentHash: s.contentHash,
      hasEmbedding: s.hasEmbedding,
    }));
    const diff = diffChunkPlan(plan.chunks, storedStates);

    let embeddedVectors = new Map<number, number[]>();
    if (diff.toEmbed.length > 0) {
      embeddedVectors = await embedAndRecord(db, embedder, material, diff.toEmbed);
    }

    await persistPlan(
      db,
      materialId,
      material.projectId,
      plan.chunks,
      embeddedVectors,
      diff.staleIndexes
    );

    await db.material.update({
      where: { id: materialId },
      data: { knowledgeStatus: "READY", knowledgeUpdatedAt: new Date(), knowledgeError: null },
    });

    const stats: KnowledgeProcessStats = {
      materialId,
      projectId: material.projectId,
      chunkCount: plan.chunks.length,
      embeddedChunkCount: embeddedVectors.size,
      skippedChunkCount: diff.toSkip.length,
      failedChunkCount: 0,
      skippedEmptyPages: plan.skippedEmptyPages,
      durationMs: Date.now() - startedAt,
    };
    logger.info(
      {
        materialId,
        projectId: material.projectId,
        chunkCount: stats.chunkCount,
        embeddedChunkCount: stats.embeddedChunkCount,
        skippedChunkCount: diff.toSkip.length,
        durationMs: stats.durationMs,
        status: "ready",
      },
      "Knowledge processing completed"
    );
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent =
      error instanceof UnrecoverableError ||
      (typeof error === "object" &&
        error !== null &&
        "retryable" in error &&
        (error as { retryable?: unknown }).retryable === false);
    await failMaterial(db, materialId, message);
    logger.error(
      { materialId, error: message, status: "failed", permanent },
      "Knowledge processing failed"
    );
    throw error;
  }
}

async function embedAndRecord(
  db: PrismaClient,
  embedder: EmbeddingProvider,
  material: { id: string; projectId: string; ownerId: string },
  items: ChunkPlanItem[]
): Promise<Map<number, number[]>> {
  const embedStarted = Date.now();
  const provider = embedder.name === "mock" ? ("SYSTEM" as const) : ("GEMINI" as const);
  try {
    const result = await embedder.embedBatch({
      texts: items.map((item) => item.content),
      taskType: "RETRIEVAL_DOCUMENT",
    });
    if (result.vectors.length !== items.length) {
      throw new Error(
        `Embedder returned ${result.vectors.length} vectors for ${items.length} chunks`
      );
    }
    const byIndex = new Map<number, number[]>();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const vector = result.vectors[i];
      if (!item || !vector) {
        throw new Error(`Embedder response misaligned at position ${i}`);
      }
      byIndex.set(item.chunkIndex, vector);
    }
    await recordEmbeddingUsage(db, {
      userId: material.ownerId,
      projectId: material.projectId,
      feature: "EMBEDDING",
      provider,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      status: "SUCCESS",
      metadata: { chunkCount: items.length, phase: "knowledge-ingest" },
    });
    return byIndex;
  } catch (error) {
    await recordEmbeddingUsage(db, {
      userId: material.ownerId,
      projectId: material.projectId,
      feature: "EMBEDDING",
      provider,
      model: embedder.model,
      latencyMs: Date.now() - embedStarted,
      inputTokens: items.reduce((sum, item) => sum + estimateTokens(item.content), 0),
      status: "FAILED",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      metadata: { chunkCount: items.length, phase: "knowledge-ingest" },
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Upsert every planned chunk (content/metadata/hash), write embeddings
 * for newly embedded items via raw SQL (Prisma cannot write vector
 * columns), then delete stale indexes.
 *
 * Pooler-safe by design: NO interactive `$transaction` here. The runtime
 * `DATABASE_URL` is the Neon pooled connection (PgBouncer transaction
 * mode), where long interactive transactions fail intermittently with
 * "Transaction not found", and Prisma's default 5s interactive-transaction
 * timeout is far too short for 40+ upserts + 40+ vector updates (80
 * round-trips). Each statement below runs in its own implicit transaction,
 * which is pooler-safe.
 *
 * Crash-safety comes from idempotency, not atomicity (see idempotency.ts):
 * - upsert is idempotent by (materialId, chunkIndex);
 * - a crash after upsert but before the vector update leaves
 *   `embedding IS NULL`, so the next retry's diff re-embeds it;
 * - stale deletes run last, so a crash before them just retries the delete;
 * - `knowledgeStatus` stays PROCESSING until the final READY update, so
 *   readers never see half-rebuilt knowledge as ready.
 */
async function persistPlan(
  db: PrismaClient,
  materialId: string,
  projectId: string,
  plan: ChunkPlanItem[],
  embeddedByIndex: Map<number, number[]>,
  staleIndexes: number[]
): Promise<void> {
  for (const item of plan) {
    const metadata = item.metadata as unknown as Prisma.InputJsonValue;
    await db.knowledgeChunk.upsert({
      where: { materialId_chunkIndex: { materialId, chunkIndex: item.chunkIndex } },
      create: {
        projectId,
        materialId,
        pageId: item.pageId,
        pageNumber: item.pageNumber,
        chunkIndex: item.chunkIndex,
        content: item.content,
        tokenCount: item.tokenCount,
        contentHash: item.contentHash,
        metadata,
      },
      update: {
        pageId: item.pageId,
        pageNumber: item.pageNumber,
        content: item.content,
        tokenCount: item.tokenCount,
        contentHash: item.contentHash,
        metadata,
      },
    });
  }
  for (const [chunkIndex, vector] of embeddedByIndex) {
    const literal = `[${vector.join(",")}]`;
    await db.$executeRaw`
        UPDATE "knowledge_chunks"
        SET "embedding" = ${literal}::vector, "updatedAt" = NOW()
        WHERE "materialId" = ${materialId}::uuid AND "chunkIndex" = ${chunkIndex}
      `;
  }
  if (staleIndexes.length > 0) {
    await db.knowledgeChunk.deleteMany({
      where: { materialId, chunkIndex: { in: staleIndexes } },
    });
  }
}
