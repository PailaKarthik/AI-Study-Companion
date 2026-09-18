/**
 * Development seed for the AI Study Companion database.
 *
 * DEV-ONLY data, clearly marked. Safe to run repeatedly: every row uses a
 * deterministic UUID and is inserted only when missing (findUnique + create),
 * so re-runs never duplicate.
 *
 * Deliberately NOT seeded: conversations, messages, quiz attempts/responses
 * and assessments — those would look like real AI-generated behavior.
 * Quizzes can be generated later through the real pipeline.
 *
 * Usage:
 *   pnpm --filter @ai-study-companion/db seed   (needs DATABASE_URL)
 *
 * Refuses to run in production unless ALLOW_SEED_IN_PRODUCTION=true.
 */

import { getPrisma } from "./index.js";

// ---------------------------------------------------------------------------
// Deterministic IDs (stable across re-runs)
// ---------------------------------------------------------------------------

const IDs = {
  user: "11111111-1111-4111-8111-111111111111",
  spaceCS: "22222222-2222-4222-8222-222222222222",
  spaceMath: "33333333-3333-4333-8333-333333333333",
  projectOS: "44444444-4444-4444-8444-444444444444",
  projectML: "55555555-5555-4555-8555-555555555555",
  projectLA: "66666666-6666-4666-8666-666666666666",
  conceptProcesses: "77777777-7777-4777-8777-777777777777",
  conceptMemory: "88888888-8888-4888-8888-888888888888",
  conceptFiles: "99999999-9999-4999-8999-999999999999",
  conceptRegression: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conceptGradient: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  conceptVectors: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  materialOS: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  materialML: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  pageOS1: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
  pageOS2: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
  contextGoal: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
  contextWeakness: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
  masteryProcesses: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
  masteryMemory: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
  eventMastery1: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0",
  activityProject: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  activityMaterial: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  activityMastery: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  recReview: "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0",
  recPractice: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
} as const;

export interface SeedPlanSummary {
  users: number;
  spaces: number;
  projects: number;
  concepts: number;
  materials: number;
  documentPages: number;
  learnerContexts: number;
  masteryRecords: number;
  masteryEvents: number;
  activityEvents: number;
  recommendations: number;
}

/** Pure description of the seed dataset (used by tests, no I/O). */
export function buildSeedPlan(): SeedPlanSummary {
  return {
    users: 1,
    spaces: 2,
    projects: 3,
    concepts: 6,
    materials: 2,
    documentPages: 2,
    learnerContexts: 2,
    masteryRecords: 2,
    masteryEvents: 1,
    activityEvents: 3,
    recommendations: 2,
  };
}

export function seedIds(): string[] {
  return Object.values(IDs);
}

type DbClient = NonNullable<ReturnType<typeof getPrisma>>;

/** Minimal delegate shape for idempotent inserts. `any` keeps this dev-only
 * helper compatible with every Prisma delegate's generic signatures. */
type SeedDelegate = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUnique: (args: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (args: any) => Promise<any>;
};

/** Insert-if-missing by primary key. Keeps the seed idempotent. */
async function createIfMissing(
  delegate: SeedDelegate,
  id: string,
  data: Record<string, unknown>
): Promise<"created" | "skipped"> {
  const existing = await delegate.findUnique({ where: { id } });
  if (existing) return "skipped";
  await delegate.create({ data: { ...data, id } });
  return "created";
}

export async function runSeed(db: DbClient): Promise<Record<string, number>> {
  const created: Record<string, number> = {};
  const track = (key: string, result: "created" | "skipped") => {
    if (result === "created") created[key] = (created[key] ?? 0) + 1;
  };

  // 1 demo user (upsert by email so a changed id still converges).
  await db.user.upsert({
    where: { email: "demo@aistudy.app" },
    update: { name: "Demo Learner", lastActiveAt: new Date() },
    create: {
      id: IDs.user,
      email: "demo@aistudy.app",
      name: "Demo Learner",
      role: "USER",
      lastActiveAt: new Date(),
    },
  });

  // 2 spaces.
  track(
    "spaces",
    await createIfMissing(db.space, IDs.spaceCS, {
      ownerId: IDs.user,
      name: "Computer Science",
      description: "Dev seed: broad learning area for CS topics.",
      icon: "💻",
      color: "#4F46E5",
    })
  );
  track(
    "spaces",
    await createIfMissing(db.space, IDs.spaceMath, {
      ownerId: IDs.user,
      name: "Mathematics",
      description: "Dev seed: broad learning area for math topics.",
      icon: "📐",
      color: "#0EA5E9",
    })
  );

  // 3 projects.
  const projects = [
    {
      id: IDs.projectOS,
      spaceId: IDs.spaceCS,
      name: "Operating Systems 101",
      goal: "Understand processes, memory, and filesystems.",
    },
    {
      id: IDs.projectML,
      spaceId: IDs.spaceCS,
      name: "Machine Learning Foundations",
      goal: "Grasp regression and optimization basics.",
    },
    {
      id: IDs.projectLA,
      spaceId: IDs.spaceMath,
      name: "Linear Algebra",
      goal: "Vectors and matrix operations.",
    },
  ];
  for (const p of projects) {
    track(
      "projects",
      await createIfMissing(db.project, p.id, {
        spaceId: p.spaceId,
        ownerId: IDs.user,
        name: p.name,
        description: `Dev seed project: ${p.name}.`,
        goal: p.goal,
        status: "ACTIVE",
      })
    );
  }

  // 6 concepts.
  const concepts = [
    {
      id: IDs.conceptProcesses,
      projectId: IDs.projectOS,
      name: "Processes",
      difficulty: "BEGINNER",
    },
    {
      id: IDs.conceptMemory,
      projectId: IDs.projectOS,
      name: "Virtual Memory",
      difficulty: "INTERMEDIATE",
    },
    {
      id: IDs.conceptFiles,
      projectId: IDs.projectOS,
      name: "File Systems",
      difficulty: "INTERMEDIATE",
    },
    {
      id: IDs.conceptRegression,
      projectId: IDs.projectML,
      name: "Linear Regression",
      difficulty: "BEGINNER",
    },
    {
      id: IDs.conceptGradient,
      projectId: IDs.projectML,
      name: "Gradient Descent",
      difficulty: "INTERMEDIATE",
    },
    { id: IDs.conceptVectors, projectId: IDs.projectLA, name: "Vectors", difficulty: "BEGINNER" },
  ];
  for (const c of concepts) {
    track(
      "concepts",
      await createIfMissing(db.concept, c.id, {
        projectId: c.projectId,
        name: c.name,
        description: `Dev seed concept: ${c.name}.`,
        source: "SEED",
        difficulty: c.difficulty,
      })
    );
  }

  // 2 material metadata rows (no PDF bytes; storage keys are dev placeholders).
  track(
    "materials",
    await createIfMissing(db.material, IDs.materialOS, {
      projectId: IDs.projectOS,
      ownerId: IDs.user,
      filename: "operating-systems-ch1.pdf",
      originalFilename: "operating-systems-ch1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 102400,
      storageKey: "dev-seed/operating-systems-ch1.pdf",
      checksum: "dev-checksum-os-ch1",
      status: "READY",
      pageCount: 2,
      processingAttempts: 1,
      processedAt: new Date(),
    })
  );
  track(
    "materials",
    await createIfMissing(db.material, IDs.materialML, {
      projectId: IDs.projectML,
      ownerId: IDs.user,
      filename: "ml-foundations-notes.pdf",
      originalFilename: "ml-foundations-notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 51200,
      storageKey: "dev-seed/ml-foundations-notes.pdf",
      checksum: "dev-checksum-ml-notes",
      status: "UPLOADED",
    })
  );

  // 2 extracted pages for the READY material.
  track(
    "documentPages",
    await createIfMissing(db.documentPage, IDs.pageOS1, {
      materialId: IDs.materialOS,
      projectId: IDs.projectOS,
      pageNumber: 1,
      extractedText: "Dev seed page text: introduction to processes.",
      charCount: 47,
    })
  );
  track(
    "documentPages",
    await createIfMissing(db.documentPage, IDs.pageOS2, {
      materialId: IDs.materialOS,
      projectId: IDs.projectOS,
      pageNumber: 2,
      extractedText: "Dev seed page text: process states and scheduling.",
      charCount: 51,
    })
  );

  // Learner context rows.
  track(
    "learnerContexts",
    await createIfMissing(db.learnerContext, IDs.contextGoal, {
      userId: IDs.user,
      projectId: null,
      type: "GOAL",
      content: "Dev seed: pass the OS midterm with a focus on processes.",
      importance: 0.9,
    })
  );
  track(
    "learnerContexts",
    await createIfMissing(db.learnerContext, IDs.contextWeakness, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      type: "WEAKNESS",
      content: "Dev seed: confuses paging with segmentation.",
      importance: 0.7,
    })
  );

  // Mastery records.
  track(
    "mastery",
    await createIfMissing(db.conceptMastery, IDs.masteryProcesses, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      conceptId: IDs.conceptProcesses,
      masteryScore: 0.65,
      confidence: 0.6,
      evidenceCount: 2,
      lastAssessedAt: new Date(),
      lastActivityAt: new Date(),
    })
  );
  track(
    "mastery",
    await createIfMissing(db.conceptMastery, IDs.masteryMemory, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      conceptId: IDs.conceptMemory,
      masteryScore: 0.3,
      confidence: 0.4,
      evidenceCount: 1,
      lastAssessedAt: new Date(),
      lastActivityAt: new Date(),
    })
  );

  // Mastery history.
  track(
    "masteryEvents",
    await createIfMissing(db.masteryEvent, IDs.eventMastery1, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      conceptId: IDs.conceptProcesses,
      sourceType: "SYSTEM",
      sourceId: "dev-seed",
      previousScore: 0.5,
      newScore: 0.65,
      delta: 0.15,
      confidence: 0.6,
    })
  );

  // Activity events.
  const activities = [
    {
      id: IDs.activityProject,
      eventType: "PROJECT_CREATED",
      entityType: "Project",
      entityId: IDs.projectOS,
      projectId: IDs.projectOS,
      spaceId: IDs.spaceCS,
    },
    {
      id: IDs.activityMaterial,
      eventType: "MATERIAL_UPLOADED",
      entityType: "Material",
      entityId: IDs.materialOS,
      projectId: IDs.projectOS,
      spaceId: IDs.spaceCS,
    },
    {
      id: IDs.activityMastery,
      eventType: "MASTERY_UPDATED",
      entityType: "ConceptMastery",
      entityId: IDs.masteryProcesses,
      projectId: IDs.projectOS,
      spaceId: IDs.spaceCS,
    },
  ];
  for (const a of activities) {
    track(
      "activityEvents",
      await createIfMissing(db.activityEvent, a.id, {
        userId: IDs.user,
        spaceId: a.spaceId,
        projectId: a.projectId,
        eventType: a.eventType,
        entityType: a.entityType,
        entityId: a.entityId,
        metadata: { seed: true },
      })
    );
  }

  // Recommendations.
  track(
    "recommendations",
    await createIfMissing(db.recommendation, IDs.recReview, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      conceptId: IDs.conceptMemory,
      type: "REVIEW",
      title: "Dev seed: review Virtual Memory",
      description: "Mastery is below 0.5 — revisit paging notes.",
      action: "REVISIT_MATERIAL",
      priority: "HIGH",
      reason: "Low mastery score on Virtual Memory.",
      evidence: { masteryEventId: IDs.eventMastery1, seed: true },
      status: "PENDING",
    })
  );
  track(
    "recommendations",
    await createIfMissing(db.recommendation, IDs.recPractice, {
      userId: IDs.user,
      projectId: IDs.projectOS,
      conceptId: IDs.conceptProcesses,
      type: "PRACTICE",
      title: "Dev seed: practice Processes quiz",
      description: "Consolidate the recent gain on Processes.",
      priority: "MEDIUM",
      reason: "Improving trend on Processes.",
      status: "PENDING",
    })
  );

  return created;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "true") {
    throw new Error("Seed refuses to run in production without ALLOW_SEED_IN_PRODUCTION=true.");
  }
  const db = getPrisma();
  if (!db) {
    throw new Error("DATABASE_URL is not configured; cannot seed.");
  }
  const created = await runSeed(db);
  const total = Object.values(created).reduce((n, c) => n + c, 0);
  // eslint-disable-next-line no-console
  console.log(`[seed] done. New rows: ${total}`, created);
  await db.$disconnect();
}

const invokedDirectly =
  process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");

if (invokedDirectly) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[seed] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
