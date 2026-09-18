import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";

describe.skipIf(!hasTestDb)("spaces API (isolated test DB)", () => {
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
    await request(app).get("/api/spaces").expect(401);
    await request(app).post("/api/spaces").send({ name: "X" }).expect(401);
  });

  it("creates a space and returns the envelope with zero projects", async () => {
    const res = await authedPost(app, "/api/spaces", cookieA, {
      name: "Computer Science",
      description: "Core CS learning",
    }).expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      name: "Computer Science",
      description: "Core CS learning",
      projectCount: 0,
    });
    expect(res.body.requestId).toBeDefined();

    const db = getTestPrisma();
    const events = await db.activityEvent.findMany({ where: { eventType: "SPACE_CREATED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "Space", entityId: res.body.data.id });
  });

  it("validates input: empty name, oversize fields, unknown keys → 400", async () => {
    await authedPost(app, "/api/spaces", cookieA, { name: "   " }).expect(400);
    await authedPost(app, "/api/spaces", cookieA, { name: "x".repeat(101) }).expect(400);
    await authedPost(app, "/api/spaces", cookieA, { name: "Ok", ownerId: "evil" }).expect(400);
    await authedPost(app, "/api/spaces", cookieA, { name: "Ok", color: "not-a-color" }).expect(400);
  });

  it("rejects duplicate names per user with 409, allows same name for others", async () => {
    await authedPost(app, "/api/spaces", cookieA, { name: "Dup" }).expect(201);
    const dup = await authedPost(app, "/api/spaces", cookieA, { name: "Dup" }).expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");
    // Another user may reuse the name (uniqueness is per owner).
    await authedPost(app, "/api/spaces", cookieB, { name: "Dup" }).expect(201);
  });

  it("lists only the caller's spaces with counts, newest first", async () => {
    await authedPost(app, "/api/spaces", cookieA, { name: "A1" }).expect(201);
    await authedPost(app, "/api/spaces", cookieA, { name: "A2" }).expect(201);
    await authedPost(app, "/api/spaces", cookieB, { name: "B1" }).expect(201);

    const res = await authedGet(app, "/api/spaces", cookieA).expect(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.map((s: { name: string }) => s.name).sort()).toEqual(["A1", "A2"]);
    for (const item of res.body.data.items) {
      expect(item).toHaveProperty("projectCount", 0);
    }
  });

  it("paginates and searches by name", async () => {
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      await authedPost(app, "/api/spaces", cookieA, { name }).expect(201);
    }
    const page1 = await authedGet(app, "/api/spaces?page=1&pageSize=2", cookieA).expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.total).toBe(3);
    expect(page1.body.data.page).toBe(1);
    const page2 = await authedGet(app, "/api/spaces?page=2&pageSize=2", cookieA).expect(200);
    expect(page2.body.data.items).toHaveLength(1);

    const search = await authedGet(app, "/api/spaces?q=alp", cookieA).expect(200);
    expect(search.body.data.items.map((s: { name: string }) => s.name)).toEqual(["Alpha"]);

    await authedGet(app, "/api/spaces?page=0", cookieA).expect(400);
  });

  it("gets, updates, and deletes an owned space with activity trail", async () => {
    const created = await authedPost(app, "/api/spaces", cookieA, { name: "Edit Me" }).expect(201);
    const id = created.body.data.id as string;

    const got = await authedGet(app, `/api/spaces/${id}`, cookieA).expect(200);
    expect(got.body.data.name).toBe("Edit Me");

    const updated = await request(app)
      .patch(`/api/spaces/${id}`)
      .set("Cookie", cookieA)
      .send({ name: "Edited", description: "New desc", color: "#4F46E5" })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: "Edited", description: "New desc" });

    // Unknown/system fields are rejected, not dropped.
    await request(app)
      .patch(`/api/spaces/${id}`)
      .set("Cookie", cookieA)
      .send({ ownerId: "someone-else" })
      .expect(400);
    await request(app).patch(`/api/spaces/${id}`).set("Cookie", cookieA).send({}).expect(400);

    const db = getTestPrisma();
    expect(await db.activityEvent.count({ where: { eventType: "SPACE_UPDATED" } })).toBe(1);

    await request(app).delete(`/api/spaces/${id}`).set("Cookie", cookieA).expect(200);
    await authedGet(app, `/api/spaces/${id}`, cookieA).expect(404);
    // Delete audit survives; space row is gone.
    expect(await db.activityEvent.count({ where: { eventType: "SPACE_DELETED" } })).toBe(1);
    expect(await db.space.count({ where: { id } })).toBe(0);
  });

  it("denies cross-user access indistinguishably from missing (no oracle)", async () => {
    const created = await authedPost(app, "/api/spaces", cookieA, { name: "Private" }).expect(201);
    const id = created.body.data.id as string;
    const missing = await authedGet(
      app,
      "/api/spaces/00000000-0000-4000-8000-000000000000",
      cookieB
    ).expect(404);

    for (const res of [
      await authedGet(app, `/api/spaces/${id}`, cookieB),
      await request(app).patch(`/api/spaces/${id}`).set("Cookie", cookieB).send({ name: "Hijack" }),
      await request(app).delete(`/api/spaces/${id}`).set("Cookie", cookieB),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(missing.body.error);
    }
    // Nothing changed.
    await authedGet(app, `/api/spaces/${id}`, cookieA).expect(200);
  });

  it("rejects malformed ids with 400, never 500 (format errors leak nothing)", async () => {
    const res = await authedGet(app, "/api/spaces/not-a-uuid", cookieA).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("cascades project data on space delete without orphans", async () => {
    const db = getTestPrisma();
    const space = await authedPost(app, "/api/spaces", cookieA, { name: "Cascade" }).expect(201);
    const spaceId = space.body.data.id as string;
    const user = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    const project = await db.project.create({
      data: { spaceId, ownerId: user.id, name: "Doomed" },
    });
    await db.concept.create({ data: { projectId: project.id, name: "C1" } });

    await request(app).delete(`/api/spaces/${spaceId}`).set("Cookie", cookieA).expect(200);
    expect(await db.project.count({ where: { id: project.id } })).toBe(0);
    expect(await db.concept.count({ where: { projectId: project.id } })).toBe(0);
  });
});
