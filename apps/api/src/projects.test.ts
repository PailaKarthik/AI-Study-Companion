import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";

describe.skipIf(!hasTestDb)("projects API (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let spaceA = "";
  let spaceB = "";

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
    spaceA = (await authedPost(app, "/api/spaces", cookieA, { name: "Space A" }).expect(201)).body
      .data.id as string;
    spaceB = (await authedPost(app, "/api/spaces", cookieB, { name: "Space B" }).expect(201)).body
      .data.id as string;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects unauthenticated access with 401", async () => {
    await request(app).get(`/api/spaces/${spaceA}/projects`).expect(401);
    await request(app).post(`/api/spaces/${spaceA}/projects`).send({ name: "X" }).expect(401);
    await request(app).get("/api/projects/00000000-0000-4000-8000-000000000000").expect(401);
  });

  it("creates a project in an owned space with activity + defaults", async () => {
    const res = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Operating Systems",
      description: "Learn OS fundamentals",
      goal: "Understand processes, memory, scheduling and file systems",
    }).expect(201);
    expect(res.body.data).toMatchObject({
      name: "Operating Systems",
      spaceId: spaceA,
      status: "ACTIVE",
      materialCount: 0,
      conceptCount: 0,
    });

    const db = getTestPrisma();
    const events = await db.activityEvent.findMany({ where: { eventType: "PROJECT_CREATED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "Project",
      entityId: res.body.data.id,
      spaceId: spaceA,
      projectId: res.body.data.id,
    });
  });

  it("refuses creation inside another user's space (404, no oracle)", async () => {
    const missing = await authedPost(
      app,
      "/api/spaces/00000000-0000-4000-8000-000000000000/projects",
      cookieA,
      { name: "Intrude" }
    ).expect(404);
    const res = await authedPost(app, `/api/spaces/${spaceB}/projects`, cookieA, {
      name: "Intrude",
    }).expect(404);
    expect(res.body.error).toEqual(missing.body.error);

    // Never accepts owner/space ids from the body.
    const sneaky = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Sneaky",
      ownerId: "someone-else",
      spaceId: spaceB,
    }).expect(400);
    expect(sneaky.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates input and duplicate names per space", async () => {
    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, { name: "  " }).expect(400);
    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "P1",
      goal: "x".repeat(2001),
    }).expect(400);

    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, { name: "Same" }).expect(201);
    const dup = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Same",
    }).expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("lists only the space's own projects with counts, searchable", async () => {
    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, { name: "OS Basics" }).expect(
      201
    );
    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, { name: "Networks" }).expect(
      201
    );
    await authedPost(app, `/api/spaces/${spaceB}/projects`, cookieB, { name: "Foreign" }).expect(
      201
    );

    const res = await authedGet(app, `/api/spaces/${spaceA}/projects`, cookieA).expect(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.map((p: { name: string }) => p.name).sort()).toEqual([
      "Networks",
      "OS Basics",
    ]);

    const search = await authedGet(app, `/api/spaces/${spaceA}/projects?q=net`, cookieA).expect(
      200
    );
    expect(search.body.data.items.map((p: { name: string }) => p.name)).toEqual(["Networks"]);

    // Listing another user's space is 404.
    await authedGet(app, `/api/spaces/${spaceB}/projects`, cookieA).expect(404);
  });

  it("filters projects by status server-side with real counts", async () => {
    const active = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Active One",
    }).expect(201);
    await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Active Two",
    }).expect(201);
    const done = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Done One",
    }).expect(201);
    await request(app)
      .patch(`/api/projects/${done.body.data.id}`)
      .set("Cookie", cookieA)
      .send({ status: "COMPLETED" })
      .expect(200);
    await request(app)
      .patch(`/api/projects/${active.body.data.id}`)
      .set("Cookie", cookieA)
      .send({ status: "ARCHIVED" })
      .expect(200);

    const counts = await authedGet(app, `/api/spaces/${spaceA}/projects/counts`, cookieA).expect(
      200
    );
    expect(counts.body.data).toEqual({ all: 3, ACTIVE: 1, COMPLETED: 1, ARCHIVED: 1 });

    const completed = await authedGet(
      app,
      `/api/spaces/${spaceA}/projects?status=COMPLETED`,
      cookieA
    ).expect(200);
    expect(completed.body.data.total).toBe(1);
    expect(completed.body.data.items.map((p: { name: string }) => p.name)).toEqual(["Done One"]);

    const archived = await authedGet(
      app,
      `/api/spaces/${spaceA}/projects?status=ARCHIVED`,
      cookieA
    ).expect(200);
    expect(archived.body.data.total).toBe(1);

    // Invalid status rejected, never silently ignored.
    await authedGet(app, `/api/spaces/${spaceA}/projects?status=NOPE`, cookieA).expect(400);
    // Foreign space counts stay 404.
    await authedGet(app, `/api/spaces/${spaceB}/projects/counts`, cookieA).expect(404);
  });

  it("gets project detail with space ref and records PROJECT_VIEWED", async () => {
    const created = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Detail",
      goal: "Learn things",
    }).expect(201);
    const id = created.body.data.id as string;

    const res = await authedGet(app, `/api/projects/${id}`, cookieA).expect(200);
    expect(res.body.data).toMatchObject({ id, name: "Detail" });
    expect(res.body.data.space).toMatchObject({ id: spaceA, name: "Space A" });

    const db = getTestPrisma();
    expect(await db.activityEvent.count({ where: { eventType: "PROJECT_VIEWED" } })).toBe(1);
    const touched = await db.project.findUniqueOrThrow({ where: { id } });
    expect(touched.lastActivityAt.getTime()).toBeGreaterThanOrEqual(
      new Date(created.body.data.lastActivityAt).getTime()
    );
  });

  it("updates allowed fields, rejects system fields, logs activity", async () => {
    const created = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Patch Me",
    }).expect(201);
    const id = created.body.data.id as string;

    const updated = await request(app)
      .patch(`/api/projects/${id}`)
      .set("Cookie", cookieA)
      .send({ name: "Patched", goal: "New goal", status: "ARCHIVED" })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: "Patched", status: "ARCHIVED" });

    await request(app)
      .patch(`/api/projects/${id}`)
      .set("Cookie", cookieA)
      .send({ ownerId: "x", spaceId: spaceB, createdAt: "2020-01-01" })
      .expect(400);
    await request(app)
      .patch(`/api/projects/${id}`)
      .set("Cookie", cookieA)
      .send({ status: "NOPE" })
      .expect(400);
    await request(app).patch(`/api/projects/${id}`).set("Cookie", cookieA).send({}).expect(400);

    const db = getTestPrisma();
    expect(await db.activityEvent.count({ where: { eventType: "PROJECT_UPDATED" } })).toBe(1);
  });

  it("deletes an owned project with cascade + surviving audit row", async () => {
    const db = getTestPrisma();
    const created = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Delete Me",
    }).expect(201);
    const id = created.body.data.id as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    const concept = await db.concept.create({ data: { projectId: id, name: "C1" } });
    await db.conceptMastery.create({
      data: { userId: user.id, projectId: id, conceptId: concept.id, masteryScore: 0.5 },
    });

    await request(app).delete(`/api/projects/${id}`).set("Cookie", cookieA).expect(200);
    expect(await db.project.count({ where: { id } })).toBe(0);
    expect(await db.concept.count({ where: { projectId: id } })).toBe(0);
    expect(await db.conceptMastery.count({ where: { projectId: id } })).toBe(0);
    // Audit survives with nulled project FK.
    const audit = await db.activityEvent.findFirst({ where: { eventType: "PROJECT_DELETED" } });
    expect(audit).not.toBeNull();
    expect(audit?.projectId).toBeNull();
    expect(audit?.entityId).toBe(id);
    await authedGet(app, `/api/projects/${id}`, cookieA).expect(404);
  });

  it("denies cross-user project access indistinguishably (no oracle)", async () => {
    const created = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Private",
    }).expect(201);
    const id = created.body.data.id as string;
    const missing = await authedGet(
      app,
      "/api/projects/00000000-0000-4000-8000-000000000000",
      cookieB
    ).expect(404);

    for (const res of [
      await authedGet(app, `/api/projects/${id}`, cookieB),
      await request(app).patch(`/api/projects/${id}`).set("Cookie", cookieB).send({ name: "X" }),
      await request(app).delete(`/api/projects/${id}`).set("Cookie", cookieB),
      await authedGet(app, `/api/projects/${id}/overview`, cookieB),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(missing.body.error);
    }
    await authedGet(app, `/api/projects/${id}`, cookieA).expect(200);
  });

  it("serves a lightweight overview scoped to the owner", async () => {
    const db = getTestPrisma();
    const created = await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
      name: "Overview",
    }).expect(201);
    const id = created.body.data.id as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    const concept = await db.concept.create({ data: { projectId: id, name: "Pages" } });
    await db.conceptMastery.create({
      data: { userId: user.id, projectId: id, conceptId: concept.id, masteryScore: 0.8 },
    });
    await db.recommendation.create({
      data: {
        userId: user.id,
        projectId: id,
        type: "REVIEW",
        title: "Review Pages",
        status: "PENDING",
      },
    });

    const res = await authedGet(app, `/api/projects/${id}/overview`, cookieA).expect(200);
    expect(res.body.data.project).toMatchObject({ id, name: "Overview" });
    expect(res.body.data.counts).toMatchObject({
      materials: 0,
      concepts: 1,
      conversations: 0,
      quizzes: 0,
      assessments: 0,
    });
    expect(res.body.data.mastery).toMatchObject({
      assessedConcepts: 1,
      totalConcepts: 1,
      average: 0.8,
    });
    expect(res.body.data.recentActivity.length).toBeGreaterThan(0);
    expect(res.body.data.recommendations.map((r: { title: string }) => r.title)).toEqual([
      "Review Pages",
    ]);
    // No heavy payloads.
    expect(res.body.data.project).not.toHaveProperty("messages");
    expect(JSON.stringify(res.body.data).length).toBeLessThan(20000);
  });

  it("rejects malformed ids with 400, never 500 (format errors leak nothing)", async () => {
    for (const path of ["/api/projects/not-a-uuid", "/api/projects/not-a-uuid/overview"]) {
      const res = await authedGet(app, path, cookieA).expect(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
