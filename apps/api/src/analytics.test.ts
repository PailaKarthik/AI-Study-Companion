import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";

const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("project + home analytics (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  let projectA = "";
  let projectB = "";

  async function seedProjectData() {
    const db = getTestPrisma();
    const now = Date.now();
    // Materials across statuses.
    for (const [i, status] of ["READY", "READY", "PROCESSING", "FAILED"].entries()) {
      await db.material.create({
        data: {
          projectId: projectA,
          ownerId: userA,
          filename: `doc-${i}.pdf`,
          originalFilename: `doc-${i}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1000,
          storageKey: `seed/${i}-${now}`,
          status: status as "READY" | "PROCESSING" | "FAILED",
          pageCount: 1,
        },
      });
    }
    // Concepts + mastery rows across bands.
    const concepts = [];
    for (const [i, score] of [0.2, 0.5, 0.75, 0.9].entries()) {
      const concept = await db.concept.create({
        data: { projectId: projectA, name: `Concept ${i}` },
      });
      concepts.push(concept);
      await db.conceptMastery.create({
        data: {
          userId: userA,
          projectId: projectA,
          conceptId: concept.id,
          masteryScore: score,
          confidence: 0.8,
          evidenceCount: 3,
          lastAssessedAt: new Date(now - DAY),
        },
      });
    }
    // Quiz with completed + active attempts, responses, assessments.
    const quiz = await db.quiz.create({
      data: { projectId: projectA, createdById: userA, title: "Seeded", status: "PUBLISHED" },
    });
    for (const done of [true, true, false]) {
      const attempt = await db.quizAttempt.create({
        data: {
          quizId: quiz.id,
          projectId: projectA,
          userId: userA,
          startedAt: new Date(now - 2 * DAY),
          completedAt: done ? new Date(now - 2 * DAY + 3_600_000) : null,
          score: done ? 0.8 : null,
          maxScore: 1,
        },
      });
      if (done) {
        const question = await db.quizQuestion.create({
          data: {
            quizId: quiz.id,
            projectId: projectA,
            conceptId: concepts[0]?.id,
            type: "MCQ",
            prompt: "Seeded?",
            order: 0,
          },
        });
        const response = await db.quizResponse.create({
          data: {
            attemptId: attempt.id,
            questionId: question.id,
            projectId: projectA,
            userId: userA,
            selectedOption: "A",
            isCorrect: true,
            score: 0.8,
            evaluatedAt: new Date(now - 2 * DAY + 3_600_000),
          },
        });
        await db.assessment.create({
          data: {
            attemptId: attempt.id,
            responseId: response.id,
            userId: userA,
            projectId: projectA,
            conceptId: concepts[0]?.id,
            score: 0.8,
            accuracy: 1,
            feedback: "Good",
            evaluatorModel: "system-deterministic",
          },
        });
      }
    }
    // Recommendations across statuses.
    for (const status of ["PENDING", "COMPLETED", "DISMISSED"] as const) {
      await db.recommendation.create({
        data: {
          userId: userA,
          projectId: projectA,
          type: "REVIEW",
          title: `Rec ${status}`,
          priority: "HIGH",
          status,
          completedAt: status === "COMPLETED" ? new Date(now - DAY) : null,
        },
      });
    }
    // Activity spread over three UTC days (today, yesterday, 3 days ago).
    for (const [i, daysAgo] of [0, 0, 1, 3].entries()) {
      await db.activityEvent.create({
        data: {
          userId: userA,
          projectId: projectA,
          eventType: i < 2 ? "TUTOR_INTERACTION" : "PROJECT_VIEWED",
          createdAt: new Date(now - daysAgo * DAY - 3_600_000),
        },
      });
    }
    // One stale event outside any reasonable default window.
    await db.activityEvent.create({
      data: {
        userId: userA,
        projectId: projectA,
        eventType: "PROJECT_VIEWED",
        createdAt: new Date(now - 400 * DAY),
      },
    });
  }

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
    const db = getTestPrisma();
    userA = (await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).id;
    const spaceA = (await authedPost(app, "/api/spaces", cookieA, { name: "Space A" }).expect(201))
      .body.data.id as string;
    projectA = (
      await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
        name: "Project A",
      }).expect(201)
    ).body.data.id as string;
    const spaceB = (await authedPost(app, "/api/spaces", cookieB, { name: "Space B" }).expect(201))
      .body.data.id as string;
    projectB = (
      await authedPost(app, `/api/spaces/${spaceB}/projects`, cookieB, {
        name: "Project B",
      }).expect(201)
    ).body.data.id as string;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("aggregates project analytics from persisted rows", async () => {
    await seedProjectData();
    const res = await authedGet(app, `/api/projects/${projectA}/analytics`, cookieA).expect(200);
    const data = res.body.data;
    expect(data.projectId).toBe(projectA);
    expect(data.totals).toMatchObject({
      materials: 4,
      materialsReady: 2,
      materialsProcessing: 1,
      materialsFailed: 1,
      tutorInteractions: 2,
      quizzes: 1,
      quizAttempts: 3,
      quizzesCompleted: 2,
      assessments: 2,
      conceptsTracked: 4,
      conceptsAssessed: 4,
      recommendationsCreated: 3,
      recommendationsCompleted: 1,
      recommendationsDismissed: 1,
    });
    expect(data.totals.averageAssessmentScore).toBeCloseTo(0.8, 5);
    expect(data.totals.activityDays).toBe(3);
    // Today + yesterday consecutive → streak 2 (the 400-day-old row is out of range).
    // Note: SPACE_CREATED/PROJECT_CREATED events also land in range; days still 3.
    expect(data.totals.activityDays).toBeGreaterThanOrEqual(3);
    expect(data.totals.learningStreakDays).toBeGreaterThanOrEqual(1);
    expect(data.masteryDistribution).toMatchObject({
      needsAttention: 1,
      developing: 1,
      stable: 1,
      strong: 1,
      unassessed: 0,
    });
    const nonZeroDays = data.activityOverTime.filter((d: { count: number }) => d.count > 0);
    expect(nonZeroDays.length).toBeGreaterThanOrEqual(3);
    expect(data.recentActivity.length).toBeGreaterThan(0);
  });

  it("honors date filtering and returns honest empties", async () => {
    await seedProjectData();
    const narrow = await authedGet(
      app,
      `/api/projects/${projectA}/analytics?from=${new Date(Date.now() - DAY).toISOString()}`,
      cookieA
    ).expect(200);
    // The 3-days-ago and 400-days-ago events fall outside.
    expect(narrow.body.data.totals.activityDays).toBeLessThanOrEqual(2);

    const empty = await authedGet(app, `/api/projects/${projectB}/analytics`, cookieB).expect(200);
    // Domain counts are honest zeros; activity reflects only the setup
    // PROJECT_CREATED row — never fabricated learning data.
    expect(empty.body.data.totals).toMatchObject({
      materials: 0,
      quizAttempts: 0,
      assessments: 0,
      conceptsTracked: 0,
      recommendationsCreated: 0,
    });
    expect(empty.body.data.totals.averageAssessmentScore).toBeNull();
    expect(empty.body.data.masteryDistribution).toMatchObject({
      needsAttention: 0,
      unassessed: 0,
    });
    // Only setup rows (project creation) may appear — no learning data.
    const eventTypes = new Set(
      empty.body.data.recentActivity.map((e: { eventType: string }) => e.eventType)
    );
    expect(
      [...eventTypes].every((t) => ["PROJECT_CREATED", "SPACE_CREATED"].includes(t as string))
    ).toBe(true);
  });

  it("rejects inverted and overlong ranges with 400", async () => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - DAY).toISOString();
    await authedGet(
      app,
      `/api/projects/${projectA}/analytics?from=${now}&to=${past}`,
      cookieA
    ).expect(400);
    await authedGet(
      app,
      `/api/projects/${projectA}/analytics?from=${new Date(Date.now() - 400 * DAY).toISOString()}`,
      cookieA
    ).expect(400);
    await authedGet(app, `/api/projects/${projectA}/analytics?from=not-a-date`, cookieA).expect(
      400
    );
  });

  it("isolates project analytics across users", async () => {
    await seedProjectData();
    await authedGet(app, `/api/projects/${projectA}/analytics`, cookieB).expect(404);
    await authedGet(
      app,
      `/api/projects/00000000-0000-4000-8000-000000000000/analytics`,
      cookieA
    ).expect(404);
  });

  it("aggregates home analytics for the authenticated user only", async () => {
    await seedProjectData();
    const res = await authedGet(app, "/api/home/analytics", cookieA).expect(200);
    const data = res.body.data;
    expect(data.userId).toBe(userA);
    expect(data.totals).toMatchObject({
      spaces: 1,
      projects: 1,
      materialsReady: 2,
      tutorInteractions: 2,
      quizAttempts: 3,
      assessmentsCompleted: 2,
      recommendationsCompleted: 1,
      recommendationsPending: 1,
    });
    expect(data.totals.averageAssessmentScore).toBeCloseTo(0.8, 5);
    expect(data.totals.conceptsNeedingAttention).toBe(1);
    expect(data.recentActivity.length).toBeGreaterThan(0);

    const other = await authedGet(app, "/api/home/analytics", cookieB).expect(200);
    expect(other.body.data.totals).toMatchObject({
      spaces: 1,
      projects: 1,
      quizAttempts: 0,
      assessmentsCompleted: 0,
    });
    expect(other.body.data.totals.averageAssessmentScore).toBeNull();
  });
});
