import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";
import { recordActivity, recordMany, sanitizeMetadata } from "./services/activityService.js";

describe.skipIf(!hasTestDb)("activity recording (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let userA = "";

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    const db = getTestPrisma();
    userA = (await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects invalid event types and missing actors", async () => {
    const db = getTestPrisma();
    await expect(
      recordActivity(db, { userId: userA, eventType: "MADE_UP_EVENT" as never })
    ).rejects.toThrow(/Invalid activity event type/);
    await expect(recordActivity(db, { userId: "", eventType: "PROJECT_VIEWED" })).rejects.toThrow(
      /require a userId/
    );
  });

  it("deduplicates retried operations by idempotency key", async () => {
    const db = getTestPrisma();
    const first = await recordActivity(db, {
      userId: userA,
      eventType: "QUIZ_COMPLETED",
      entityType: "quiz_attempt",
      entityId: "attempt-1",
      idempotencyKey: "quiz-completed:attempt-1",
    });
    const second = await recordActivity(db, {
      userId: userA,
      eventType: "QUIZ_COMPLETED",
      entityType: "quiz_attempt",
      entityId: "attempt-1",
      idempotencyKey: "quiz-completed:attempt-1",
    });
    expect(second.id).toBe(first.id);
    expect(
      await db.activityEvent.count({ where: { idempotencyKey: "quiz-completed:attempt-1" } })
    ).toBe(1);
  });

  it("records distinct keys as distinct events", async () => {
    const db = getTestPrisma();
    await recordActivity(db, { userId: userA, eventType: "PROJECT_VIEWED", idempotencyKey: "a" });
    await recordActivity(db, { userId: userA, eventType: "PROJECT_VIEWED", idempotencyKey: "b" });
    expect(
      await db.activityEvent.count({
        where: { userId: userA, eventType: "PROJECT_VIEWED" },
      })
    ).toBe(2);
  });

  it("scrubs forbidden metadata keys instead of persisting secrets", () => {
    const cleaned = sanitizeMetadata({
      feature: "tutor",
      password: "hunter2",
      nested: { apiKey: "sk-123", ok: 1 },
      list: [{ token: "abc" }, "fine"],
    });
    expect(cleaned).toMatchObject({
      feature: "tutor",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", ok: 1 },
      list: [{ token: "[redacted]" }, "fine"],
    });
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });

  it("recordMany batches rows and skips duplicates", async () => {
    const db = getTestPrisma();
    expect(await recordMany(db, [])).toEqual({ count: 0, duplicatesSkipped: 0 });
    const result = await recordMany(db, [
      { userId: userA, eventType: "SPACE_VIEWED", idempotencyKey: "m:1" },
      { userId: userA, eventType: "SPACE_VIEWED", idempotencyKey: "m:2" },
      { userId: userA, eventType: "SPACE_VIEWED", idempotencyKey: "m:1" },
    ]);
    expect(result).toEqual({ count: 2, duplicatesSkipped: 1 });
    await expect(recordMany(db, [{ userId: userA, eventType: "NOPE" as never }])).rejects.toThrow(
      /Invalid activity event type/
    );
  });

  it("emits auth lifecycle events on register, login, and logout", async () => {
    const db = getTestPrisma();
    const registered = await db.activityEvent.findMany({ where: { userId: userA } });
    expect(registered.map((e) => e.eventType)).toContain("USER_REGISTERED");

    // registerCookie already logged in once; a fresh login adds exactly one more.
    const loginsBefore = await db.activityEvent.count({
      where: { userId: userA, eventType: "USER_LOGIN" },
    });
    await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "test-password-123" })
      .expect(200);
    const loginsAfter = await db.activityEvent.count({
      where: { userId: userA, eventType: "USER_LOGIN" },
    });
    expect(loginsAfter - loginsBefore).toBe(1);

    await request(app).post("/api/auth/logout").set("Cookie", cookieA).expect(200);
    const afterLogout = await db.activityEvent.findMany({
      where: { userId: userA, eventType: "USER_LOGOUT" },
    });
    expect(afterLogout.length).toBe(1);
  });

  it("emits SPACE_VIEWED on space detail reads (best-effort, read still works)", async () => {
    const db = getTestPrisma();
    const spaceId = (await authedPost(app, "/api/spaces", cookieA, { name: "Viewed" }).expect(201))
      .body.data.id as string;
    await authedGet(app, `/api/spaces/${spaceId}`, cookieA).expect(200);
    const views = await db.activityEvent.findMany({
      where: { userId: userA, eventType: "SPACE_VIEWED", entityId: spaceId },
    });
    expect(views.length).toBe(1);
  });
});
