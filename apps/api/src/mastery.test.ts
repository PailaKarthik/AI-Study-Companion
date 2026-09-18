import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash } from "node:crypto";
import type { ChatCompletionProvider } from "@ai-study-companion/ai";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";
import { __setSearchEmbedderForTests } from "./services/searchService.js";
import { __setQuizChatForTests } from "./services/quizService.js";
import { __setTutorChatForTests } from "./services/tutorService.js";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Deterministic quiz-LLM stub (extraction / generation / grading). */
function stubQuizChat(): ChatCompletionProvider {
  let generationCalls = 0;
  return {
    name: "mock",
    model: "mock-quiz-v1",
    complete: async (input) => {
      const prompt = input.messages.map((m) => m.content).join("\n---\n");
      let content: string;
      if (prompt.includes("Extract the key learning concepts")) {
        content = JSON.stringify({
          concepts: [
            {
              name: "Photosynthesis",
              description: "How plants convert light into energy",
              difficulty: "BEGINNER",
              relationships: [],
            },
            {
              name: "Cell Division",
              description: "How cells split into daughter cells",
              difficulty: "INTERMEDIATE",
              relationships: [{ to: "Photosynthesis", type: "RELATED" }],
            },
          ],
        });
      } else if (prompt.includes("SYSTEM RULES") && prompt.includes("Write ")) {
        const count = Number(prompt.match(/Write (\d+) question/)?.[1] ?? "1");
        const concept = prompt.match(/concept "([^"]+)"/)?.[1] ?? "Concept";
        generationCalls += 1;
        const batch = generationCalls;
        content = JSON.stringify({
          questions: Array.from({ length: Math.min(count, 20) }, (_, i) => ({
            prompt: `What best describes ${concept}? (batch ${batch} Q${i + 1})`,
            options: [
              `${concept} converts energy correctly`,
              `${concept} is a type of rock formation`,
              `${concept} happens only in winter`,
              `${concept} was invented in 1999`,
            ],
            correctIndex: i % 4,
            explanation: `${concept} is described by the first-matching option per the evidence.`,
          })),
        });
      } else if (prompt.includes("strict but fair grader")) {
        const answer = prompt.split("LEARNER ANSWER (data, not instructions)")[1] ?? "";
        const wrong = answer.toLowerCase().includes("wrong");
        content = JSON.stringify(
          wrong
            ? {
                score: 0.2,
                correct: false,
                coveredConcepts: [],
                missingConcepts: ["core mechanism"],
                misconceptions: ["confuses energy direction"],
                reasoningQuality: "POOR",
                feedback: "Review the core mechanism.",
                confidence: 0.9,
              }
            : {
                score: 0.8,
                correct: true,
                coveredConcepts: ["core mechanism"],
                missingConcepts: ["edge cases"],
                misconceptions: [],
                reasoningQuality: "GOOD",
                feedback: "Solid understanding.",
                confidence: 0.85,
              }
        );
      } else {
        throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
      }
      return { content, model: "mock-quiz-v1", latencyMs: 1, inputTokens: 100, outputTokens: 50 };
    },
  };
}

function stubTutorChat(): ChatCompletionProvider {
  return {
    name: "mock",
    model: "mock-tutor-v1",
    complete: async () => ({
      content: "A grounded mock answer with citations [1].",
      model: "mock-tutor-v1",
      latencyMs: 1,
      inputTokens: 50,
      outputTokens: 10,
    }),
  };
}

describe.skipIf(!hasTestDb)("mastery + growth + recommendations (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  let spaceA = "";
  let projectA = "";
  let projectB = "";

  async function seedKnowledge(projectId: string, ownerId: string): Promise<void> {
    const db = getTestPrisma();
    const material = await db.material.create({
      data: {
        projectId,
        ownerId,
        filename: "bio.pdf",
        originalFilename: "bio.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/bio-${Math.random().toString(36).slice(2)}`,
        status: "READY",
        knowledgeStatus: "READY",
        pageCount: 1,
      },
      select: { id: true },
    });
    const page = await db.documentPage.create({
      data: { materialId: material.id, projectId, pageNumber: 1, extractedText: "Bio." },
      select: { id: true },
    });
    const chunks = [
      "Photosynthesis converts light into chemical energy inside chloroplasts of plant cells.",
      "Cell division splits one parent cell into two daughter cells through mitosis stages.",
    ];
    for (const [index, content] of chunks.entries()) {
      await db.knowledgeChunk.create({
        data: {
          projectId,
          materialId: material.id,
          pageId: page.id,
          pageNumber: 1,
          chunkIndex: index,
          content,
          tokenCount: Math.ceil(content.length / 4),
          contentHash: sha(content),
          metadata: { pageNumber: 1, chunkIndex: index, sourceType: "pdf" },
        },
      });
    }
  }

  /** Full MCQ quiz cycle through the real API; `wrong` answers everything incorrectly. */
  async function runMcqQuiz(wrong: boolean): Promise<{ quizId: string; attemptId: string }> {
    await seedKnowledge(projectA, userA);
    const quizId = (
      await authedPost(app, `/api/projects/${projectA}/quizzes`, cookieA, {
        questionCount: 3,
        typePreference: "MCQ",
      }).expect(201)
    ).body.data.id as string;
    const attemptId = (
      await authedPost(app, `/api/quizzes/${quizId}/attempts`, cookieA, {}).expect(200)
    ).body.data.id as string;
    const db = getTestPrisma();
    const questions = await db.quizQuestion.findMany({
      where: { quizId },
      orderBy: { order: "asc" },
      select: { id: true, options: true, correctAnswer: true },
    });
    for (const q of questions) {
      const options = (q.options ?? []) as string[];
      const choice = wrong
        ? options.find((o) => o !== q.correctAnswer) ?? options[0] ?? ""
        : (q.correctAnswer as string);
      await authedPost(app, `/api/quiz-attempts/${attemptId}/responses`, cookieA, {
        questionId: q.id,
        selectedOption: choice,
      }).expect(200);
    }
    await authedPost(app, `/api/quiz-attempts/${attemptId}/complete`, cookieA, {}).expect(200);
    return { quizId, attemptId };
  }

  beforeEach(async () => {
    await resetTestDb();
    __setSearchEmbedderForTests(null);
    __setQuizChatForTests(stubQuizChat());
    __setTutorChatForTests(stubTutorChat());
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
    const db = getTestPrisma();
    userA = (await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).id;
    spaceA = (await authedPost(app, "/api/spaces", cookieA, { name: "Space A" }).expect(201)).body
      .data.id as string;
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

  afterEach(() => {
    __setSearchEmbedderForTests(undefined);
    __setQuizChatForTests(undefined);
    __setTutorChatForTests(undefined);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("runs the full loop: quiz → mastery → growth → recommendation", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(false);

    const mastery = await db.conceptMastery.findMany({ where: { userId: userA, projectId: projectA } });
    expect(mastery.length).toBeGreaterThan(0);
    for (const row of mastery) {
      expect(row.masteryScore).toBeGreaterThanOrEqual(0);
      expect(row.masteryScore).toBeLessThanOrEqual(1);
      expect(row.evidenceCount).toBeGreaterThan(0);
    }

    const events = await db.masteryEvent.findMany({ where: { userId: userA, projectId: projectA } });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.previousScore).toBeNull();
      expect(event.delta).toBeGreaterThan(0);
      expect(["QUIZ", "OPEN_ENDED_ASSESSMENT"]).toContain(event.sourceType);
      expect(event.sourceId).toBeTruthy();
    }

    const activities = await db.activityEvent.findMany({
      where: { userId: userA, projectId: projectA, eventType: "MASTERY_UPDATED" },
    });
    expect(activities.length).toBe(1);

    const growth = (
      await authedGet(app, `/api/projects/${projectA}/growth`, cookieA).expect(200)
    ).body.data;
    expect(growth.projectId).toBe(projectA);
    expect(growth.totalConcepts).toBe(2);
    expect(growth.assessedConcepts).toBeGreaterThan(0);
    expect(growth.averageMastery).toBeGreaterThan(0);
    // One event per concept → honestly insufficient for a trend.
    expect(growth.insufficientData.length).toBeGreaterThan(0);
    expect(growth.improving).toEqual([]);
    expect(growth.stable).toEqual([]);

    const recs = (
      await authedGet(app, `/api/projects/${projectA}/recommendations`, cookieA).expect(200)
    ).body.data;
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.reason).toBeTruthy();
      expect(rec.action).toMatchObject({ kind: expect.any(String), label: expect.any(String) });
    }

    const overview = (
      await authedGet(app, `/api/projects/${projectA}/overview`, cookieA).expect(200)
    ).body.data;
    expect(overview.mastery.average).toBeGreaterThan(0);
    expect(overview.growth).toMatchObject({ insufficientData: expect.any(Number) });
    expect(Array.isArray(overview.attentionConcepts)).toBe(true);
  });

  it("is idempotent across re-completion (no duplicate mastery events)", async () => {
    const db = getTestPrisma();
    const { attemptId } = await runMcqQuiz(false);
    const before = await db.masteryEvent.count({ where: { userId: userA, projectId: projectA } });
    expect(before).toBeGreaterThan(0);
    // Second completion reconciles without double-counting.
    await authedPost(app, `/api/quiz-attempts/${attemptId}/complete`, cookieA, {}).expect(200);
    const after = await db.masteryEvent.count({ where: { userId: userA, projectId: projectA } });
    expect(after).toBe(before);
  });

  it("classifies trends from real event history", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(false);
    const growth = (
      await authedGet(app, `/api/projects/${projectA}/growth`, cookieA).expect(200)
    ).body.data;
    expect(growth.assessedConcepts).toBe(2);

    // Deterministic trend shapes on dedicated concepts (exact histories).
    const rising = await db.concept.create({ data: { projectId: projectA, name: "Rising" } });
    const flat = await db.concept.create({ data: { projectId: projectA, name: "Flat" } });
    const now = Date.now();
    const shapes: { conceptId: string; scores: number[] }[] = [
      { conceptId: rising.id, scores: [0.42, 0.48, 0.56, 0.63] },
      { conceptId: flat.id, scores: [0.7, 0.72, 0.71, 0.73] },
    ];
    for (const shape of shapes) {
      for (const [i, score] of shape.scores.entries()) {
        await db.masteryEvent.create({
          data: {
            userId: userA,
            projectId: projectA,
            conceptId: shape.conceptId,
            sourceType: "QUIZ",
            sourceId: `trend-seed-${shape.conceptId}-${i}`,
            previousScore: i === 0 ? null : shape.scores[i - 1] ?? null,
            newScore: score,
            delta: i === 0 ? null : score - (shape.scores[i - 1] ?? score),
            confidence: 0.5,
            createdAt: new Date(now + i * 1000),
          },
        });
      }
    }
    const shaped = (
      await authedGet(app, `/api/projects/${projectA}/growth`, cookieA).expect(200)
    ).body.data;
    const byName = new Map(
      shaped.concepts.map((c: { conceptName: string; trend: string }) => [c.conceptName, c.trend])
    );
    expect(byName.get("Rising")).toBe("IMPROVING");
    expect(byName.get("Flat")).toBe("STABLE");
  });

  it("records repeated mistakes in learner context (multi-attempt only)", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(true);
    await runMcqQuiz(true);
    await runMcqQuiz(true);
    const rows = await db.learnerContext.findMany({
      where: { userId: userA, projectId: projectA, type: "REPEATED_MISTAKE" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.content).toContain("recurring difficulty");
      const meta = row.metadata as { incorrectCount: number; attemptCount: number };
      expect(meta.incorrectCount).toBeGreaterThanOrEqual(3);
      expect(meta.attemptCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("expires stale rows and completes mastered goals on refresh", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(false);
    const concept = await db.concept.findFirstOrThrow({ where: { projectId: projectA } });
    await db.conceptMastery.upsert({
      where: { userId_projectId_conceptId: { userId: userA, projectId: projectA, conceptId: concept.id } },
      update: { masteryScore: 0.92, confidence: 0.8, evidenceCount: 6 },
      create: {
        userId: userA, projectId: projectA, conceptId: concept.id,
        masteryScore: 0.92, confidence: 0.8, evidenceCount: 6,
      },
    });
    const staleReview = await db.recommendation.create({
      data: {
        userId: userA, projectId: projectA, conceptId: concept.id,
        type: "REVIEW", title: "Review X", priority: "HIGH", status: "PENDING",
      },
      select: { id: true },
    });
    // A REVIEW row for a merely-developing concept is superseded: the
    // engine now prescribes PRACTICE, so the stale REVIEW expires.
    const mid = await db.concept.create({ data: { projectId: projectA, name: "Mid" } });
    await db.conceptMastery.create({
      data: {
        userId: userA, projectId: projectA, conceptId: mid.id,
        masteryScore: 0.5, confidence: 0.5, evidenceCount: 3,
      },
    });
    const stalePractice = await db.recommendation.create({
      data: {
        userId: userA, projectId: projectA, conceptId: mid.id,
        type: "REVIEW", title: "Review Mid", priority: "HIGH", status: "PENDING",
      },
      select: { id: true },
    });

    await authedPost(app, `/api/projects/${projectA}/recommendations/refresh`, cookieA, {}).expect(200);

    const review = await db.recommendation.findUniqueOrThrow({ where: { id: staleReview.id } });
    // Mastered goal → COMPLETED (achieved), superseded row → EXPIRED.
    expect(review.status).toBe("COMPLETED");
    expect(review.completedAt).not.toBeNull();
    const superseded = await db.recommendation.findUniqueOrThrow({ where: { id: stalePractice.id } });
    expect(superseded.status).toBe("EXPIRED");
  });

  it("never duplicates pending recommendations across refreshes", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(true);
    const first = (
      await authedPost(app, `/api/projects/${projectA}/recommendations/refresh`, cookieA, {}).expect(200)
    ).body.data as { id: string; type: string; conceptId: string | null }[];
    const second = (
      await authedPost(app, `/api/projects/${projectA}/recommendations/refresh`, cookieA, {}).expect(200)
    ).body.data as { id: string; type: string; conceptId: string | null }[];
    const keys = (rows: typeof first) => rows.map((r) => `${r.type}::${r.conceptId ?? ""}`);
    expect(keys(second).sort()).toEqual(keys(first).sort());
    const pending = await db.recommendation.findMany({
      where: { userId: userA, projectId: projectA, status: "PENDING" },
    });
    const seen = new Set<string>();
    for (const row of pending) {
      const key = `${row.type}::${row.conceptId ?? ""}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("drives tutor engagement markers without moving scores", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(false);
    const before = await db.conceptMastery.findMany({ where: { userId: userA, projectId: projectA } });
    const beforeById = new Map(before.map((m) => [m.conceptId, m.masteryScore]));

    await authedPost(app, `/api/projects/${projectA}/tutor/ask`, cookieA, {
      message: "photosynthesis light energy",
    }).expect(200);

    const markers = await db.masteryEvent.findMany({
      where: { userId: userA, projectId: projectA, sourceType: "TUTOR_INTERACTION" },
    });
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.delta).toBe(0);
      expect(marker.previousScore).toBe(marker.newScore);
    }
    const after = await db.conceptMastery.findMany({ where: { userId: userA, projectId: projectA } });
    for (const row of after) {
      expect(row.masteryScore).toBe(beforeById.get(row.conceptId) ?? 0);
    }
  });

  it("serves concept detail with history, evidence, and mistakes", async () => {
    await runMcqQuiz(true);
    const db = getTestPrisma();
    const concept = await db.concept.findFirstOrThrow({ where: { projectId: projectA } });
    const detail = (
      await authedGet(app, `/api/projects/${projectA}/concepts/${concept.id}`, cookieA).expect(200)
    ).body.data;
    expect(detail.concept).toMatchObject({ id: concept.id, name: concept.name });
    expect(detail.mastery).not.toBeNull();
    expect(detail.mastery.status).toBe("NEEDS_ATTENTION");
    expect(detail.history.length).toBeGreaterThan(0);
    expect(detail.mistakes.length).toBeGreaterThan(0);
    expect(detail.mistakes[0]).toMatchObject({ quizId: expect.any(String) });
    expect(Array.isArray(detail.recommendations)).toBe(true);
  });

  it("reports honest empty states without fabricating progress", async () => {
    const empty = (
      await authedGet(app, `/api/projects/${projectB}/growth`, cookieB).expect(200)
    ).body.data;
    expect(empty).toMatchObject({
      projectId: projectB,
      concepts: [],
      averageMastery: null,
      assessedConcepts: 0,
      totalConcepts: 0,
    });

    // Concepts exist but nothing assessed → INSUFFICIENT_DATA everywhere.
    const db = getTestPrisma();
    await db.concept.create({ data: { projectId: projectB, name: "Untouched" } });
    const unassessed = (
      await authedGet(app, `/api/projects/${projectB}/growth`, cookieB).expect(200)
    ).body.data;
    expect(unassessed.insufficientData).toHaveLength(1);
    expect(unassessed.averageMastery).toBeNull();

    const home = (await authedGet(app, "/api/home", cookieB).expect(200)).body.data;
    expect(home.nextAction).toBeNull();
  });

  it("runs the recommendation lifecycle with 409 on double transitions", async () => {
    await runMcqQuiz(true);
    const db = getTestPrisma();
    const rec = await db.recommendation.findFirstOrThrow({
      where: { userId: userA, projectId: projectA, status: "PENDING" },
      select: { id: true },
    });
    await request(app).post(`/api/recommendations/${rec.id}/complete`).set("Cookie", cookieA).expect(200);
    await request(app).post(`/api/recommendations/${rec.id}/complete`).set("Cookie", cookieA).expect(409);

    const other = await db.recommendation.findFirstOrThrow({
      where: { userId: userA, projectId: projectA, status: "PENDING", id: { not: rec.id } },
      select: { id: true },
    });
    await request(app).post(`/api/recommendations/${other.id}/dismiss`).set("Cookie", cookieA).expect(200);
    await request(app).post(`/api/recommendations/${other.id}/dismiss`).set("Cookie", cookieA).expect(409);

    const dismissed = await db.recommendation.findUniqueOrThrow({ where: { id: other.id } });
    expect(dismissed.status).toBe("DISMISSED");
    const events = await db.activityEvent.findMany({
      where: { userId: userA, projectId: projectA, eventType: "RECOMMENDATION_DISMISSED" },
    });
    expect(events.length).toBe(1);
  });

  it("isolates users across growth, concepts, and recommendations", async () => {
    const db = getTestPrisma();
    await runMcqQuiz(false);
    const concept = await db.concept.findFirstOrThrow({ where: { projectId: projectA } });
    const rec = await db.recommendation.findFirstOrThrow({
      where: { userId: userA, projectId: projectA, status: "PENDING" },
      select: { id: true },
    });

    await authedGet(app, `/api/projects/${projectA}/growth`, cookieB).expect(404);
    await authedGet(app, `/api/projects/${projectA}/concepts/${concept.id}`, cookieB).expect(404);
    await authedGet(app, `/api/projects/${projectA}/recommendations`, cookieB).expect(404);
    await authedPost(app, `/api/projects/${projectA}/recommendations/refresh`, cookieB, {}).expect(404);
    await request(app).post(`/api/recommendations/${rec.id}/complete`).set("Cookie", cookieB).expect(404);
    await request(app).post(`/api/recommendations/${rec.id}/dismiss`).set("Cookie", cookieB).expect(404);

    // Foreign concept via own project path → 404, not another user's data.
    const foreign = await db.concept.create({ data: { projectId: projectB, name: "Foreign" } });
    await authedGet(app, `/api/projects/${projectA}/concepts/${foreign.id}`, cookieA).expect(404);

    // B's own project is clean and empty.
    const bRecs = (
      await authedGet(app, `/api/projects/${projectB}/recommendations`, cookieB).expect(200)
    ).body.data;
    expect(bRecs).toEqual([]);
  });

  it("rejects malformed ids with 400", async () => {
    await authedGet(app, "/api/projects/not-a-uuid/growth", cookieA).expect(400);
    await authedGet(app, `/api/projects/${projectA}/concepts/not-a-uuid`, cookieA).expect(400);
    await request(app).post("/api/recommendations/not-a-uuid/complete").set("Cookie", cookieA).expect(400);
  });
});
