import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ai-study-companion/db";
import {
  BLOB_KIND_EXTRACTED_IMAGE,
  BLOB_KIND_SOURCE_PDF,
  STORAGE_PROVIDER_NEON_OBJECT_STORAGE,
  StorageError,
  buildPaginatedResult,
  countImageBlobRecords,
  countSourceBlobRecords,
  deleteBlobRecordsByMaterial,
  getBlobRecord,
  listBlobRecordsByMaterial,
  parsePagination,
  sha256Hex,
  storageKeyForMaterial,
  upsertBlobRecord,
  type StorageProvider,
  type StoredBlobMeta,
} from "@ai-study-companion/db";
import type { Paginated } from "@ai-study-companion/shared";
import { materialFilenameSchema } from "@ai-study-companion/validation";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../errors/AppError.js";
import { config } from "../config/index.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow, getOwnedSpaceOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";
import {
  enqueueDocumentProcessing,
  enqueueKnowledgeProcessing,
  isQueueConfigured,
} from "../lib/queues.js";
import { getApiStorage } from "../lib/storage.js";
import { logger } from "../lib/logger.js";
import { withTimeout } from "../lib/withTimeout.js";

/**
 * Upper bound for the enqueue round trip. Without it a stalled Redis
 * blocks the request until the proxy gives up; with it the caller gets a
 * controlled 503 while the material stays QUEUED (the 1h active-job guard
 * + deterministic jobId make a later retry safe, never double-processing).
 */
export const ENQUEUE_TIMEOUT_MS = 10_000;

export interface MaterialSummary {
  id: string;
  projectId: string;
  spaceId: string;
  filename: string;
  status: string;
  knowledgeStatus: string;
  knowledgeUpdatedAt: string | null;
  pageCount: number | null;
  chunkCount: number;
  /** Extracted page images stored in the bucket (metadata counted here). */
  imageCount: number;
  sizeBytes: number;
  /** False for rows whose bytes were never stored (re-upload required). */
  hasFile: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ownership for materials: the caller must own the project (which implies
 * the space). Material.ownerId is checked as well so a hand-crafted id
 * from another user's project can never pass, even on inconsistent rows.
 */
export async function getOwnedMaterialOrThrow(
  userId: string,
  spaceId: string,
  materialId: string,
  db: PrismaClient = requireDb()
): Promise<{ id: string; projectId: string; spaceId: string }> {
  const material = await db.material.findFirst({
    where: { id: materialId, ownerId: userId },
    select: { id: true, projectId: true, ownerId: true },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  const project = await getOwnedProjectOrThrow(userId, material.projectId, db);
  if (spaceId !== project.spaceId) {
    throw new NotFoundError("Material not found");
  }
  await getOwnedSpaceOrThrow(userId, spaceId, db);
  return { id: material.id, projectId: project.id, spaceId };
}

async function getOwnedMaterialInProject(
  userId: string,
  projectId: string,
  materialId: string,
  db: PrismaClient
) {
  const project = await getOwnedProjectOrThrow(userId, projectId, db);
  const material = await db.material.findFirst({
    where: { id: materialId, projectId: project.id, ownerId: userId },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  return { material, project };
}

/** Active knowledge work within the last hour blocks duplicate reindexing. */
const ACTIVE_JOB_WINDOW_MS = 60 * 60 * 1000;

export interface ReindexResult {
  materialId: string;
  knowledgeStatus: string;
  jobId: string | null;
  enqueued: boolean;
}

/**
 * Reindex a READY material's knowledge:
 * 1. material must exist, be owned, and be document-READY;
 * 2. no fresh QUEUED/PROCESSING work (409 otherwise);
 * 3. mark QUEUED + enqueue deterministic jobId (collapses Redis dupes).
 *
 * Safe rebuild: existing chunks stay readable until the worker's final
 * transaction replaces them — reindex never deletes knowledge up front.
 */
export async function reindexMaterial(
  userId: string,
  projectId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  enqueue: (materialId: string) => Promise<string | null> = enqueueKnowledgeProcessing
): Promise<ReindexResult> {
  const { material, project } = await getOwnedMaterialInProject(userId, projectId, materialId, db);

  if (material.status !== "READY") {
    throw new ConflictError(`Material is ${material.status}; only READY materials can be indexed.`);
  }
  const freshThreshold = new Date(Date.now() - ACTIVE_JOB_WINDOW_MS);
  if (
    (material.knowledgeStatus === "QUEUED" || material.knowledgeStatus === "PROCESSING") &&
    material.knowledgeUpdatedAt &&
    material.knowledgeUpdatedAt > freshThreshold
  ) {
    throw new ConflictError("Knowledge processing is already active for this material.");
  }
  // An explicitly injected enqueue owns its transport (tests); only the
  // default BullMQ path requires configured Redis credentials.
  if (enqueue === enqueueKnowledgeProcessing && !isQueueConfigured()) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Job queue is not configured; cannot start knowledge processing."
    );
  }

  const updated = await db.material.update({
    where: { id: material.id },
    data: { knowledgeStatus: "QUEUED", knowledgeUpdatedAt: new Date(), knowledgeError: null },
    select: { id: true, knowledgeStatus: true },
  });

  let jobId: string | null = null;
  try {
    jobId = await withTimeout(enqueue(material.id), ENQUEUE_TIMEOUT_MS, "Knowledge enqueue");
  } catch (error) {
    await db.material
      .update({
        where: { id: material.id },
        data: {
          knowledgeStatus: "FAILED",
          knowledgeUpdatedAt: new Date(),
          knowledgeError: "Failed to enqueue knowledge job.",
        },
      })
      .catch(() => undefined);
    logger.error(
      { materialId: material.id, error: error instanceof Error ? error.message : String(error) },
      "Knowledge enqueue failed after marking QUEUED"
    );
    throw new AppError("SERVICE_UNAVAILABLE", "Job queue is unavailable; try again shortly.");
  }

  await recordRetryRequested(db, {
    userId,
    spaceId: project.spaceId,
    projectId: project.id,
    materialId: material.id,
    jobId,
  });

  // Durable job record: the admin jobs explorer reads persisted
  // DocumentJob rows (not live BullMQ state) for history. Upserted by the
  // deterministic job id so reindexing refreshes — never duplicates — the row.
  if (jobId) {
    await db.documentJob.upsert({
      where: { jobId },
      update: {
        status: "QUEUED",
        attempts: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      },
      create: {
        materialId: material.id,
        jobId,
        type: "FULL_INGEST",
        status: "QUEUED",
      },
    });
  }

  return {
    materialId: updated.id,
    knowledgeStatus: updated.knowledgeStatus,
    jobId,
    enqueued: true,
  };
}

async function recordRetryRequested(
  db: PrismaClient,
  input: {
    userId: string;
    spaceId: string;
    projectId: string;
    materialId: string;
    jobId: string | null;
    keyPrefix?: string;
  }
): Promise<void> {
  await recordActivity(db, {
    userId: input.userId,
    spaceId: input.spaceId,
    projectId: input.projectId,
    eventType: "MATERIAL_RETRY_REQUESTED",
    entityType: "material",
    entityId: input.materialId,
    idempotencyKey: `${input.keyPrefix ?? "material-retry"}:${input.materialId}:${input.jobId ?? "direct"}`,
    metadata: { jobId: input.jobId ?? "direct" },
  });
}

/**
 * Reindex entry point used by the HTTP layer: resolves the material's
 * project, enforces the ownership chain, then delegates. Every miss —
 * unknown id or foreign material — surfaces the identical
 * "Material not found" 404 so callers learn nothing about other projects.
 */
export async function reindexMaterialById(
  userId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  enqueue: (materialId: string) => Promise<string | null> = enqueueKnowledgeProcessing
): Promise<ReindexResult> {
  // Single atomic lookup: material + owning project in one WHERE.
  // Unknown id and foreign material surface the identical 404 — the
  // caller learns nothing about other users' projects, and there is no
  // fetch-then-check window.
  const material = await db.material.findFirst({
    where: { id: materialId, project: { ownerId: userId } },
    select: { projectId: true, project: { select: { spaceId: true } } },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  return reindexMaterial(userId, material.projectId, materialId, db, enqueue);
}

export interface ReprocessResult {
  materialId: string;
  status: string;
  jobId: string | null;
  enqueued: boolean;
}

/**
 * Reprocess a material's document (re-extract text/OCR/images → READY →
 * chained knowledge rebuild):
 * 1. material must exist, be owned, and still have stored bytes
 *    (legacy/ emptied rows → truthful 404, re-upload required);
 * 2. no fresh QUEUED/PROCESSING document work (409 otherwise);
 * 3. reset to QUEUED, clear stale knowledge chunks (rebuilt by the
 *    chained job — never serve citations from superseded pages),
 *    refresh the durable job row, enqueue deterministic jobId.
 */
export async function reprocessMaterial(
  userId: string,
  projectId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  enqueue: (materialId: string) => Promise<string | null> = (id) =>
    enqueueDocumentProcessing(id, true)
): Promise<ReprocessResult> {
  const { material, project } = await getOwnedMaterialInProject(userId, projectId, materialId, db);

  const blobCount = await countSourceBlobRecords(db, material.id);
  if (blobCount === 0) {
    throw new NotFoundError("File is no longer available; please re-upload the material.");
  }
  const freshThreshold = new Date(Date.now() - ACTIVE_JOB_WINDOW_MS);
  if (
    (material.status === "QUEUED" || material.status === "PROCESSING") &&
    material.updatedAt > freshThreshold
  ) {
    throw new ConflictError("Document processing is already active for this material.");
  }

  // Mirrors the BullMQ id (`document-<id>`, dashes only) so the durable
  // row correlates with queue state.
  const documentJobId = `document-${material.id}`;
  await db.$transaction(async (tx) => {
    await tx.material.update({
      where: { id: material.id },
      data: {
        status: "QUEUED",
        pageCount: null,
        processedAt: null,
        lastError: null,
        knowledgeStatus: "NOT_STARTED",
        knowledgeError: null,
        knowledgeUpdatedAt: new Date(),
      },
    });
    // Stale citations must not outlive their pages: the chained
    // knowledge job rebuilds chunks from the fresh pages.
    await tx.knowledgeChunk.deleteMany({ where: { materialId: material.id } });
    await tx.documentJob.upsert({
      where: { jobId: documentJobId },
      update: {
        status: "QUEUED",
        attempts: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      },
      create: {
        materialId: material.id,
        jobId: documentJobId,
        type: "TEXT_EXTRACTION",
        status: "QUEUED",
      },
    });
  });

  let jobId: string | null = null;
  try {
    jobId = await withTimeout(enqueue(material.id), ENQUEUE_TIMEOUT_MS, "Document enqueue");
  } catch (error) {
    await db.material
      .update({
        where: { id: material.id },
        data: {
          status: "FAILED",
          lastError: "Failed to enqueue document job.",
        },
      })
      .catch(() => undefined);
    logger.error(
      { materialId: material.id, error: error instanceof Error ? error.message : String(error) },
      "Document reprocess enqueue failed after marking QUEUED"
    );
    throw new AppError("SERVICE_UNAVAILABLE", "Job queue is unavailable; try again shortly.");
  }

  await recordRetryRequested(db, {
    userId,
    spaceId: project.spaceId,
    projectId: project.id,
    materialId: material.id,
    jobId,
    keyPrefix: "material-reprocess",
  });

  return { materialId: material.id, status: "QUEUED", jobId, enqueued: true };
}

/**
 * Reprocess entry point used by the HTTP layer: resolves the material's
 * project, enforces the ownership chain, then delegates. Every miss —
 * unknown id or foreign material — surfaces the identical
 * "Material not found" 404 so callers learn nothing about other projects.
 */
export async function reprocessMaterialById(
  userId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  enqueue: (materialId: string) => Promise<string | null> = (id) =>
    enqueueDocumentProcessing(id, true)
): Promise<ReprocessResult> {
  const material = await db.material.findFirst({
    where: { id: materialId, project: { ownerId: userId } },
    select: { projectId: true, project: { select: { spaceId: true } } },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  return reprocessMaterial(userId, material.projectId, materialId, db, enqueue);
}

/**
 * Paginated material listing for the owning project (no page contents).
 * Always server-paginated: pageSize is clamped to MAX_PAGE_SIZE so no
 * client can trigger an unbounded read (?pageSize=1000000 → 100).
 */
export async function listProjectMaterials(
  userId: string,
  projectId: string,
  page?: unknown,
  pageSize?: unknown,
  db: PrismaClient = requireDb()
): Promise<Paginated<MaterialSummary>> {
  const project = await getOwnedProjectOrThrow(userId, projectId, db);
  const { page: pageNum, pageSize: size, skip, take } = parsePagination({ page, pageSize });
  const where = { projectId: project.id, ownerId: userId };
  const [total, rows] = await Promise.all([
    db.material.count({ where }),
    db.material.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        filename: true,
        status: true,
        knowledgeStatus: true,
        knowledgeUpdatedAt: true,
        pageCount: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chunks: true, blobs: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);
  // Extracted-image counts per material (metadata rows only — never bytes).
  const imageCounts = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await db.materialBlob.groupBy({
      by: ["materialId"],
      where: { materialId: { in: rows.map((r) => r.id) }, kind: BLOB_KIND_EXTRACTED_IMAGE },
      _count: { _all: true },
    });
    for (const group of grouped) {
      imageCounts.set(group.materialId, group._count._all);
    }
  }
  return buildPaginatedResult(
    rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      spaceId: project.spaceId,
      filename: row.filename,
      status: row.status,
      knowledgeStatus: row.knowledgeStatus,
      knowledgeUpdatedAt: row.knowledgeUpdatedAt?.toISOString() ?? null,
      pageCount: row.pageCount,
      chunkCount: row._count.chunks,
      imageCount: imageCounts.get(row.id) ?? 0,
      sizeBytes: row.sizeBytes,
      hasFile: row._count.blobs > 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    { page: pageNum, pageSize: size }
  );
}

/** First 5 bytes of every PDF (`%PDF-`). Content-Type alone is untrusted. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** Strip directories, control chars, and traversal; never empty. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 255);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new ValidationError("Filename is invalid after sanitization");
  }
  return cleaned;
}

export interface UploadMaterialInput {
  /** Original client filename (validated + sanitized server-side). */
  filename: string;
  /** Declared Content-Type. Checked, but magic bytes decide. */
  contentType?: string;
  bytes: Uint8Array;
}

export interface UploadMaterialResult {
  material: MaterialSummary;
  /** True when the checksum already existed in this project (no new bytes). */
  deduplicated: boolean;
  /** False when bytes stored but the document queue was unreachable (recover via reprocess). */
  enqueued: boolean;
  /** BullMQ job id, or the deterministic id when enqueue was deferred. */
  jobId: string | null;
}

/**
 * Upload a PDF to Neon Object Storage:
 * 1. own the project (foreign → 404);
 * 2. validate filename + declared MIME + size ceiling + `%PDF-` magic;
 * 3. checksum dedup per project (same bytes → existing material, no dup);
 * 4. PUT the bytes to the bucket (isolated key — never PostgreSQL);
 * 5. one transaction: QUEUED material + object metadata + durable
 *    document job row + MATERIAL_UPLOADED (bucket object removed again
 *    if the transaction fails — no orphans);
 * 6. enqueue `document.process` (deterministic jobId collapses dupes).
 *
 * Upload → Queued → worker extraction → READY → chained knowledge job:
 * the browser can close immediately; the worker owns the rest. When the
 * bucket is unconfigured the upload is honestly refused (503) — bytes
 * are never written to PostgreSQL as a fallback.
 */
export async function uploadMaterial(
  userId: string,
  projectId: string,
  input: UploadMaterialInput,
  db: PrismaClient = requireDb(),
  enqueue: (materialId: string) => Promise<string | null> = (id) =>
    enqueueDocumentProcessing(id, false),
  storage: StorageProvider | null = getApiStorage()
): Promise<UploadMaterialResult> {
  const project = await getOwnedProjectOrThrow(userId, projectId, db);

  const parsed = materialFilenameSchema.safeParse(input.filename);
  if (!parsed.success) {
    throw new ValidationError("Filename must be 1–255 characters");
  }
  const filename = sanitizeFilename(parsed.data);

  const declared = (input.contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (declared !== "application/pdf") {
    throw new ValidationError(
      "Only PDF uploads are accepted (Content-Type must be application/pdf)"
    );
  }
  const maxBytes = config.STORAGE_MAX_UPLOAD_BYTES;
  if (input.bytes.length === 0) {
    throw new ValidationError("Uploaded file is empty");
  }
  if (input.bytes.length > maxBytes) {
    throw new ValidationError(
      `File exceeds the maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))} MB`
    );
  }
  if (!isPdfBytes(input.bytes)) {
    throw new ValidationError("File is not a valid PDF (magic bytes mismatch)");
  }

  const checksum = sha256Hex(input.bytes);
  const existing = await db.material.findFirst({
    where: { projectId: project.id, ownerId: userId, checksum },
    select: {
      id: true,
      projectId: true,
      filename: true,
      status: true,
      knowledgeStatus: true,
      knowledgeUpdatedAt: true,
      pageCount: true,
      sizeBytes: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { chunks: true, blobs: true } },
    },
  });
  if (existing) {
    logger.info(
      { projectId: project.id, materialId: existing.id },
      "Upload deduplicated by checksum; returning existing material"
    );
    return {
      material: {
        id: existing.id,
        projectId: existing.projectId,
        spaceId: project.spaceId,
        filename: existing.filename,
        status: existing.status,
        knowledgeStatus: existing.knowledgeStatus,
        knowledgeUpdatedAt: existing.knowledgeUpdatedAt?.toISOString() ?? null,
        pageCount: existing.pageCount,
        chunkCount: existing._count.chunks,
        imageCount: await countImageBlobRecords(db, existing.id),
        sizeBytes: existing.sizeBytes,
        hasFile: existing._count.blobs > 0,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: existing.updatedAt.toISOString(),
      },
      deduplicated: true,
      // No new work enqueued: the existing material owns its pipeline.
      enqueued: false,
      jobId: null,
    };
  }

  const materialId = randomUUID();
  const storageKey = storageKeyForMaterial(userId, project.spaceId, project.id, materialId);
  // Mirrors the BullMQ id (`document-<id>`, dashes only) so the durable
  // row correlates with queue state.
  const documentJobId = `document-${materialId}`;

  if (!storage) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "File storage is not configured; upload a bucket credential to enable uploads."
    );
  }
  // Bytes go to the bucket FIRST (metadata must never reference an
  // object that was never stored). Storage failures refuse the upload
  // outright — PostgreSQL is never a fallback store.
  try {
    await withTimeout(
      storage.upload({ key: storageKey, bytes: input.bytes, contentType: "application/pdf" }),
      ENQUEUE_TIMEOUT_MS,
      "Bucket upload"
    );
  } catch (error) {
    if (error instanceof StorageError) {
      logger.error(
        { materialId, error: error.message, retryable: error.retryable },
        "Bucket upload failed; refusing upload without storing metadata"
      );
      throw new AppError("SERVICE_UNAVAILABLE", `File storage unavailable: ${error.message}`);
    }
    throw error;
  }

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const material = await tx.material.create({
        data: {
          id: materialId,
          projectId: project.id,
          ownerId: userId,
          filename,
          originalFilename: filename,
          mimeType: "application/pdf",
          sizeBytes: input.bytes.length,
          storageKey,
          storageProvider: STORAGE_PROVIDER_NEON_OBJECT_STORAGE,
          checksum,
          // Queued for the document worker on arrival: Upload → Queued is
          // automatic, no second user action required.
          status: "QUEUED",
          knowledgeStatus: "NOT_STARTED",
        },
        select: {
          id: true,
          projectId: true,
          filename: true,
          status: true,
          knowledgeStatus: true,
          knowledgeUpdatedAt: true,
          pageCount: true,
          sizeBytes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      // Metadata only — the bytes already live in the bucket. No bytea,
      // no base64, no JSON payloads: PostgreSQL stores the reference.
      await upsertBlobRecord(tx, {
        materialId: material.id,
        kind: BLOB_KIND_SOURCE_PDF,
        storageKey,
        mimeType: "application/pdf",
        sizeBytes: input.bytes.length,
        checksum,
      });
      await tx.documentJob.create({
        data: {
          materialId: material.id,
          jobId: documentJobId,
          type: "TEXT_EXTRACTION",
          status: "QUEUED",
        },
      });
      await recordActivity(tx, {
        userId,
        spaceId: project.spaceId,
        projectId: project.id,
        eventType: "MATERIAL_UPLOADED",
        entityType: "material",
        entityId: material.id,
        idempotencyKey: `material-upload:${material.id}`,
        metadata: { filename, sizeBytes: input.bytes.length, checksum, storageKey },
      });
      return material;
    });
  } catch (error) {
    // The bucket object is now orphaned: remove it so a failed upload
    // never leaves unreachable bytes behind.
    await storage.deleteObjects([storageKey]).catch((cleanupError: unknown) => {
      logger.error(
        {
          materialId,
          storageKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        },
        "Orphaned bucket object could not be removed after failed upload metadata write"
      );
    });
    throw error;
  }

  logger.info(
    { projectId: project.id, materialId: created.id, sizeBytes: created.sizeBytes, storageKey },
    "Material uploaded to Neon Object Storage"
  );

  // Enqueue document processing. Bytes are durably stored regardless:
  // an unreachable queue leaves the material QUEUED (recoverable via
  // reprocess), never a failed upload.
  let jobId: string | null = null;
  let enqueued = false;
  try {
    jobId = await withTimeout(enqueue(created.id), ENQUEUE_TIMEOUT_MS, "Document enqueue");
    enqueued = true;
  } catch (error) {
    logger.error(
      { materialId: created.id, error: error instanceof Error ? error.message : String(error) },
      "Document enqueue deferred after upload; material stays QUEUED for reprocess"
    );
    await db.material
      .update({
        where: { id: created.id },
        data: {
          lastError:
            "Upload stored; document queue unreachable — retry processing from the materials list.",
        },
      })
      .catch(() => undefined);
  }

  const imageCount = 0; // Fresh uploads have no extracted images yet.
  return {
    material: {
      id: created.id,
      projectId: created.projectId,
      spaceId: project.spaceId,
      filename: created.filename,
      status: created.status,
      knowledgeStatus: created.knowledgeStatus,
      knowledgeUpdatedAt: created.knowledgeUpdatedAt?.toISOString() ?? null,
      pageCount: created.pageCount,
      chunkCount: 0,
      imageCount,
      sizeBytes: created.sizeBytes,
      hasFile: true,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
    deduplicated: false,
    enqueued,
    jobId: jobId ?? documentJobId,
  };
}

export interface MaterialFile {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  bytes: Buffer;
}

/**
 * Load a material's bytes for download/viewing. Ownership enforced in
 * one WHERE (unknown + foreign → identical 404). Bytes stream from the
 * Neon Object Storage bucket — PostgreSQL is never consulted for
 * content. Rows without a bucket object get a truthful 404
 * (re-upload required), never an empty file.
 */
export async function downloadMaterial(
  userId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  storage: StorageProvider | null = getApiStorage()
): Promise<MaterialFile> {
  const material = await db.material.findFirst({
    where: { id: materialId, project: { ownerId: userId } },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      storageKey: true,
    },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  const record = await getBlobRecord(db, material.storageKey);
  if (!record) {
    throw new NotFoundError("File is no longer available; please re-upload the material.");
  }
  if (!storage) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "File storage is not configured; cannot serve downloads."
    );
  }
  const bytes = await storage.download(material.storageKey);
  if (!bytes) {
    logger.error(
      { materialId: material.id, storageKey: material.storageKey },
      "Bucket object missing for a referenced key; directing re-upload"
    );
    throw new NotFoundError("File is no longer available; please re-upload the material.");
  }
  if (material.checksum && sha256Hex(new Uint8Array(bytes)) !== material.checksum) {
    logger.error(
      { materialId: material.id },
      "Stored bytes failed checksum verification; refusing download"
    );
    throw new AppError("INTERNAL_ERROR", "Stored file failed integrity verification");
  }
  return {
    filename: material.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    checksum: material.checksum,
    bytes,
  };
}

/**
 * Delete a material: metadata rows (material, pages, chunks, jobs,
 * knowledge) cascade per schema, then every referenced bucket object
 * (source PDF + extracted images) is deleted from Neon Object Storage.
 * Bucket cleanup is tolerant of already-missing keys and runs AFTER
 * the metadata transaction commits, so a bucket outage can never
 * strand metadata — leftovers are logged with keys for operators.
 * Audit row survives (scalar entityId, no FK) like project/space
 * deletes. Repeated deletion of the same id is a safe 404, never a
 * crash.
 */
export async function deleteMaterial(
  userId: string,
  materialId: string,
  db: PrismaClient = requireDb(),
  storage: StorageProvider | null = getApiStorage()
): Promise<{ id: string; blobsDeleted: number }> {
  const material = await db.material.findFirst({
    where: { id: materialId, project: { ownerId: userId } },
    select: { id: true, projectId: true, project: { select: { spaceId: true } } },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  const records = await listBlobRecordsByMaterial(db, material.id);
  const blobsDeleted = await db.$transaction(async (tx) => {
    const count = await deleteBlobRecordsByMaterial(tx, material.id);
    await recordActivity(tx, {
      userId,
      spaceId: material.project.spaceId,
      projectId: material.projectId,
      eventType: "MATERIAL_DELETED",
      entityType: "material",
      entityId: material.id,
      idempotencyKey: `material-deleted:${material.id}`,
    });
    await tx.material.delete({ where: { id: material.id } });
    return count;
  });
  if (records.length > 0) {
    if (!storage) {
      logger.error(
        { materialId: material.id, keys: records.map((r) => r.storageKey) },
        "File storage unconfigured: bucket objects orphaned by material delete"
      );
    } else {
      await storage.deleteObjects(records.map((r) => r.storageKey)).catch((error: unknown) => {
        logger.error(
          {
            materialId: material.id,
            keys: records.map((r) => r.storageKey),
            error: error instanceof Error ? error.message : String(error),
          },
          "Bucket cleanup failed after metadata delete; objects orphaned"
        );
      });
    }
  }
  logger.info({ materialId: material.id, blobsDeleted }, "Material deleted with stored objects");
  return { id: material.id, blobsDeleted };
}

export interface MaterialImageItem {
  id: string;
  materialId: string;
  pageNumber: number | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

/**
 * List a material's extracted page images (metadata only — bytes stay
 * in the bucket until explicitly downloaded). Ownership enforced
 * through the project chain (unknown + foreign → identical 404).
 */
export async function listMaterialImages(
  userId: string,
  projectId: string,
  materialId: string,
  db: PrismaClient = requireDb()
): Promise<MaterialImageItem[]> {
  const { material } = await getOwnedMaterialInProject(userId, projectId, materialId, db);
  const rows = await db.materialBlob.findMany({
    where: { materialId: material.id, kind: BLOB_KIND_EXTRACTED_IMAGE },
    select: {
      id: true,
      materialId: true,
      pageNumber: true,
      mimeType: true,
      width: true,
      height: true,
      sizeBytes: true,
      checksum: true,
      createdAt: true,
    },
    orderBy: [{ pageNumber: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    materialId: row.materialId,
    pageNumber: row.pageNumber,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * List a material's extracted page images by material id (single
 * ownership query: unknown + foreign → identical 404). Used by
 * `GET /api/materials/:materialId/images`.
 */
export async function listMaterialImagesById(
  userId: string,
  materialId: string,
  db: PrismaClient = requireDb()
): Promise<MaterialImageItem[]> {
  const material = await db.material.findFirst({
    where: { id: materialId, project: { ownerId: userId } },
    select: { id: true, projectId: true },
  });
  if (!material) {
    throw new NotFoundError("Material not found");
  }
  return listMaterialImages(userId, material.projectId, material.id, db);
}

export interface MaterialImageFile {
  imageId: string;
  materialId: string;
  pageNumber: number | null;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  bytes: Buffer;
}

/**
 * Load one extracted page image. The image id is never a bucket key:
 * callers address metadata by id, ownership is verified through the
 * material → project chain in one query, and only then is the bucket
 * object fetched. Unknown + foreign → identical 404.
 */
export async function downloadMaterialImage(
  userId: string,
  materialId: string,
  imageId: string,
  db: PrismaClient = requireDb(),
  storage: StorageProvider | null = getApiStorage()
): Promise<MaterialImageFile> {
  const image = await db.materialBlob.findFirst({
    where: {
      id: imageId,
      materialId,
      kind: BLOB_KIND_EXTRACTED_IMAGE,
      material: { project: { ownerId: userId } },
    },
    select: {
      id: true,
      materialId: true,
      pageNumber: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      storageKey: true,
    },
  });
  if (!image) {
    throw new NotFoundError("Material image not found");
  }
  if (!storage) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "File storage is not configured; cannot serve images."
    );
  }
  const bytes = await storage.download(image.storageKey);
  if (!bytes) {
    throw new NotFoundError("Image is no longer available; reprocess the material.");
  }
  return {
    imageId: image.id,
    materialId: image.materialId,
    pageNumber: image.pageNumber,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    checksum: image.checksum,
    bytes,
  };
}
