import { UnrecoverableError } from "bullmq";
import {
  BLOB_KIND_EXTRACTED_IMAGE,
  StorageError,
  getPrisma,
  sha256Hex,
  storageKeyForImage,
  upsertBlobRecord,
  type PrismaClient,
  type StorageProvider,
} from "@ai-study-companion/db";
import { workerConfig } from "../../config/index.js";
import { logger } from "../../lib/logger.js";
import { getWorkerStorage } from "../../lib/storage.js";
import { documentJobId } from "./job-types.js";
import {
  NodePdfTextExtractor,
  PdfExtractError,
  type PdfPageText,
  type PdfTextExtractor,
} from "./pdfExtractor.js";
import {
  NodePdfImageExtractor,
  type ExtractedImage,
  type PdfImageExtractor,
} from "./imageExtractor.js";
import { createOcrProvider, type OcrProvider } from "./ocr.js";

/**
 * Document pipeline: bucket bytes → pdfjs text → per-page OCR fallback →
 * embedded images → bucket objects + DocumentPages → material READY →
 * chained knowledge job. Runs on the `aistudy.documents` BullMQ queue,
 * so processing continues with the browser closed; the material row is
 * the source of truth for progress (status/pageCount/lastError).
 *
 * The worker never assumes the PDF exists in PostgreSQL: bytes download
 * from Neon Object Storage by the material's `storageKey`, and only
 * metadata (pages, object references, dimensions) is written back.
 *
 * Idempotent by construction: pages upsert by (materialId, pageNumber),
 * image objects upsert by deterministic storageKey, stale pages/images
 * beyond the new page count are deleted, and re-running with the same
 * bytes reproduces the same rows. Material.status is the document
 * stage; knowledgeStatus is untouched except a reprocess reset by the
 * API — extraction failures must not silently mark knowledge.
 */

export interface DocumentServiceOptions {
  db?: PrismaClient | null;
  textExtractor?: PdfTextExtractor;
  imageExtractor?: PdfImageExtractor;
  ocrProvider?: OcrProvider | null;
  /** Bucket access. Defaults to the worker singleton; tests inject a fake. */
  storage?: StorageProvider | null;
  /** Injected by the processor (BullMQ knowledge queue); tests inject a fake. */
  enqueueKnowledge?: (materialId: string, correlationId: string) => Promise<string | null>;
  ocrTextThreshold?: number;
  maxPages?: number;
  maxImages?: number;
}

export interface DocumentProcessStats {
  materialId: string;
  projectId: string;
  pageCount: number;
  textPages: number;
  ocrPages: number;
  emptyPages: number[];
  imageCount: number;
  imagesSkipped: number;
  knowledgeEnqueued: boolean;
  durationMs: number;
}

function resolveDb(explicit?: PrismaClient | null): PrismaClient {
  const db = explicit ?? getPrisma();
  if (!db) {
    throw new UnrecoverableError(
      "Database is not configured (DATABASE_URL missing); cannot process documents."
    );
  }
  return db;
}

async function failMaterial(db: PrismaClient, materialId: string, message: string): Promise<void> {
  await db.material
    .update({
      where: { id: materialId },
      data: {
        status: "FAILED",
        lastError: message.slice(0, 2000),
      },
    })
    .catch((error: unknown) => {
      logger.error(
        { materialId, error: error instanceof Error ? error.message : String(error) },
        "Failed to record document failure state"
      );
    });
}

async function markDocumentJob(
  db: PrismaClient,
  materialId: string,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
  error?: string
): Promise<void> {
  try {
    await db.documentJob.updateMany({
      where: { jobId: documentJobId(materialId) },
      data: {
        status,
        ...(status === "PROCESSING"
          ? { startedAt: new Date(), error: null }
          : status === "COMPLETED"
            ? { completedAt: new Date(), error: null }
            : { completedAt: new Date(), error: (error ?? "failed").slice(0, 2000) }),
      },
    });
  } catch (updateError) {
    logger.error(
      {
        materialId,
        error: updateError instanceof Error ? updateError.message : String(updateError),
      },
      "Failed to mirror document job state"
    );
  }
}

export async function processMaterialDocument(
  materialId: string,
  options: DocumentServiceOptions = {}
): Promise<DocumentProcessStats> {
  const startedAt = Date.now();
  const db = resolveDb(options.db);
  const textExtractor = options.textExtractor ?? new NodePdfTextExtractor();
  const imageExtractor = options.imageExtractor ?? new NodePdfImageExtractor();
  const ocrThreshold = options.ocrTextThreshold ?? workerConfig.DOCUMENT_OCR_TEXT_THRESHOLD;
  const maxPages = options.maxPages ?? workerConfig.DOCUMENT_MAX_PAGES_PER_JOB;
  const maxImages = options.maxImages ?? workerConfig.DOCUMENT_MAX_IMAGES_PER_MATERIAL;

  const material = await db.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      projectId: true,
      project: { select: { spaceId: true } },
      ownerId: true,
      filename: true,
      status: true,
      storageKey: true,
      checksum: true,
      processingAttempts: true,
    },
  });
  if (!material) {
    throw new UnrecoverableError(`Material ${materialId} does not exist; not retrying.`);
  }
  if (material.status === "READY") {
    // Idempotent re-delivery: pages already persisted — verify and chain.
    logger.info({ materialId }, "Material already READY; verifying pages before chaining");
  }

  const storage = options.storage !== undefined ? options.storage : getWorkerStorage();
  if (!storage) {
    const message =
      "File storage is not configured (STORAGE_BUCKET + AWS_* missing); cannot download the PDF.";
    await failMaterial(db, materialId, message);
    await markDocumentJob(db, materialId, "FAILED", "storage not configured");
    throw new UnrecoverableError(message);
  }
  // Bytes come from the bucket — never from PostgreSQL.
  let pdfBytes: Buffer;
  try {
    const downloaded = await storage.download(material.storageKey);
    if (!downloaded) {
      await failMaterial(db, materialId, "No source file in storage; re-upload the PDF and retry.");
      await markDocumentJob(db, materialId, "FAILED", "missing source object");
      throw new UnrecoverableError(
        `Material ${materialId} has no stored file; re-upload the PDF and retry.`
      );
    }
    pdfBytes = downloaded;
  } catch (error) {
    if (error instanceof UnrecoverableError) throw error;
    if (error instanceof StorageError && !error.retryable) {
      const message = `File storage unavailable: ${error.message}`;
      await failMaterial(db, materialId, message);
      await markDocumentJob(db, materialId, "FAILED", error.code);
      throw new UnrecoverableError(message);
    }
    throw error;
  }
  if (material.checksum && sha256Hex(new Uint8Array(pdfBytes)) !== material.checksum) {
    await failMaterial(db, materialId, "Stored file failed integrity verification.");
    await markDocumentJob(db, materialId, "FAILED", "checksum mismatch");
    throw new UnrecoverableError(
      `Material ${materialId} bytes failed checksum verification; re-upload.`
    );
  }

  await db.material.update({
    where: { id: materialId },
    data: {
      status: "PROCESSING",
      processingAttempts: { increment: 1 },
      lastError: null,
    },
  });
  await markDocumentJob(db, materialId, "PROCESSING");

  try {
    // pdfjs transfers (detaches) the input ArrayBuffer, so each stage
    // gets its own copy — sharing one buffer breaks the second stage.
    const textBytes = new Uint8Array(pdfBytes);
    const imageBytes = new Uint8Array(pdfBytes);
    let extraction: { pageCount: number; pages: PdfPageText[]; warnings: string[] };
    try {
      extraction = await textExtractor.extractText(textBytes);
    } catch (error) {
      if (error instanceof PdfExtractError && error.code === "ENCRYPTED") {
        const message = "PDF is encrypted or password-protected; cannot extract text.";
        await failMaterial(db, materialId, message);
        await markDocumentJob(db, materialId, "FAILED", message);
        throw new UnrecoverableError(message);
      }
      throw error;
    }
    if (extraction.pageCount === 0) {
      const message = "PDF contains no pages; nothing to process.";
      await failMaterial(db, materialId, message);
      await markDocumentJob(db, materialId, "FAILED", message);
      throw new UnrecoverableError(message);
    }
    if (extraction.pageCount > maxPages) {
      const message =
        `PDF has ${extraction.pageCount} pages (limit ${maxPages}); ` +
        `split the document instead of silently truncating.`;
      await failMaterial(db, materialId, message);
      await markDocumentJob(db, materialId, "FAILED", message);
      throw new UnrecoverableError(message);
    }

    // Embedded images: extracted once, uploaded as PNG objects to the
    // bucket (never sent to Gemini, never embedded into pgvector here),
    // with metadata rows (key, MIME, size, checksum, page, dimensions)
    // in PostgreSQL for selective future use.
    const imagePass = await imageExtractor.extractImages(imageBytes, {
      maxImages,
    });
    const imagesByPage = new Map<number, ExtractedImage[]>();
    for (const image of imagePass.images.slice(0, Math.max(0, maxImages))) {
      const list = imagesByPage.get(image.pageNumber) ?? [];
      list.push(image);
      imagesByPage.set(image.pageNumber, list);
    }
    const storedImagePages = new Set<number>();
    let imageCount = 0;
    for (const image of imagePass.images.slice(0, Math.max(0, maxImages))) {
      const imageKey = storageKeyForImage(
        material.ownerId,
        material.project.spaceId,
        material.projectId,
        materialId,
        image.pageNumber,
        new Uint8Array(image.png)
      );
      try {
        const stored = await storage.upload({
          key: imageKey,
          bytes: new Uint8Array(image.png),
          contentType: "image/png",
        });
        await upsertBlobRecord(db, {
          materialId,
          kind: BLOB_KIND_EXTRACTED_IMAGE,
          storageKey: imageKey,
          mimeType: "image/png",
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksumSha256Hex,
          pageNumber: image.pageNumber,
          width: image.width,
          height: image.height,
        });
      } catch (error) {
        if (error instanceof StorageError && !error.retryable) {
          throw new UnrecoverableError(`Image storage unavailable: ${error.message}`);
        }
        throw error;
      }
      storedImagePages.add(image.pageNumber);
      imageCount += 1;
    }
    const imagesSkipped =
      imagePass.skipped + Math.max(0, imagePass.images.length - Math.max(0, maxImages));

    // OCR fallback: pages below the text threshold get supplemented by
    // OCR over their own embedded images. Real text always counts —
    // the threshold only decides OCR candidacy, never discards text.
    const ocrNeeded = extraction.pages.filter((p) => p.text.length < ocrThreshold);
    const ocrTexts = new Map<number, { text: string; confidence: number }>();
    let ocrProvider: OcrProvider | null = null;
    let ocrEnabled = false;
    let ocrAttemptedPages = 0;
    let ocrImageFailures = 0;
    if (ocrNeeded.length > 0) {
      const injected = options.ocrProvider !== undefined ? options.ocrProvider : null;
      ocrProvider = injected ?? (workerConfig.DOCUMENT_OCR_ENABLED ? createOcrProvider() : null);
      ocrEnabled = ocrProvider !== null;
      if (ocrProvider) {
        try {
          for (const page of ocrNeeded) {
            const candidates = imagesByPage.get(page.pageNumber) ?? [];
            if (candidates.length === 0) continue;
            ocrAttemptedPages += 1;
            const parts: string[] = [];
            let confidenceSum = 0;
            let confidenceCount = 0;
            for (const candidate of candidates) {
              try {
                const result = await ocrProvider.recognize(candidate.png);
                if (result.text.length > 0) {
                  parts.push(result.text);
                  confidenceSum += result.confidence;
                  confidenceCount += 1;
                }
              } catch (error) {
                ocrImageFailures += 1;
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(
                  { materialId, pageNumber: page.pageNumber, error: message },
                  "OCR failed for page image; continuing"
                );
              }
            }
            const joined = parts.join("\n").trim();
            if (joined.length > 0) {
              ocrTexts.set(page.pageNumber, {
                text: joined,
                confidence: confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0,
              });
            }
          }
        } finally {
          // Injected test doubles are owned by the caller.
          if (options.ocrProvider === undefined) {
            await ocrProvider.close().catch(() => undefined);
          }
        }
      } else {
        logger.info(
          { materialId, pages: ocrNeeded.map((p) => p.pageNumber) },
          "OCR unavailable/disabled; low-text pages recorded honestly"
        );
      }
    }

    // Persist pages: one row per PDF page, exact pageNumber preserved so
    // every chunk/tutor citation traces Material → Page.
    let textPages = 0;
    let ocrPages = 0;
    const emptyPages: number[] = [];
    // Stale extracted images from a previous run (a reprocessed PDF
    // with fewer pages must not keep ghost objects): collect keys
    // first, delete metadata in the transaction, then remove the bucket
    // objects (tolerant of already-missing keys).
    const staleKeys = await db.materialBlob
      .findMany({
        where: {
          materialId,
          kind: BLOB_KIND_EXTRACTED_IMAGE,
          pageNumber: { gt: extraction.pageCount },
        },
        select: { storageKey: true },
      })
      .then((rows) => rows.map((r) => r.storageKey))
      .catch(() => [] as string[]);
    await db.$transaction(async (tx) => {
      for (const page of extraction.pages) {
        const ocr = ocrTexts.get(page.pageNumber);
        const combined = [page.text, ocr?.text ?? ""]
          .filter((t) => t.length > 0)
          .join("\n")
          .trim();
        const hasText = page.text.length > 0;
        const source = hasText ? "text" : ocr ? "ocr" : "empty";
        if (hasText) textPages += 1;
        if (ocr) ocrPages += 1;
        if (source === "empty") emptyPages.push(page.pageNumber);
        await tx.documentPage.upsert({
          where: {
            materialId_pageNumber: { materialId, pageNumber: page.pageNumber },
          },
          create: {
            materialId,
            projectId: material.projectId,
            pageNumber: page.pageNumber,
            extractedText: combined,
            charCount: combined.length,
            metadata: {
              headings: page.headings,
              possibleTable: page.possibleTable,
              source,
              textChars: page.text.length,
              ocrChars: ocr?.text.length ?? 0,
              ocrConfidence: ocr?.confidence ?? null,
              imageCount: imagesByPage.get(page.pageNumber)?.length ?? 0,
              imagesStored: storedImagePages.has(page.pageNumber),
              contentHash: sha256Hex(Buffer.from(combined, "utf8")),
            },
          },
          update: {
            extractedText: combined,
            charCount: combined.length,
            metadata: {
              headings: page.headings,
              possibleTable: page.possibleTable,
              source,
              textChars: page.text.length,
              ocrChars: ocr?.text.length ?? 0,
              ocrConfidence: ocr?.confidence ?? null,
              imageCount: imagesByPage.get(page.pageNumber)?.length ?? 0,
              imagesStored: storedImagePages.has(page.pageNumber),
              contentHash: sha256Hex(Buffer.from(combined, "utf8")),
            },
          },
        });
      }
      // A reprocessed PDF with fewer pages must not keep ghost pages.
      await tx.documentPage.deleteMany({
        where: { materialId, pageNumber: { gt: extraction.pageCount } },
      });
      // Stale extracted images from a previous run: drop the metadata
      // rows here, remove the bucket objects right after the commit
      // (tolerant of already-missing keys).
      await tx.materialBlob.deleteMany({
        where: {
          materialId,
          kind: BLOB_KIND_EXTRACTED_IMAGE,
          pageNumber: { gt: extraction.pageCount },
        },
      });
    });

    if (staleKeys.length > 0) {
      await storage.deleteObjects(staleKeys).catch((error: unknown) => {
        logger.warn(
          {
            materialId,
            keys: staleKeys,
            error: error instanceof Error ? error.message : String(error),
          },
          "Stale image cleanup missed bucket objects; leftovers logged"
        );
      });
    }

    if (textPages === 0 && ocrPages === 0) {
      const textChars = extraction.pages.reduce((sum, p) => sum + p.text.length, 0);
      const skipHint =
        imagePass.skipReasons.length > 0
          ? ` Image skips: ${imagePass.skipReasons.slice(0, 3).join(" | ")}`
          : "";
      const ocrHint = !ocrEnabled
        ? "OCR was unavailable/disabled, so image-only pages had no fallback."
        : ocrAttemptedPages === 0
          ? "No page had an extractable image to OCR (images examined: " +
            `${imagePass.examined}, stored: ${imageCount}, skipped: ${imagesSkipped}).` +
            skipHint
          : `OCR ran on ${ocrAttemptedPages} page(s) with ${ocrImageFailures} image failure(s) but read no text.`;
      const message =
        `No extractable text on any page and OCR produced nothing ` +
        `(${extraction.pageCount} page(s), ${textChars} text chars, ` +
        `${imageCount} image(s) stored). ${ocrHint}`;
      await failMaterial(db, materialId, message);
      await markDocumentJob(db, materialId, "FAILED", message);
      throw new UnrecoverableError(message);
    }

    await db.material.update({
      where: { id: materialId },
      data: {
        status: "READY",
        pageCount: extraction.pageCount,
        processedAt: new Date(),
        lastError: extraction.warnings.join(" ").slice(0, 2000) || null,
      },
    });
    await markDocumentJob(db, materialId, "COMPLETED");

    // Chain knowledge indexing (chunk → Gemini → pgvector). The document
    // job is done either way — a chaining failure is recorded on the
    // knowledge fields, never by un-readying the document.
    let knowledgeEnqueued = false;
    if (options.enqueueKnowledge) {
      try {
        await options.enqueueKnowledge(materialId, `document-${materialId}-${Date.now()}`);
        knowledgeEnqueued = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ materialId, error: message }, "Knowledge chaining enqueue failed");
        await db.material
          .update({
            where: { id: materialId },
            data: {
              knowledgeStatus: "FAILED",
              knowledgeUpdatedAt: new Date(),
              knowledgeError:
                "Document processing succeeded; knowledge enqueue failed — retry indexing.".slice(
                  0,
                  2000
                ),
            },
          })
          .catch(() => undefined);
      }
    }

    const stats: DocumentProcessStats = {
      materialId,
      projectId: material.projectId,
      pageCount: extraction.pageCount,
      textPages,
      ocrPages,
      emptyPages,
      imageCount,
      imagesSkipped,
      knowledgeEnqueued,
      durationMs: Date.now() - startedAt,
    };
    logger.info(
      {
        materialId,
        projectId: material.projectId,
        pageCount: stats.pageCount,
        textPages,
        ocrPages,
        imageCount,
        imagesSkipped,
        knowledgeEnqueued,
        durationMs: stats.durationMs,
        status: "ready",
      },
      "Document processing completed"
    );
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = error instanceof UnrecoverableError;
    // Unrecoverable paths already recorded their own FAILED state above;
    // transient failures (parse blips, OCR engine hiccups, DB deadlocks)
    // mark FAILED too but stay retryable — BullMQ retries, and the
    // reprocess endpoint can always requeue. Never leave PROCESSING stuck.
    if (!permanent) {
      await failMaterial(db, materialId, message);
      await markDocumentJob(db, materialId, "FAILED", message);
    }
    logger.error(
      { materialId, error: message, status: "failed", permanent },
      "Document processing failed"
    );
    throw error;
  }
}
