import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash, randomBytes } from "node:crypto";
import { MockChatProvider, type ChatCompletionProvider } from "@ai-study-companion/ai";
import { createApp } from "./app.js";
import { fromPrismaError } from "./middleware/errorHandler.js";
import { scrubSentryEvent } from "./lib/sentry.js";
import { withTimeout } from "./lib/withTimeout.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";
import { generateSessionToken, hashSessionToken } from "./services/sessionToken.js";
import { __setSearchEmbedderForTests } from "./services/searchService.js";
import { __setTutorChatForTests } from "./services/tutorService.js";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const PASSWORD = "test-password-123";

/**
 * Production-readiness regression suite (Prompt 12 hardening):
 * security headers/CORS/CSRF/request-id, Prisma error mapping, Sentry
 * scrubbing, session lifecycle, per-email throttling, timeout statuses,
 * and concurrent-request safety. Real app + isolated test DB throughout.
 */
describe.skipIf(!hasTestDb)("hardening", () => {
  let app: Express;
  let cookieA: string;
  let cookieB: string;
  let userA: string;
  let spaceA: string;
  let projectA: string;

  beforeEach(async () => {
    await resetTestDb();
    __setSearchEmbedderForTests(null);
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
  });

  afterEach(async () => {
    __setSearchEmbedderForTests(undefined);
    __setTutorChatForTests(undefined);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  // -----------------------------------------------------------------------
  // Security headers / CORS / CSRF / request-id / 404
  // -----------------------------------------------------------------------

  it("sets JSON-API security headers and hides the stack", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("echoes configured CORS origins and omits unknown ones", async () => {
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const denied = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects cross-origin mutations (CSRF) but allows originless clients", async () => {
    const forged = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "a@example.com", password: PASSWORD });
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe("FORBIDDEN");

    // curl-style clients send no Origin and pass through to normal auth.
    const direct = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "wrong-password" });
    expect(direct.status).toBe(401);
  });

  it("replaces invalid x-request-id instead of reflecting it", async () => {
    const evil = '"><script>alert(1)</script>';
    const replaced = await request(app).get("/health").set("x-request-id", evil);
    const echoed = replaced.headers["x-request-id"] as string;
    expect(echoed).toBeDefined();
    expect(echoed).not.toBe(evil);
    expect(echoed.length).toBeLessThanOrEqual(128);

    const valid = await request(app).get("/health").set("x-request-id", "test-id-123");
    expect(valid.headers["x-request-id"]).toBe("test-id-123");
  });

  it("returns a generic 404 that never reflects the path", async () => {
    const res = await request(app).get("/api/definitely-not-here/<script>").expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain("definitely-not-here");
  });

  it("maps Prisma codes to safe client errors (unit)", () => {
    expect(fromPrismaError({ code: "P2002" })).toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
    expect(fromPrismaError({ code: "P2025" })).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(fromPrismaError({ code: "P2003" })).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(fromPrismaError({ code: "P9999" })).toBeNull();
    expect(fromPrismaError(new Error("boom"))).toBeNull();
    expect(fromPrismaError(null)).toBeNull();
  });

  it("scrubs auth material from Sentry events (unit)", () => {
    const scrubbed = scrubSentryEvent({
      request: {
        headers: {
          authorization: "Bearer secret",
          cookie: "asc_session=secret",
          "content-type": "application/json",
        },
        cookies: { asc_session: "secret" },
      },
      user: { id: "u1", email: "a@example.com" },
    });
    expect(scrubbed).toBeDefined();
    const headers = (scrubbed?.request?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["content-type"]).toBe("[present]");
    expect(scrubbed?.request).not.toHaveProperty("cookies");
    expect(scrubbed?.user).toEqual({ id: "u1" });
  });

  // -----------------------------------------------------------------------
  // Sessions
  // -----------------------------------------------------------------------

  it("rejects expired sessions and revokes them on sight", async () => {
    const db = getTestPrisma();
    const rawToken = cookieA
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("asc_session="))
      ?.split("=")[1];
    expect(rawToken).toBeTruthy();
    const tokenHash = hashSessionToken(rawToken as string);
    expect(await db.session.findUnique({ where: { tokenHash } })).not.toBeNull();
    await db.session.updateMany({
      where: { userId: userA },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await authedGet(app, "/api/auth/me", cookieA).expect(401);
    // The presented session is revoked — it can never authenticate again.
    expect(await db.session.findUnique({ where: { tokenHash } })).toBeNull();
  });

  it("prunes expired sessions and caps active ones on login", async () => {
    const db = getTestPrisma();
    // 21 live + 3 expired direct inserts (bypasses the prune path).
    for (let i = 0; i < 21; i += 1) {
      await db.session.create({
        data: {
          userId: userA,
          tokenHash: hashSessionToken(generateSessionToken()),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await db.session.create({
        data: {
          userId: userA,
          tokenHash: sha(`expired-${i}-${randomBytes(4).toString("hex")}`),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
    }
    await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: PASSWORD })
      .expect(200);
    const remaining = await db.session.findMany({ where: { userId: userA } });
    expect(remaining.length).toBeLessThanOrEqual(20);
    expect(remaining.every((s) => s.expiresAt.getTime() > Date.now())).toBe(true);
  });

  it("throttles login per email, not just per IP", async () => {
    const limited = createApp({ auth: { loginMax: 2, registerMax: 100 } });
    await request(limited)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "wrong-1" });
    await request(limited)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "wrong-2" });
    const third = await request(limited)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "wrong-3" });
    expect(third.status).toBe(429);
    // A different account on the same IP still gets its own budget.
    const other = await request(limited)
      .post("/api/auth/login")
      .send({ email: "b@example.com", password: "wrong-1" });
    expect(other.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Timeouts / failure mapping
  // -----------------------------------------------------------------------

  it("withTimeout resolves fast values and 503s slow ones (unit)", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "op")).resolves.toBe(42);
    await expect(withTimeout(new Promise(() => undefined), 20, "Slow op")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("records TIMEOUT (not FAILED) when the provider times out", async () => {
    const timeoutChat: ChatCompletionProvider = {
      name: "timeout-stub",
      model: "stub",
      complete: async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      },
    };
    __setTutorChatForTests(timeoutChat);
    const res = await authedPost(app, `/api/projects/${projectA}/tutor/ask`, cookieA, {
      message: "What is photosynthesis?",
    });
    expect(res.status).toBe(503);
    const db = getTestPrisma();
    const usage = await db.aIUsage.findMany({
      where: { userId: userA, feature: "TUTOR" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.status).toBe("TIMEOUT");
    // Fail-closed: no dangling user message from the failed turn.
    expect(await db.message.count()).toBe(0);
  });

  it("rejects cross-quiz idempotency-key replay with 404", async () => {
    const db = getTestPrisma();
    const quizA = await db.quiz.create({
      data: { projectId: projectA, title: "QA", status: "PUBLISHED" },
    });
    const quizB = await db.quiz.create({
      data: { projectId: projectA, title: "QB", status: "PUBLISHED" },
    });
    await authedPost(app, `/api/quizzes/${quizA.id}/attempts`, cookieA, {
      idempotencyKey: "shared-key",
    }).expect(200);
    const replay = await authedPost(app, `/api/quizzes/${quizB.id}/attempts`, cookieA, {
      idempotencyKey: "shared-key",
    });
    expect(replay.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // Concurrency
  // -----------------------------------------------------------------------

  it("concurrent first-completions create exactly one mastery event set", async () => {
    const db = getTestPrisma();
    const concept = await db.concept.create({
      data: { projectId: projectA, name: "Concurrency" },
    });
    const quiz = await db.quiz.create({
      data: { projectId: projectA, title: "Race quiz", status: "PUBLISHED" },
    });
    const questions = [];
    for (let i = 0; i < 2; i += 1) {
      questions.push(
        await db.quizQuestion.create({
          data: {
            quizId: quiz.id,
            projectId: projectA,
            conceptId: concept.id,
            type: "MCQ",
            prompt: `Q${i}?`,
            options: ["a", "b"],
            correctAnswer: "a",
            order: i,
          },
        })
      );
    }
    const attempt = await db.quizAttempt.create({
      data: { quizId: quiz.id, projectId: projectA, userId: userA, maxScore: 2 },
    });
    for (const q of questions) {
      await db.quizResponse.create({
        data: {
          attemptId: attempt.id,
          questionId: q.id,
          projectId: projectA,
          userId: userA,
          selectedOption: "a",
          isCorrect: true,
          score: 1,
        },
      });
    }
    // Two first-completions race: both read completedAt=null, both run
    // mastery. The source-dedupe index forces one twin into a no-op.
    const [first, second] = await Promise.all([
      authedPost(app, `/api/quiz-attempts/${attempt.id}/complete`, cookieA, {}),
      authedPost(app, `/api/quiz-attempts/${attempt.id}/complete`, cookieA, {}),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const events = await db.masteryEvent.count({
      where: { userId: userA, projectId: projectA },
    });
    expect(events).toBe(2);
  });

  it("concurrent tutor turns on one thread get unique sequences", async () => {
    __setTutorChatForTests(new MockChatProvider());
    const db = getTestPrisma();
    const material = await db.material.create({
      data: {
        projectId: projectA,
        ownerId: userA,
        filename: "bio.pdf",
        originalFilename: "bio.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        storageKey: `test/race-${randomBytes(4).toString("hex")}`,
        status: "READY",
        knowledgeStatus: "READY",
        pageCount: 1,
      },
    });
    const page = await db.documentPage.create({
      data: {
        materialId: material.id,
        projectId: projectA,
        pageNumber: 1,
        extractedText: "Photosynthesis intro.",
      },
    });
    const content = "Photosynthesis converts light into chemical energy in chloroplasts uniquely.";
    await db.knowledgeChunk.create({
      data: {
        projectId: projectA,
        materialId: material.id,
        pageId: page.id,
        pageNumber: 1,
        chunkIndex: 0,
        content,
        tokenCount: 20,
        contentHash: sha(content),
      },
    });
    const first = await authedPost(app, `/api/projects/${projectA}/tutor/ask`, cookieA, {
      message: "What is photosynthesis?",
    }).expect(200);
    const conversationId = first.body.data.conversationId as string;
    // Same thread, same instant: the loser retries on P2002 with fresh
    // sequence numbers instead of failing the turn.
    const [a, b] = await Promise.all([
      authedPost(app, `/api/projects/${projectA}/tutor/ask`, cookieA, {
        message: "Tell me more about photosynthesis",
        conversationId,
      }),
      authedPost(app, `/api/projects/${projectA}/tutor/ask`, cookieA, {
        message: "And also about photosynthesis again",
        conversationId,
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });
    expect(messages).toHaveLength(6);
    expect(messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
