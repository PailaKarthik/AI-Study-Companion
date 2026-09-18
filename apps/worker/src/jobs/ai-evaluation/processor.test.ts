import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@ai-study-companion/db";
import { processAiEvaluate } from "./processor.js";
import { aiEvaluateJobId } from "./job-types.js";
import { EVALUATOR_VERSION } from "./evaluators.js";

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
  await db.aIEvaluation.deleteMany();
  await db.activityEvent.deleteMany();
  await db.user.deleteMany();
}

const ctx = {
  jobId: "test-job",
  queue: "aistudy.evaluations",
  jobName: "ai.evaluate",
  attempt: 1,
  correlationId: "corr-test",
};

describe.skipIf(!hasTestDb)("ai.evaluate processor (isolated test DB)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
      prisma = null;
    }
  });

  async function seedTutorMessage(): Promise<{ messageId: string }> {
    const db = getDb();
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.user.create({ data: { email: `eval-${tag}@example.com`, name: "Eval" } });
    const space = await db.space.create({ data: { ownerId: user.id, name: `ES-${tag}` } });
    const project = await db.project.create({
      data: { spaceId: space.id, ownerId: user.id, name: `EP-${tag}` },
    });
    const conversation = await db.conversation.create({
      data: { projectId: project.id, ownerId: user.id, title: "Eval chat" },
    });
    const message = await db.message.create({
      data: {
        conversationId: conversation.id,
        projectId: project.id,
        role: "ASSISTANT",
        content: "Photosynthesis works like this [1].",
        sequence: 2,
        metadata: { model: "llama-3.3-70b-versatile" },
      },
    });
    await db.tutorEvidence.create({
      data: {
        messageId: message.id,
        materialId: "00000000-0000-4000-8000-000000000000",
        relevanceScore: 0.9,
        citationLabel: "bio.pdf — p. 1",
      },
    });
    return { messageId: message.id };
  }

  it("evaluates a tutor message and persists deterministic scores", async () => {
    const db = getDb();
    const { messageId } = await seedTutorMessage();
    const result = await processAiEvaluate(
      {
        targetType: "tutor_message",
        targetId: messageId,
        correlationId: "corr-1",
        enqueuedAt: new Date().toISOString(),
      },
      ctx
    );
    expect(result.status).toBe("evaluated");
    expect(result.evaluationId).toBeTruthy();
    const row = await db.aIEvaluation.findUniqueOrThrow({
      where: { id: result.evaluationId as string },
    });
    expect(row).toMatchObject({
      feature: "TUTOR",
      provider: "SYSTEM",
      evaluator: EVALUATOR_VERSION,
      targetType: "tutor_message",
      targetId: messageId,
    });
    expect(row.scores).toMatchObject({ groundedness: 1, citationValidity: 1 });
  });

  it("is idempotent: existing evaluations short-circuit", async () => {
    const { messageId } = await seedTutorMessage();
    const data = {
      targetType: "tutor_message" as const,
      targetId: messageId,
      correlationId: "corr-2",
      enqueuedAt: new Date().toISOString(),
    };
    const first = await processAiEvaluate(data, ctx);
    const second = await processAiEvaluate(data, ctx);
    expect(first.status).toBe("evaluated");
    expect(second.status).toBe("skipped-existing");
    expect(second.evaluationId).toBe(first.evaluationId);
    const db = getDb();
    expect(await db.aIEvaluation.count({ where: { targetId: messageId } })).toBe(1);
  });

  it("treats a lost create race (P2002) as skipped-existing, never a failure", async () => {
    // Crash-retry / double-run twins: both pre-checks can miss before
    // either insert commits, and the loser collides on the target-dedupe
    // index. The job must report skipped-existing — not duplicate the row
    // (unique index), not fail the job (P2002 catch).
    const { messageId } = await seedTutorMessage();
    const data = {
      targetType: "tutor_message" as const,
      targetId: messageId,
      correlationId: "corr-race",
      enqueuedAt: new Date().toISOString(),
    };
    const [first, second] = await Promise.all([
      processAiEvaluate(data, ctx),
      processAiEvaluate(data, ctx),
    ]);
    expect(first.status).toBe("evaluated");
    expect(second.status).toBe("skipped-existing");
    expect(second.evaluationId).toBe(first.evaluationId);
    const db = getDb();
    expect(await db.aIEvaluation.count({ where: { targetId: messageId } })).toBe(1);
  });

  it("returns target-missing for deleted rows instead of retrying forever", async () => {
    const result = await processAiEvaluate(
      {
        targetType: "quiz",
        targetId: "00000000-0000-4000-8000-000000000099",
        correlationId: "corr-3",
        enqueuedAt: new Date().toISOString(),
      },
      ctx
    );
    expect(result.status).toBe("target-missing");
    expect(result.evaluationId).toBeNull();
  });

  it("rejects malformed job data", async () => {
    await expect(processAiEvaluate({ nope: true }, ctx)).rejects.toThrow(/Invalid ai.evaluate/);
  });

  it("uses deterministic job ids", () => {
    expect(aiEvaluateJobId("quiz", "abc")).toBe("ai-eval-quiz-abc");
  });
});
