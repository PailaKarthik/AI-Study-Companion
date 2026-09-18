import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@ai-study-companion/db";
import { MockEmbeddingProvider } from "@ai-study-companion/ai";
import { processKnowledgeProcess } from "./processor.js";
import { processMaterialKnowledge } from "./service.js";

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

async function seedMaterialWithPages(pageCount: number, wordsPerPage: number) {
  const db = getDb();
  seedCounter += 1;
  const tag = `${Date.now()}-${seedCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await db.user.create({
    data: { email: `worker-${tag}@example.com`, name: "Worker" },
  });
  const space = await db.space.create({ data: { ownerId: user.id, name: `W-${tag}` } });
  const project = await db.project.create({
    data: { spaceId: space.id, ownerId: user.id, name: `WP-${tag}` },
  });
  const material = await db.material.create({
    data: {
      projectId: project.id,
      ownerId: user.id,
      filename: "doc.pdf",
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      storageKey: `worker/${tag}`,
      status: "READY",
      pageCount,
    },
  });
  for (let page = 1; page <= pageCount; page += 1) {
    const text = `Chapter ${page}\n\n${`Content about learning page ${page}. `.repeat(wordsPerPage)}`;
    await db.documentPage.create({
      data: {
        materialId: material.id,
        projectId: project.id,
        pageNumber: page,
        extractedText: text,
      },
    });
  }
  return { user, project, material };
}

describe.skipIf(!hasTestDb)("knowledge processor (isolated test DB, mock embeddings)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
      prisma = null;
    }
  });

  it("chunks, embeds, and marks READY end to end", async () => {
    const db = getDb();
    const { material, project } = await seedMaterialWithPages(2, 30);
    const embedder = new MockEmbeddingProvider();

    const stats = await processMaterialKnowledge(material.id, { db, embedder });

    expect(stats.chunkCount).toBeGreaterThan(0);
    expect(stats.embeddedChunkCount).toBe(stats.chunkCount);
    expect(stats.skippedChunkCount).toBe(0);

    const row = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.knowledgeStatus).toBe("READY");
    expect(row.status).toBe("READY");
    expect(row.knowledgeError).toBeNull();

    const chunks = await db.knowledgeChunk.findMany({
      where: { materialId: material.id },
      orderBy: { chunkIndex: "asc" },
    });
    expect(chunks).toHaveLength(stats.chunkCount);
    for (const chunk of chunks) {
      expect(chunk.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(chunk.projectId).toBe(project.id);
    }
    // Embeddings persisted via raw SQL (Prisma cannot write vector columns).
    const withVectors = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "knowledge_chunks"
      WHERE "materialId" = ${material.id}::uuid AND "embedding" IS NOT NULL
    `;
    expect(Number(withVectors[0]?.count ?? 0)).toBe(stats.chunkCount);
    // FTS generated column populated automatically.
    const fts = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "knowledge_chunks"
      WHERE "materialId" = ${material.id}::uuid AND "searchVector" IS NOT NULL
    `;
    expect(Number(fts[0]?.count ?? 0)).toBe(stats.chunkCount);
    // Observability row recorded.
    const usage = await db.aIUsage.findMany({ where: { feature: "EMBEDDING" } });
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(usage[0]).toMatchObject({ status: "SUCCESS" });
  });

  it("is idempotent: second run embeds nothing and creates no duplicates", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(2, 30);
    const embedder = new MockEmbeddingProvider();

    const first = await processMaterialKnowledge(material.id, { db, embedder });
    const callsAfterFirst = embedder.calls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await processMaterialKnowledge(material.id, { db, embedder });
    expect(second.chunkCount).toBe(first.chunkCount);
    expect(second.embeddedChunkCount).toBe(0);
    expect(second.skippedChunkCount).toBe(first.chunkCount);
    expect(embedder.calls).toBe(callsAfterFirst);

    const count = await db.knowledgeChunk.count({ where: { materialId: material.id } });
    expect(count).toBe(first.chunkCount);
  });

  it("only embeds changed chunks on reprocessing", async () => {
    const db = getDb();
    // ~1200 tokens on one page ⇒ 2 chunks; appending changes only the tail.
    const { material } = await seedMaterialWithPages(1, 150);
    const embedder = new MockEmbeddingProvider();
    const first = await processMaterialKnowledge(material.id, { db, embedder });
    expect(first.chunkCount).toBeGreaterThan(1);

    // Simulate corrected extraction on page 1 (changes later chunks).
    const page = await db.documentPage.findFirstOrThrow({ where: { materialId: material.id } });
    await db.documentPage.update({
      where: { id: page.id },
      data: { extractedText: `${page.extractedText} Appended correction sentence here.` },
    });

    const callsBefore = embedder.calls;
    const second = await processMaterialKnowledge(material.id, { db, embedder });
    expect(second.chunkCount).toBe(first.chunkCount);
    expect(embedder.calls).toBeGreaterThan(callsBefore);
    // Unchanged leading chunks skipped; trailing changed ones re-embedded.
    expect(second.skippedChunkCount).toBeGreaterThan(0);
    expect(second.embeddedChunkCount).toBeGreaterThan(0);
    expect(second.embeddedChunkCount).toBeLessThan(first.chunkCount);
  });

  it("removes stale chunks when content shrinks", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(3, 60);
    const embedder = new MockEmbeddingProvider();
    const first = await processMaterialKnowledge(material.id, { db, embedder });

    await db.documentPage.deleteMany({
      where: { materialId: material.id, pageNumber: { gt: 1 } },
    });
    const second = await processMaterialKnowledge(material.id, { db, embedder });
    expect(second.chunkCount).toBeLessThan(first.chunkCount);
    const remaining = await db.knowledgeChunk.findMany({
      where: { materialId: material.id },
      orderBy: { chunkIndex: "asc" },
    });
    expect(remaining).toHaveLength(second.chunkCount);
    expect(remaining.map((r) => r.chunkIndex)).toEqual(remaining.map((_, i) => i));
  });

  it("defers non-READY material without touching PDF or knowledge state", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(1, 10);
    await db.material.update({ where: { id: material.id }, data: { status: "PROCESSING" } });
    const embedder = new MockEmbeddingProvider();
    // Retryable (not Unrecoverable): the document worker may still finish.
    await expect(processMaterialKnowledge(material.id, { db, embedder })).rejects.toThrow(
      /not READY/
    );
    const row = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.status).toBe("PROCESSING");
    expect(row.knowledgeStatus).toBe("NOT_STARTED");
  });

  it("fails loudly on empty pages without touching PDF status", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(0, 0);
    await db.documentPage.create({
      data: {
        materialId: material.id,
        projectId: material.projectId,
        pageNumber: 1,
        extractedText: "   \n\n  ",
      },
    });
    const embedder = new MockEmbeddingProvider();
    await expect(processMaterialKnowledge(material.id, { db, embedder })).rejects.toThrow(
      /zero chunks/
    );
    const row = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.status).toBe("READY");
  });

  it("requires re-upload when neither blob bytes nor pages exist (legacy row)", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(0, 0);
    const embedder = new MockEmbeddingProvider();
    await expect(processMaterialKnowledge(material.id, { db, embedder })).rejects.toThrow(
      /re-upload/
    );
    const row = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.knowledgeStatus).toBe("FAILED");
  });

  it("waits for text extraction when the bucket object exists but pages do not", async () => {
    const db = getDb();
    const { material } = await seedMaterialWithPages(0, 0);
    const stored = await db.material.findUniqueOrThrow({
      where: { id: material.id },
      select: { storageKey: true },
    });
    // Metadata row only — bytes live in the bucket, never in PostgreSQL.
    await db.materialBlob.create({
      data: {
        materialId: material.id,
        kind: "SOURCE_PDF",
        // Same key the upload path writes (material.storageKey mirrors it).
        storageKey: stored.storageKey,
        mimeType: "application/pdf",
        sizeBytes: 8,
        checksum: "abc123",
      },
    });
    const embedder = new MockEmbeddingProvider();
    await expect(processMaterialKnowledge(material.id, { db, embedder })).rejects.toThrow(
      /text extraction/
    );
    const row = await db.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.knowledgeStatus).toBe("FAILED");
  });

  it("processor validates job data and returns the result contract", async () => {
    await expect(
      processKnowledgeProcess(
        { nope: true },
        {
          queue: "aistudy.knowledge",
          jobName: "knowledge.process",
          attempt: 1,
          correlationId: "c",
        }
      )
    ).rejects.toThrow(/Invalid knowledge.process job data/);
  });

  it("processor runs the service and returns counts", async () => {
    const { material, project } = await seedMaterialWithPages(1, 20);
    const result = await processKnowledgeProcess(
      {
        materialId: material.id,
        correlationId: "proc-test",
        enqueuedAt: new Date().toISOString(),
        manual: true,
      },
      {
        jobId: "job-1",
        queue: "aistudy.knowledge",
        jobName: "knowledge.process",
        attempt: 1,
        correlationId: "proc-test",
      }
    );
    expect(result).toMatchObject({
      status: "ready",
      materialId: material.id,
      projectId: project.id,
      correlationId: "proc-test",
    });
    expect(result.chunkCount).toBeGreaterThan(0);
  });
});
