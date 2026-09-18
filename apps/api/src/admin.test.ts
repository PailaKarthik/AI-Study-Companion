import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";

const ADMIN_PATHS = [
  "/api/admin/overview",
  "/api/admin/users",
  "/api/admin/spaces",
  "/api/admin/projects",
  "/api/admin/activity",
  "/api/admin/learning",
  "/api/admin/ai-usage",
  "/api/admin/ai-evaluations",
  "/api/admin/jobs",
  "/api/admin/system-health",
];

describe.skipIf(!hasTestDb)("admin API (isolated test DB)", () => {
  let app: Express;
  let adminCookie = "";
  let userCookie = "";
  let userId = "";

  async function seedActivity() {
    const db = getTestPrisma();
    const spaceId = (
      await authedPost(app, "/api/spaces", userCookie, { name: "Seeded" }).expect(201)
    ).body.data.id as string;
    const projectId = (
      await authedPost(app, `/api/spaces/${spaceId}/projects`, userCookie, {
        name: "Seeded Project",
      }).expect(201)
    ).body.data.id as string;
    await db.aIUsage.create({
      data: {
        userId,
        projectId,
        feature: "TUTOR",
        provider: "GROQ",
        model: "llama-3.3-70b-versatile",
        latencyMs: 1200,
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        estimatedCost: 0.000853,
        status: "SUCCESS",
      },
    });
    await db.aIUsage.create({
      data: {
        userId,
        feature: "EMBEDDING",
        provider: "GEMINI",
        model: "gemini-embedding-001",
        latencyMs: 300,
        inputTokens: 100,
        status: "FAILED",
        error: "boom",
      },
    });
    await db.aIEvaluation.create({
      data: {
        feature: "TUTOR",
        model: "llama-3.3-70b-versatile",
        provider: "GROQ",
        targetType: "tutor_message",
        targetId: "00000000-0000-4000-8000-000000000001",
        scores: { groundedness: 1, citationValidity: 0.5 },
        evaluator: "system-deterministic-v1",
      },
    });
    const material = await db.material.create({
      data: {
        projectId,
        ownerId: userId,
        filename: "job.pdf",
        originalFilename: "job.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: "seed/job",
        status: "READY",
        pageCount: 1,
      },
    });
    await db.documentJob.create({
      data: {
        materialId: material.id,
        jobId: "knowledge-seed-job",
        type: "FULL_INGEST",
        status: "COMPLETED",
        attempts: 1,
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(Date.now() - 30_000),
      },
    });
    return { spaceId, projectId };
  }

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    adminCookie = await registerCookie(app, "admin@example.com");
    userCookie = await registerCookie(app, "user@example.com");
    const db = getTestPrisma();
    await db.user.update({ where: { email: "admin@example.com" }, data: { role: "ADMIN" } });
    userId = (await db.user.findUniqueOrThrow({ where: { email: "user@example.com" } })).id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects every admin route for non-admins with 403", async () => {
    for (const path of ADMIN_PATHS) {
      const res = await authedGet(app, path, userCookie).expect(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    // Unknown user id is still a 403 (authz before existence).
    await authedGet(
      app,
      "/api/admin/users/00000000-0000-4000-8000-000000000000",
      userCookie
    ).expect(403);
  });

  it("rejects unauthenticated admin access with 401", async () => {
    await request(app).get("/api/admin/overview").expect(401);
  });

  it("serves overview aggregates with honest zeros on empty systems", async () => {
    const res = await authedGet(app, "/api/admin/overview", adminCookie).expect(200);
    // Seeded only by two registrations/logins at this point.
    expect(res.body.data.users.total).toBe(2);
    expect(res.body.data.materials).toMatchObject({ uploaded: 0, ready: 0, failed: 0 });
    expect(res.body.data.jobs).toMatchObject({ queued: 0, completed: 0, failed: 0 });
    expect(res.body.data.jobs.failureRate).toBeNull();
    expect(res.body.data.jobs.averageDurationMs).toBeNull();
    expect(res.body.data.ai.calls).toBe(0);
    expect(res.body.data.ai.estimatedCostUsd).toBeNull();
  });

  it("aggregates overview from real rows", async () => {
    await seedActivity();
    const res = await authedGet(app, "/api/admin/overview", adminCookie).expect(200);
    const data = res.body.data;
    expect(data.materials).toMatchObject({ uploaded: 1, ready: 1 });
    expect(data.jobs).toMatchObject({ completed: 1, failed: 0, failureRate: 0 });
    expect(data.jobs.averageDurationMs).toBeCloseTo(30_000, -2);
    expect(data.ai.calls).toBe(2);
    expect(data.ai.successful).toBe(1);
    expect(data.ai.failed).toBe(1);
    expect(data.ai.inputTokens).toBe(600);
    expect(data.ai.estimatedCostUsd).toBeCloseTo(0.000853, 6);
    expect(data.learning.quizAttempts).toBe(0);
  });

  it("lists users without secrets and supports search, role filter, pagination", async () => {
    await registerCookie(app, "third@example.com");
    const all = await authedGet(app, "/api/admin/users?page=1&pageSize=2", adminCookie).expect(200);
    expect(all.body.data).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(all.body.data.items).toHaveLength(2);
    const raw = JSON.stringify(all.body.data);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("tokenHash");

    const searched = await authedGet(app, "/api/admin/users?q=third", adminCookie).expect(200);
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.items[0]).toMatchObject({ email: "third@example.com" });

    const admins = await authedGet(app, "/api/admin/users?role=ADMIN", adminCookie).expect(200);
    expect(admins.body.data.total).toBe(1);
  });

  it("inspects a user journey without leaking credentials", async () => {
    await seedActivity();
    const res = await authedGet(app, `/api/admin/users/${userId}`, adminCookie).expect(200);
    const data = res.body.data;
    expect(data).toMatchObject({ id: userId, email: "user@example.com", role: "USER" });
    expect(data).not.toHaveProperty("passwordHash");
    expect(data.spaces).toHaveLength(1);
    expect(data.counts.materials).toBe(1);
    expect(data.mastery).toMatchObject({ assessedConcepts: 0 });
    await authedGet(
      app,
      "/api/admin/users/00000000-0000-4000-8000-000000000000",
      adminCookie
    ).expect(404);
  });

  it("explores activity with filters, sorting, and pagination", async () => {
    await seedActivity();
    const all = await authedGet(app, "/api/admin/activity?pageSize=50", adminCookie).expect(200);
    expect(all.body.data.total).toBeGreaterThan(0);
    const descs = all.body.data.items.map((i: { createdAt: string }) => i.createdAt);
    expect([...descs].sort().reverse()).toEqual(descs);

    const filtered = await authedGet(
      app,
      `/api/admin/activity?eventType=USER_REGISTERED&userId=${userId}`,
      adminCookie
    ).expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0]).toMatchObject({
      eventType: "USER_REGISTERED",
      userEmail: "user@example.com",
    });

    const asc = await authedGet(
      app,
      "/api/admin/activity?sort=asc&pageSize=100",
      adminCookie
    ).expect(200);
    const ascs = asc.body.data.items.map((i: { createdAt: string }) => i.createdAt);
    expect([...ascs].sort()).toEqual(ascs);

    // Unknown user filter yields empty, not an error.
    const none = await authedGet(
      app,
      "/api/admin/activity?userId=00000000-0000-4000-8000-000000000000",
      adminCookie
    ).expect(200);
    expect(none.body.data.total).toBe(0);
  });

  it("rejects invalid admin queries with 400", async () => {
    await authedGet(app, "/api/admin/activity?page=0", adminCookie).expect(400);
    await authedGet(app, "/api/admin/ai-usage?status=MAYBE", adminCookie).expect(400);
    await authedGet(app, "/api/admin/users/abc", adminCookie).expect(400);
  });

  it("serves learning analytics with labeled nulls", async () => {
    await seedActivity();
    const res = await authedGet(app, "/api/admin/learning", adminCookie).expect(200);
    expect(res.body.data.quizzes).toMatchObject({ created: 0, attempts: 0, completionRate: null });
    expect(res.body.data.accuracy).toMatchObject({ rate: null });
    expect(res.body.data.assessments).toMatchObject({ completed: 0, averageScore: null });
  });

  it("serves AI usage and evaluations with filters", async () => {
    await seedActivity();
    const usage = await authedGet(app, "/api/admin/ai-usage", adminCookie).expect(200);
    expect(usage.body.data.total).toBe(2);
    const failed = await authedGet(app, "/api/admin/ai-usage?status=FAILED", adminCookie).expect(
      200
    );
    expect(failed.body.data.total).toBe(1);
    expect(failed.body.data.items[0]).toMatchObject({ provider: "GEMINI", status: "FAILED" });
    const tutor = await authedGet(app, "/api/admin/ai-usage?feature=TUTOR", adminCookie).expect(
      200
    );
    expect(tutor.body.data.items[0].estimatedCostUsd).toBeCloseTo(0.000853, 6);

    const evals = await authedGet(app, "/api/admin/ai-evaluations", adminCookie).expect(200);
    expect(evals.body.data.total).toBe(1);
    expect(evals.body.data.items[0]).toMatchObject({
      feature: "TUTOR",
      targetType: "tutor_message",
    });
    expect(evals.body.data.items[0].scoreKeys).toContain("groundedness");
    // Score values stay server-side.
    expect(JSON.stringify(evals.body.data)).not.toContain('citationValidity":0.5');
  });

  it("serves job analytics with real durations and failure states", async () => {
    await seedActivity();
    const res = await authedGet(app, "/api/admin/jobs", adminCookie).expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      type: "FULL_INGEST",
      status: "COMPLETED",
      materialName: "job.pdf",
      attempts: 1,
    });
    expect(res.body.data.items[0].durationMs).toBeCloseTo(30_000, -2);
    const filtered = await authedGet(app, "/api/admin/jobs?status=FAILED", adminCookie).expect(200);
    expect(filtered.body.data.total).toBe(0);
  });

  it("reports system health without secrets", async () => {
    const res = await authedGet(app, "/api/admin/system-health", adminCookie).expect(200);
    const data = res.body.data;
    expect(data.services.database.status).toBe("healthy");
    expect(data.services.database.latencyMs).toEqual(expect.any(Number));
    expect(data.services.ai).toMatchObject({
      groq: { status: expect.any(String) },
      gemini: { status: expect.any(String) },
    });
    expect(data.version).toEqual(expect.any(String));
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/password|secret|token|key[^s]/i);
  });
});
