import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UnrecoverableError } from "bullmq";
import {
  BLOB_KIND_SOURCE_PDF,
  MemoryStorageProvider,
  PrismaClient,
  STORAGE_PROVIDER_NEON_OBJECT_STORAGE,
  sha256Hex,
  storageKeyForMaterial,
  upsertBlobRecord,
} from "@ai-study-companion/db";
import { processMaterialDocument } from "./service.js";
import { PdfExtractError } from "./pdfExtractor.js";
import type { OcrProvider } from "./ocr.js";
import { buildTextPdf } from "./test-fixtures.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasTestDb = Boolean(TEST_DATABASE_URL);

let prisma: PrismaClient | null = null;

function getDb(): PrismaClient {
  if (!hasTestDb) throw new Error("TEST_DATABASE_URL is not set; skipping.");
  if (!prisma) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  }
  return prisma;
}

async function resetDb(): Promise<void> {
  const db = getDb();
  await db.activityEvent.deleteMany();
  await db.user.deleteMany();
}

let seedCounter = 0;

async function seedMaterialWithBlob(pdfBytes: Buffer, status: "QUEUED" | "FAILED" = "QUEUED") {
  const db = getDb();
  seedCounter += 1;
  const tag = `${Date.now()}-${seedCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await db.user.create({
    data: { email: `doc-${tag}@example.com`, name: "DocWorker" },
  });
  const space = await db.space.create({ data: { ownerId: user.id, name: `D-${tag}` } });
  const project = await db.project.create({
    data: { spaceId: space.id, ownerId: user.id, name: `DP-${tag}` },
  });
  const material = await db.material.create({
    data: {
      projectId: project.id,
      ownerId: user.id,
      filename: "doc.pdf",
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdfBytes.length,
      storageKey: storageKeyForMaterial(user.id, space.id, project.id, `seed-${tag}`),
      storageProvider: STORAGE_PROVIDER_NEON_OBJECT_STORAGE,
      checksum: sha256Hex(new Uint8Array(pdfBytes)),
      status,
      knowledgeStatus: "NOT_STARTED",
    },
  });
  // Bytes live in the (fake) bucket; PostgreSQL holds only the reference.
  const storage = new MemoryStorageProvider();
  await storage.upload({
    key: material.storageKey,
    bytes: new Uint8Array(pdfBytes),
    contentType: "application/pdf",
  });
  await upsertBlobRecord(db, {
    materialId: material.id,
    kind: BLOB_KIND_SOURCE_PDF,
    storageKey: material.storageKey,
    mimeType: "application/pdf",
    sizeBytes: pdfBytes.length,
    checksum: material.checksum ?? sha256Hex(new Uint8Array(pdfBytes)),
  });
  // The API creates the durable job row at enqueue time; the worker
  // only mirrors it.
  await db.documentJob.create({
    data: {
      materialId: material.id,
      jobId: `document-${material.id}`,
      type: "TEXT_EXTRACTION",
      status: "QUEUED",
    },
  });
  return { user, space, project, material, storage };
}

function fakeEnqueue() {
  const calls: Array<{ materialId: string; correlationId: string }> = [];
  const fn = async (materialId: string, correlationId: string): Promise<string | null> => {
    calls.push({ materialId, correlationId });
    return `knowledge-${materialId}`;
  };
  return { calls, fn };
}

const emptyImagePass = {
  images: [],
  examined: 0,
  skipped: 0,
  skipReasons: [] as string[],
};

describe.skipIf(!hasTestDb)("document service (isolated test DB)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
      prisma = null;
    }
  });

  it("extracts pages, stores images, marks READY, and chains knowledge", async () => {
    const db = getDb();
    const pdf = buildTextPdf(["Chapter 1 Zephyr\nBody text here", "Second page content"]);
    const { material, storage } = await seedMaterialWithBlob(pdf);
    const enqueue = fakeEnqueue();

    const stats = await processMaterialDocument(material.id, {
      db,
      storage,
      enqueueKnowledge: enqueue.fn,
    });

    expect(stats.pageCount).toBe(2);
    expect(stats.textPages).toBe(2);
    expect(stats.ocrPages).toBe(0);
    expect(stats.emptyPages).toEqual([]);
    expect(stats.knowledgeEnqueued).toBe(true);
    expect(enqueue.calls).toHaveLength(1);

    const updated = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(updated.status).toBe("READY");
    expect(updated.pageCount).toBe(2);
    expect(updated.processedAt).not.toBeNull();

    const pages = await db.documentPage.findMany({
      where: { materialId: material.id },
      orderBy: { pageNumber: "asc" },
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.extractedText).toContain("Zephyr");
    expect(pages[0]?.pageNumber).toBe(1);

    const job = await db.documentJob.findUniqueOrThrow({
      where: { jobId: `document-${material.id}` },
    });
    expect(job.status).toBe("COMPLETED");
  });

  it("is idempotent: re-running reproduces pages without duplicates", async () => {
    const db = getDb();
    const pdf = buildTextPdf(["Stable content page"]);
    const { material, storage } = await seedMaterialWithBlob(pdf);
    const enqueue = fakeEnqueue();

    await processMaterialDocument(material.id, { db, storage, enqueueKnowledge: enqueue.fn });
    await processMaterialDocument(material.id, { db, storage, enqueueKnowledge: enqueue.fn });

    const pages = await db.documentPage.findMany({ where: { materialId: material.id } });
    expect(pages).toHaveLength(1);
    expect(enqueue.calls).toHaveLength(2);
  });

  it("falls back to OCR for image-only pages and records the source", async () => {
    const db = getDb();
    const pdf = buildTextPdf([""]);
    const { material, storage } = await seedMaterialWithBlob(pdf);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const ocr: OcrProvider = {
      name: "fake-ocr",
      recognize: async () => ({ text: "scanned hello world", confidence: 88 }),
      close: async () => undefined,
    };
    const enqueue = fakeEnqueue();

    const stats = await processMaterialDocument(material.id, {
      db,
      storage,
      enqueueKnowledge: enqueue.fn,
      ocrProvider: ocr,
      imageExtractor: {
        name: "fake-images",
        extractImages: async () => ({
          images: [{ pageNumber: 1, index: 0, width: 9, height: 9, png, sizeBytes: png.length }],
          examined: 1,
          skipped: 0,
          skipReasons: [],
        }),
      },
    });

    expect(stats.ocrPages).toBe(1);
    const page = await db.documentPage.findFirstOrThrow({ where: { materialId: material.id } });
    expect(page.extractedText).toContain("scanned hello world");
    expect((page.metadata as { source?: string })?.source).toBe("ocr");
    const stored = await db.materialBlob.findMany({
      where: { materialId: material.id, kind: "EXTRACTED_IMAGE" },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.pageNumber).toBe(1);
    // Image metadata carries dimensions; bytes live in the bucket.
    expect(stored[0]).toMatchObject({ width: 9, height: 9, mimeType: "image/png" });
    expect(await storage.exists(stored[0]?.storageKey ?? "")).toBe(true);
    expect(stored[0]?.storageKey).toMatch(/\/images\/page-1-[0-9a-f]{16}\.png$/);
  });

  it("fails honestly when the bucket object is missing (re-upload required)", async () => {
    const db = getDb();
    seedCounter += 1;
    const tag = `${Date.now()}-${seedCounter}`;
    const user = await db.user.create({
      data: { email: `noblob-${tag}@example.com`, name: "NoBlob" },
    });
    const space = await db.space.create({ data: { ownerId: user.id, name: `N-${tag}` } });
    const project = await db.project.create({
      data: { spaceId: space.id, ownerId: user.id, name: `NP-${tag}` },
    });
    const storage = new MemoryStorageProvider();
    const material = await db.material.create({
      data: {
        projectId: project.id,
        ownerId: user.id,
        filename: "ghost.pdf",
        originalFilename: "ghost.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: `ghost/${tag}`,
        status: "QUEUED",
        knowledgeStatus: "NOT_STARTED",
      },
    });

    await expect(processMaterialDocument(material.id, { db, storage })).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    const updated = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastError).toMatch(/re-upload/i);
  });

  it("fails honestly when file storage itself is unconfigured", async () => {
    const db = getDb();
    const pdf = buildTextPdf(["secret"]);
    const { material } = await seedMaterialWithBlob(pdf);

    await expect(
      processMaterialDocument(material.id, { db, storage: null })
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const updated = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastError).toMatch(/not configured/i);
  });

  it("fails permanently on encrypted PDFs", async () => {
    const db = getDb();
    const pdf = buildTextPdf(["secret"]);
    const { material, storage } = await seedMaterialWithBlob(pdf);

    await expect(
      processMaterialDocument(material.id, {
        db,
        storage,
        textExtractor: {
          name: "fake-encrypted",
          extractText: async () => {
            throw new PdfExtractError("ENCRYPTED", "locked");
          },
        },
        imageExtractor: { name: "fake", extractImages: async () => emptyImagePass },
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const updated = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastError).toMatch(/encrypted/i);
  });

  it("processor rejects invalid job data without touching the database", async () => {
    const { processDocumentProcess } = await import("./processor.js");
    await expect(
      processDocumentProcess(
        { nonsense: true },
        {
          queue: "aistudy.documents",
          jobName: "document.process",
          attempt: 1,
          correlationId: "test",
        }
      )
    ).rejects.toThrow(/Invalid document\.process job data/);
  });
});
