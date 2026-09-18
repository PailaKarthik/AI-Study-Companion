import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";

describe.skipIf(!hasTestDb)("home API (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects unauthenticated access with 401", async () => {
    await request(app).get("/api/home").expect(401);
  });

  it("returns honest empty state for a fresh user (no faked progress)", async () => {
    const res = await authedGet(app, "/api/home", cookieA).expect(200);
    expect(res.body.data).toEqual({
      continueLearning: null,
      recentProjects: [],
      stats: { spaceCount: 0, projectCount: 0, activeProjectCount: 0 },
      progress: { assessedConcepts: 0, totalConcepts: 0, average: null },
      attention: [],
      nextAction: null,
    });
  });

  it("aggregates the user's own spaces, projects, and recency", async () => {
    const space = await authedPost(app, "/api/spaces", cookieA, { name: "CS" }).expect(201);
    const spaceId = space.body.data.id as string;
    const p1 = await authedPost(app, `/api/spaces/${spaceId}/projects`, cookieA, {
      name: "First",
    }).expect(201);
    const p2 = await authedPost(app, `/api/spaces/${spaceId}/projects`, cookieA, {
      name: "Second",
    }).expect(201);
    // Touch p1 last so ordering is deterministic.
    await authedGet(app, `/api/projects/${p1.body.data.id}`, cookieA).expect(200);

    const res = await authedGet(app, "/api/home", cookieA).expect(200);
    const data = res.body.data;
    expect(data.stats).toEqual({ spaceCount: 1, projectCount: 2, activeProjectCount: 2 });
    expect(data.continueLearning.id).toBe(p1.body.data.id);
    expect(data.recentProjects.map((p: { id: string }) => p.id)).toEqual([
      p1.body.data.id,
      p2.body.data.id,
    ]);
    // Still no learning evidence → nulls, not zeros-as-progress.
    expect(data.progress).toEqual({ assessedConcepts: 0, totalConcepts: 0, average: null });
    expect(data.attention).toEqual([]);
    expect(data.nextAction).toBeNull();
  });

  it("reflects real mastery, attention, and persisted recommendations", async () => {
    const db = getTestPrisma();
    const space = await authedPost(app, "/api/spaces", cookieA, { name: "CS" }).expect(201);
    const spaceId = space.body.data.id as string;
    const project = await authedPost(app, `/api/spaces/${spaceId}/projects`, cookieA, {
      name: "OS",
    }).expect(201);
    const projectId = project.body.data.id as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });

    const weak = await db.concept.create({ data: { projectId, name: "Weak" } });
    const strong = await db.concept.create({ data: { projectId, name: "Strong" } });
    await db.conceptMastery.create({
      data: { userId: user.id, projectId, conceptId: weak.id, masteryScore: 0.2, evidenceCount: 3 },
    });
    await db.conceptMastery.create({
      data: {
        userId: user.id,
        projectId,
        conceptId: strong.id,
        masteryScore: 0.9,
        evidenceCount: 5,
      },
    });
    await db.recommendation.create({
      data: {
        userId: user.id,
        projectId,
        type: "REVIEW",
        title: "Review Weak",
        priority: "HIGH",
        status: "PENDING",
      },
    });

    const res = await authedGet(app, "/api/home", cookieA).expect(200);
    const data = res.body.data;
    expect(data.progress).toMatchObject({ assessedConcepts: 2, totalConcepts: 2 });
    expect(data.progress.average).toBeCloseTo(0.55, 5);
    expect(data.attention.map((a: { name: string }) => a.name)).toEqual(["Weak"]);
    expect(data.attention[0]).toMatchObject({ projectName: "OS", masteryScore: 0.2 });
    expect(data.nextAction).toMatchObject({ title: "Review Weak", priority: "HIGH" });
  });

  it("never leaks another user's data", async () => {
    const db = getTestPrisma();
    const space = await authedPost(app, "/api/spaces", cookieB, { name: "Secret" }).expect(201);
    const project = await authedPost(app, `/api/spaces/${space.body.data.id}/projects`, cookieB, {
      name: "Hidden",
    }).expect(201);
    const userB = await db.user.findUniqueOrThrow({ where: { email: "b@example.com" } });
    const concept = await db.concept.create({
      data: { projectId: project.body.data.id, name: "BConcept" },
    });
    await db.conceptMastery.create({
      data: {
        userId: userB.id,
        projectId: project.body.data.id,
        conceptId: concept.id,
        masteryScore: 1,
        evidenceCount: 9,
      },
    });
    await db.recommendation.create({
      data: {
        userId: userB.id,
        projectId: project.body.data.id,
        type: "PRACTICE",
        title: "B Rec",
        status: "PENDING",
      },
    });

    const res = await authedGet(app, "/api/home", cookieA).expect(200);
    const flat = JSON.stringify(res.body.data);
    expect(flat).not.toContain("Secret");
    expect(flat).not.toContain("Hidden");
    expect(flat).not.toContain("BConcept");
    expect(flat).not.toContain("B Rec");
    expect(res.body.data.stats).toEqual({ spaceCount: 0, projectCount: 0, activeProjectCount: 0 });
  });
});
