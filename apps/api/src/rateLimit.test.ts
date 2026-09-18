import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, hasTestDb, resetTestDb } from "./test/db.js";

const PASSWORD = "test-password-123";

/**
 * Rate limiting with deterministic low caps via createApp overrides —
 * no timing hacks. Uses valid-format payloads so 429s come from the
 * limiter, not validation.
 */
describe.skipIf(!hasTestDb)("auth rate limiting (isolated test DB)", () => {
  let app: Express;

  beforeEach(async () => {
    await resetTestDb();
    app = createApp({ auth: { loginMax: 2, registerMax: 2 } });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("throttles repeated login attempts with 429 + Retry headers", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "R", email: "r@example.com", password: PASSWORD });

    // Fresh app instance so register attempts don't consume login budget
    // (separate limiter instances per route).
    const loginApp = createApp({ auth: { loginMax: 2, registerMax: 100 } });
    await request(loginApp)
      .post("/api/auth/login")
      .send({ email: "r@example.com", password: "wrong-1" });
    await request(loginApp)
      .post("/api/auth/login")
      .send({ email: "r@example.com", password: "wrong-2" });
    const limited = await request(loginApp)
      .post("/api/auth/login")
      .send({ email: "r@example.com", password: "wrong-3" });

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("throttles repeated registrations", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "A", email: "a1@example.com", password: PASSWORD });
    await request(app)
      .post("/api/auth/register")
      .send({ name: "B", email: "a2@example.com", password: PASSWORD });
    const limited = await request(app)
      .post("/api/auth/register")
      .send({ name: "C", email: "a3@example.com", password: PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});
