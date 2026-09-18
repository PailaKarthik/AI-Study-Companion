import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash } from "node:crypto";
import { ChatError } from "@ai-study-companion/ai";
import type { ChatCompletionProvider } from "@ai-study-companion/ai";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedPost, registerCookie } from "./test/auth.js";
import { __setSearchEmbedderForTests } from "./services/searchService.js";
import { __setQuizChatForTests, createQuiz } from "./services/quizService.js";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic router stub: extraction / generation / grading payloads
 * chosen by prompt content, so the suite never touches a real LLM.
 */
function stubQuizChat(opts: { failGrader?: boolean } = {}): ChatCompletionProvider {
  // Generation call counter: each batch must produce novel prompts, or the
  // service's project-wide duplicate guard correctly refuses the quiz.
  let generationCalls = 0;
  return {
    name: "mock",
    model: "mock-quiz-v1",
    complete: async (input) => {
      const prompt = input.messages.map((m) => m.content).join("\n---\n");
      if (opts.failGrader && prompt.includes("strict but fair grader")) {
        throw new ChatError("grader down", { retryable: true, provider: "mock" });
      }
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
        const isMcq = prompt.includes("correctIndex");
        generationCalls += 1;
        const batch = generationCalls;
        const questions = Array.from({ length: Math.min(count, 20) }, (_, i) => {
          if (isMcq) {
            return {
              prompt: `What best describes ${concept}? (batch ${batch} Q${i + 1})`,
              options: [
                `${concept} converts energy correctly`,
                `${concept} is a type of rock formation`,
                `${concept} happens only in winter`,
                `${concept} was invented in 1999`,
              ],
              correctIndex: i % 4,
              explanation: `${concept} is described by the first-matching option per the evidence.`,
            };
          }
          return {
            prompt: `Explain ${concept} (batch ${batch} Q${i + 1}) and why it matters for the organism.`,
            keyPoints: [`Defines ${concept}`, `Applies ${concept} to survival`],
            explanation: `An ideal answer defines ${concept} and links it to survival.`,
          };
        });
        content = JSON.stringify({ questions });
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
                feedback:
                  "What was right: little. Missing: the core mechanism. Correction: review the direction of energy flow. Review: the first evidence source.",
                confidence: 0.9,
              }
            : {
                score: 0.8,
                correct: true,
                coveredConcepts: ["core mechanism"],
                missingConcepts: ["edge cases"],
                misconceptions: [],
                reasoningQuality: "GOOD",
                feedback:
                  "What was right: the core mechanism. Missing: edge cases. Correction: none major. Review: the second evidence source.",
                confidence: 0.85,
              }
        );
      } else {
        throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
      }
      return {
        content,
        model: "mock-quiz-v1",
        latencyMs: 1,
        inputTokens: 100,
        outputTokens: 50,
      };
    },
  };
}

describe.skipIf(!hasTestDb)("adaptive quiz API (isolated test DB)", () => {
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

  beforeEach(async () => {
    await resetTestDb();
    __setSearchEmbedderForTests(null);
    __setQuizChatForTests(stubQuizChat());
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
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createMcqQuiz(): Promise<{ quizId: string; attemptId: string }> {
    await seedKnowledge(projectA, userA);
    const quizId = (
      await request(app)
        .post(`/api/projects/${projectA}/quizzes`)
        .set("Cookie", cookieA)
        .send({ questionCount: 3, typePreference: "MCQ" })
        .expect(201)
    ).body.data.id as string;
    const attemptId = (
      await request(app)
        .post(`/api/quizzes/${quizId}/attempts`)
        .set("Cookie", cookieA)
        .send({})
        .expect(200)
    ).body.data.id as string;
    return { quizId, attemptId };
  }

  it("rejects unauthenticated quiz access with 401", async () => {
    await request(app).get(`/api/projects/${projectA}/quizzes`).expect(401);
    await request(app)
      .post(`/api/projects/${projectA}/quizzes`)
      .send({ questionCount: 2 })
      .expect(401);
  });

  it("validates creation input and response shape", async () => {
    const post = (body: Record<string, unknown>) =>
      request(app).post(`/api/projects/${projectA}/quizzes`).set("Cookie", cookieA).send(body);
    await post({ questionCount: 0 }).expect(400);
    await post({ questionCount: 21 }).expect(400);
    await post({ questionCount: 2, mode: "NOPE" }).expect(400);
    await post({ questionCount: 2, model: "evil" }).expect(400);
    await post({ questionCount: 2, mode: "CONCEPT_FOCUS" }).expect(400);
    await post({ questionCount: 2, mode: "CONCEPT_FOCUS", conceptIds: ["nope"] }).expect(400);

    await seedKnowledge(projectA, userA);
    const { attemptId } = await createMcqQuiz();
    const attempt = (
      await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieA).expect(200)
    ).body.data;
    const questionId = attempt.questions[0].id as string;
    const bad = (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/quiz-attempts/${attemptId}/responses`)
        .set("Cookie", cookieA)
        .send(body);
    await bad({ questionId, selectedOption: "a", responseText: "b" }).expect(400);
    await bad({ questionId }).expect(400);
    await bad({ questionId: "nope", selectedOption: "a" }).expect(400);
  });

  it("404s unknown and foreign projects identically", async () => {
    const missing = await request(app)
      .get("/api/projects/00000000-0000-4000-8000-000000000000/quizzes")
      .set("Cookie", cookieB)
      .expect(404);
    const foreign = await request(app)
      .get(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieB)
      .expect(404);
    expect(foreign.body.error).toEqual(missing.body.error);
  });

  it("refuses generation on an empty corpus instead of an empty quiz", async () => {
    const res = await request(app)
      .post(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieA)
      .send({ questionCount: 4 })
      .expect(400);
    expect(res.body.error.message).toMatch(/no indexed materials/i);
  });

  it("creates, lists, and serves a sanitized adaptive quiz", async () => {
    await seedKnowledge(projectA, userA);
    const created = await request(app)
      .post(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieA)
      .send({ questionCount: 4 })
      .expect(201);
    expect(created.body.data.questions).toHaveLength(4);
    expect(created.body.data.mode).toBe("ADAPTIVE");
    const types = new Set(created.body.data.questions.map((q: { type: string }) => q.type));
    expect(types.size).toBe(2);
    const raw = JSON.stringify(created.body);
    expect(raw).not.toContain("correctAnswer");
    expect(raw).not.toContain("keyPoints");

    const list = await request(app)
      .get(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: created.body.data.id,
      status: "PUBLISHED",
      questionCount: 4,
      attemptCount: 0,
      latestAttempt: null,
    });
    expect(list.body.data[0]).not.toHaveProperty("questions");

    const detail = await request(app)
      .get(`/api/quizzes/${created.body.data.id}`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain("correctAnswer");
  });

  it.each([5, 10, 15])("creates exactly %i questions when requested", async (count) => {
    await seedKnowledge(projectA, userA);
    const created = await request(app)
      .post(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieA)
      .send({ questionCount: count })
      .expect(201);
    // Only 2 concepts exist in the stub corpus — repetition must fill the
    // gap rather than silently shrinking the quiz (the old per-concept cap
    // returned 6 for a 10-question request here).
    expect(created.body.data.questions).toHaveLength(count);
    expect(created.body.data).toMatchObject({
      requestedCount: count,
      generatedCount: count,
    });

    const list = await request(app)
      .get(`/api/projects/${projectA}/quizzes`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(list.body.data[0]).toMatchObject({ questionCount: count });

    // Prompts stay unique: refill must generate novel questions, never dupes.
    const prompts = created.body.data.questions.map((q: { prompt: string }) => q.prompt);
    expect(new Set(prompts).size).toBe(count);
  });

  it("rejects out-of-range question counts", async () => {
    await seedKnowledge(projectA, userA);
    for (const bad of [0, -3, 21, 100, "ten", null]) {
      await request(app)
        .post(`/api/projects/${projectA}/quizzes`)
        .set("Cookie", cookieA)
        .send({ questionCount: bad })
        .expect(400);
    }
  });

  it("runs the MCQ lifecycle: answer, duplicates, resume, complete", async () => {
    const { quizId, attemptId } = await createMcqQuiz();
    const db = getTestPrisma();

    const attempt = (
      await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieA).expect(200)
    ).body.data;
    expect(attempt).toMatchObject({ status: "ACTIVE", questionCount: 3, answeredCount: 0 });
    // Unanswered questions carry no keys or explanations.
    expect(JSON.stringify(attempt)).not.toContain("correctAnswer");

    const rows = await db.quizQuestion.findMany({
      where: { quizId },
      orderBy: { order: "asc" },
      select: { id: true, options: true, correctAnswer: true },
    });
    const [first, second, third] = rows;
    if (!first || !second || !third) throw new Error("expected 3 questions");

    const answer = (questionId: string, body: Record<string, unknown>) =>
      request(app)
        .post(`/api/quiz-attempts/${attemptId}/responses`)
        .set("Cookie", cookieA)
        .send({ questionId, ...body });

    // Correct MCQ: deterministic evaluation, feedback joins post-answer.
    const correct = await answer(first.id, { selectedOption: first.correctAnswer }).expect(200);
    expect(correct.body.data).toMatchObject({ answered: true, isCorrect: true, score: 1 });
    expect(correct.body.data.explanation).toBeTruthy();

    // Incorrect MCQ.
    const options = (second.options as string[]).filter((o) => o !== second.correctAnswer);
    const wrong = await answer(second.id, { selectedOption: options[0] }).expect(200);
    expect(wrong.body.data).toMatchObject({ answered: true, isCorrect: false, score: 0 });

    // Invalid option rejected (server checks against stored options).
    await answer(third.id, { selectedOption: "not a real option" }).expect(400);
    // Wrong payload shape for the stored type rejected.
    await answer(third.id, { responseText: "essay?" }).expect(400);

    // Identical resubmission is idempotent; changed answers conflict.
    await answer(first.id, { selectedOption: first.correctAnswer }).expect(200);
    const firstAlternatives = (first.options as string[]).filter((o) => o !== first.correctAnswer);
    await answer(first.id, { selectedOption: firstAlternatives[0] }).expect(409);

    // Finishing the set then completing scores deterministically.
    await answer(third.id, { selectedOption: third.correctAnswer }).expect(200);
    const resumed = (
      await request(app)
        .post(`/api/quizzes/${quizId}/attempts`)
        .set("Cookie", cookieA)
        .send({})
        .expect(200)
    ).body.data;
    expect(resumed.id).toBe(attemptId);

    const result = (
      await request(app)
        .post(`/api/quiz-attempts/${attemptId}/complete`)
        .set("Cookie", cookieA)
        .expect(200)
    ).body.data;
    expect(result).toMatchObject({
      quizId,
      score: 2,
      maxScore: 3,
      correctCount: 2,
      incorrectCount: 1,
      openEndedCount: 0,
    });
    expect(result.conceptPerformance.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("mastery");

    // Assessment records exist for every MCQ response.
    expect(await db.assessment.count({ where: { attemptId } })).toBe(3);

    // Closed attempts reject further answers; completion is idempotent.
    await answer(first.id, { selectedOption: first.correctAnswer }).expect(409);
    const again = (
      await request(app)
        .post(`/api/quiz-attempts/${attemptId}/complete`)
        .set("Cookie", cookieA)
        .expect(200)
    ).body.data;
    expect(again.score).toBe(2);

    const closed = (
      await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieA).expect(200)
    ).body.data;
    expect(closed.status).toBe("COMPLETED");
  });

  it("rejects completion while questions are unanswered", async () => {
    const { attemptId } = await createMcqQuiz();
    const res = await request(app)
      .post(`/api/quiz-attempts/${attemptId}/complete`)
      .set("Cookie", cookieA)
      .expect(409);
    expect(res.body.error.details).toHaveProperty("missingQuestionIds");
  });

  it("evaluates open-ended answers with structured feedback and source refs", async () => {
    await seedKnowledge(projectA, userA);
    const quizId = (
      await request(app)
        .post(`/api/projects/${projectA}/quizzes`)
        .set("Cookie", cookieA)
        .send({ questionCount: 2, typePreference: "OPEN_ENDED" })
        .expect(201)
    ).body.data.id as string;
    const attemptId = (
      await request(app)
        .post(`/api/quizzes/${quizId}/attempts`)
        .set("Cookie", cookieA)
        .send({})
        .expect(200)
    ).body.data.id as string;
    const attempt = (
      await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieA).expect(200)
    ).body.data;
    expect(attempt.questions.every((q: { type: string }) => q.type === "OPEN_ENDED")).toBe(true);

    const [q1, q2] = attempt.questions as { id: string }[];
    if (!q1 || !q2) throw new Error("expected 2 questions");
    const submit = (questionId: string, responseText: string) =>
      request(app)
        .post(`/api/quiz-attempts/${attemptId}/responses`)
        .set("Cookie", cookieA)
        .send({ questionId, responseText });

    const good = await submit(
      q1.id,
      "Photosynthesis converts light into energy in chloroplasts."
    ).expect(200);
    expect(good.body.data).toMatchObject({
      answered: true,
      isCorrect: true,
      score: 0.8,
      evaluationState: "EVALUATED",
    });
    expect(good.body.data.feedback).toMatch(/What was right/);

    const bad = await submit(q2.id, "Something completely wrong here.").expect(200);
    expect(bad.body.data).toMatchObject({ isCorrect: false, score: 0.2 });

    const db = getTestPrisma();
    const graded = await db.assessment.findMany({ where: { attemptId } });
    expect(graded).toHaveLength(2);
    expect(graded[0]?.coveredConcepts).toContain("core mechanism");

    const result = (
      await request(app)
        .post(`/api/quiz-attempts/${attemptId}/complete`)
        .set("Cookie", cookieA)
        .expect(200)
    ).body.data;
    expect(result).toMatchObject({ openEndedCount: 2, maxScore: 2 });
    expect(result.score).toBeCloseTo(1.0);
    expect(result.openEndedReviews).toHaveLength(2);
    expect(result.openEndedReviews[0].sourceRefs[0]).toMatch(/bio\.pdf/);
    expect(result.openEndedReviews[0]).toHaveProperty("misconceptions");
    expect(result.weakAreas.length + result.strengths.length).toBeGreaterThanOrEqual(0);
  });

  it("keeps answers on evaluation failure and retries on resubmission", async () => {
    __setQuizChatForTests(stubQuizChat({ failGrader: true }));
    await seedKnowledge(projectA, userA);
    const quizId = (
      await request(app)
        .post(`/api/projects/${projectA}/quizzes`)
        .set("Cookie", cookieA)
        .send({ questionCount: 1, typePreference: "OPEN_ENDED" })
        .expect(201)
    ).body.data.id as string;
    const attemptId = (
      await request(app)
        .post(`/api/quizzes/${quizId}/attempts`)
        .set("Cookie", cookieA)
        .send({})
        .expect(200)
    ).body.data.id as string;
    const questionId = (
      await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieA).expect(200)
    ).body.data.questions[0].id as string;

    const failed = await request(app)
      .post(`/api/quiz-attempts/${attemptId}/responses`)
      .set("Cookie", cookieA)
      .send({ questionId, responseText: "My saved answer." })
      .expect(200);
    expect(failed.body.data.evaluationState).toBe("EVALUATION_FAILED");
    expect(failed.body.data.responseText).toBe("My saved answer.");

    // Identical resubmission retries the evaluation — the answer is not lost.
    __setQuizChatForTests(stubQuizChat());
    const retried = await request(app)
      .post(`/api/quiz-attempts/${attemptId}/responses`)
      .set("Cookie", cookieA)
      .send({ questionId, responseText: "My saved answer." })
      .expect(200);
    expect(retried.body.data.evaluationState).toBe("EVALUATED");
    expect(retried.body.data.score).toBe(0.8);
  });

  it("rejects questions that belong to another quiz", async () => {
    const first = await createMcqQuiz();
    const second = await createMcqQuiz();
    const db = getTestPrisma();
    const foreign = await db.quizQuestion.findFirstOrThrow({
      where: { quizId: second.quizId },
      select: { id: true, options: true },
    });
    await request(app)
      .post(`/api/quiz-attempts/${first.attemptId}/responses`)
      .set("Cookie", cookieA)
      .send({ questionId: foreign.id, selectedOption: (foreign.options as string[])[0] })
      .expect(404);
  });

  it("isolates users: no cross-read, start, submit, or complete", async () => {
    const { quizId, attemptId } = await createMcqQuiz();
    const db = getTestPrisma();
    const questionId = (
      await db.quizQuestion.findFirstOrThrow({ where: { quizId }, select: { id: true } })
    ).id;

    await request(app).get(`/api/quizzes/${quizId}`).set("Cookie", cookieB).expect(404);
    await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Cookie", cookieB)
      .send({})
      .expect(404);
    await request(app).get(`/api/quiz-attempts/${attemptId}`).set("Cookie", cookieB).expect(404);
    await request(app)
      .post(`/api/quiz-attempts/${attemptId}/responses`)
      .set("Cookie", cookieB)
      .send({ questionId, selectedOption: "x" })
      .expect(404);
    await request(app)
      .post(`/api/quiz-attempts/${attemptId}/complete`)
      .set("Cookie", cookieB)
      .expect(404);
    // Direct id manipulation on the other project also 404s.
    await request(app)
      .post(`/api/projects/${projectB}/quizzes`)
      .set("Cookie", cookieA)
      .send({ questionCount: 1 })
      .expect(404);
  });

  it("returns 503 without a chat provider (service-level, keyless path)", async () => {
    await seedKnowledge(projectA, userA);
    await expect(
      createQuiz(
        userA,
        projectA,
        { questionCount: 2, mode: "ADAPTIVE" },
        { db: getTestPrisma(), chat: null }
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
