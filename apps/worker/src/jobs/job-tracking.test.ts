import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@ai-study-companion/db";
import { markJobCompleted, markJobFailed, markJobProcessing } from "./job-tracking.js";
import { knowledgeJobId } from "./knowledge-processing/job-types.js";

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

describe.skipIf(!hasTestDb)("job tracking (isolated test DB)", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.activityEvent.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
      prisma = null;
    }
  });

  async function seedJob(status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" = "QUEUED") {
    const db = getDb();
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.user.create({ data: { email: `job-${tag}@example.com`, name: "Job" } });
    const space = await db.space.create({ data: { ownerId: user.id, name: `JS-${tag}` } });
    const project = await db.project.create({
      data: { spaceId: space.id, ownerId: user.id, name: `JP-${tag}` },
    });
    const material = await db.material.create({
      data: {
        projectId: project.id,
        ownerId: user.id,
        filename: "job.pdf",
        originalFilename: "job.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: `job/${tag}`,
        status: "READY",
        pageCount: 1,
      },
    });
    const row = await db.documentJob.create({
      data: {
        materialId: material.id,
        jobId: knowledgeJobId(material.id),
        type: "FULL_INGEST",
        status,
      },
    });
    return { materialId: material.id, jobId: row.jobId as string };
  }

  it("transitions QUEUED → PROCESSING → COMPLETED with timestamps", async () => {
    const db = getDb();
    const { materialId, jobId } = await seedJob();
    await markJobProcessing(materialId);
    const processing = await db.documentJob.findUniqueOrThrow({ where: { jobId } });
    expect(processing.status).toBe("PROCESSING");
    expect(processing.startedAt).not.toBeNull();

    await markJobCompleted(materialId);
    const done = await db.documentJob.findUniqueOrThrow({ where: { jobId } });
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
    expect(done.error).toBeNull();
  });

  it("records failures with attempt count and truncated errors", async () => {
    const db = getDb();
    const { materialId, jobId } = await seedJob("PROCESSING");
    await markJobFailed(materialId, 3, "x".repeat(5000));
    const failed = await db.documentJob.findUniqueOrThrow({ where: { jobId } });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(3);
    expect(failed.error?.length).toBeLessThanOrEqual(2000);
  });

  it("is a no-op for rows that predate tracking (never throws)", async () => {
    await expect(
      markJobProcessing("00000000-0000-4000-8000-000000000000")
    ).resolves.toBeUndefined();
    await expect(markJobCompleted("00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
    await expect(
      markJobFailed("00000000-0000-4000-8000-000000000000", 1, "gone")
    ).resolves.toBeUndefined();
  });
});
