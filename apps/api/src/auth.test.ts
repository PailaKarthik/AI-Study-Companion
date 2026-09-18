import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { hashSessionToken } from "./services/sessionToken.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";

const EMAIL = "auth.tester@example.com";
const PASSWORD = "correct-horse-battery-9";

describe.skipIf(!hasTestDb)("auth endpoints (isolated test DB)", () => {
  let app: Express;

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe("POST /api/auth/register", () => {
    it("registers with valid input, sets a secure cookie, returns safe user", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Auth Tester", email: "  AUTH.Tester@Example.COM ", password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(EMAIL);
      expect(res.body.data.name).toBe("Auth Tester");
      expect(res.body.data.role).toBe("USER");
      expect(res.body.data).not.toHaveProperty("passwordHash");
      expect(res.body).not.toHaveProperty("sessionToken");

      const cookies = res.headers["set-cookie"] as unknown as string[];
      expect(cookies.join(";")).toMatch(new RegExp(`${config.SESSION_COOKIE_NAME}=`));
      expect(cookies.join(";")).toContain("HttpOnly");
      expect(cookies.join(";")).toMatch(/SameSite=Lax/i);
      expect(cookies.join(";")).toContain("Path=/");

      // Password is hashed, email normalized.
      const db = getTestPrisma();
      const user = await db.user.findUnique({ where: { email: EMAIL } });
      expect(user).not.toBeNull();
      expect(user?.passwordHash).not.toBeNull();
      expect(user?.passwordHash).not.toContain(PASSWORD);
    });

    it("rejects duplicate email without leaking details", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "One", email: EMAIL, password: PASSWORD });
      const dup = await request(app)
        .post("/api/auth/register")
        .send({ name: "Two", email: EMAIL, password: "another-valid-pass-1" });
      expect(dup.status).toBe(409);
      expect(dup.body.success).toBe(false);
      expect(dup.body.error.code).toBe("CONFLICT");
    });

    it("rejects malformed email and weak password", async () => {
      const badEmail = await request(app)
        .post("/api/auth/register")
        .send({ name: "X", email: "not-an-email", password: PASSWORD });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.error.code).toBe("VALIDATION_ERROR");

      const weak = await request(app)
        .post("/api/auth/register")
        .send({ name: "X", email: "weak@example.com", password: "short" });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects oversized input", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "X".repeat(5000), email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "Auth Tester", email: EMAIL, password: PASSWORD });
    });

    it("logs in with valid credentials and sets a cookie", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(EMAIL);
      expect(res.body.data).not.toHaveProperty("passwordHash");
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("returns a generic 401 for wrong password, unknown email, missing hash", async () => {
      const wrongPass = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: "wrong-password-123" });
      const unknown = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: PASSWORD });
      // Same status, code, and message — no oracle for enumeration.
      // (requestIds intentionally differ per request; compare the rest.)
      for (const res of [wrongPass, unknown]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
        expect(res.body.error.message).toBe("Invalid email or password");
      }
      expect(wrongPass.body.error).toEqual(unknown.body.error);
    });

    it("rejects login for deactivated accounts without disclosure", async () => {
      const db = getTestPrisma();
      await db.user.update({ where: { email: EMAIL }, data: { isActive: false } });
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Invalid email or password");
    });
  });

  describe("sessions", () => {
    it("persists across requests, rejects expired/revoked, logout kills it", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ name: "Sess", email: EMAIL, password: PASSWORD })
        .expect(201);

      // Authenticated.
      await agent.get("/api/auth/me").expect(200);

      // Only a token hash lives in the DB — never the raw token.
      const db = getTestPrisma();
      const sessions = await db.session.findMany();
      expect(sessions).toHaveLength(1);
      const rawCookie = sessions[0]?.tokenHash ?? "";
      expect(rawCookie).toMatch(/^[0-9a-f]{64}$/);

      // Expired session is rejected AND cleaned up.
      await db.session.update({
        where: { id: sessions[0]?.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await agent.get("/api/auth/me");
      expect(expired.status).toBe(401);
      expect(await db.session.count()).toBe(0);

      // Fresh login → logout invalidates server-side.
      await agent.post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }).expect(200);
      const logout = await agent.post("/api/auth/logout").expect(200);
      expect(logout.body.data).toEqual({ loggedOut: true });
      // Cleared cookie + revoked session: me is 401 again.
      const cleared = (logout.headers["set-cookie"] as unknown as string[]).join(";");
      expect(cleared).toContain(`${config.SESSION_COOKIE_NAME}=;`);
      expect(await db.session.count()).toBe(0);
      await agent.get("/api/auth/me").expect(401);
    });

    it("logout without a session still succeeds and clears the cookie", async () => {
      const res = await request(app).post("/api/auth/logout").expect(200);
      expect(res.body.success).toBe(true);
    });

    it("tampered token hash never authenticates", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/register")
        .send({ name: "Sess", email: EMAIL, password: PASSWORD });
      const db = getTestPrisma();
      // Corrupt the stored hash: raw cookie can no longer match.
      await db.session.updateMany({ data: { tokenHash: hashSessionToken("forged") } });
      await agent.get("/api/auth/me").expect(401);
    });
  });

  describe("GET /api/auth/me", () => {
    it("requires authentication and returns only safe fields", async () => {
      await request(app).get("/api/auth/me").expect(401);
      const agent = request.agent(app);
      await agent.post("/api/auth/register").send({ name: "Me", email: EMAIL, password: PASSWORD });
      const me = await agent.get("/api/auth/me").expect(200);
      expect(Object.keys(me.body.data).sort()).toEqual(["email", "id", "name", "role"]);
    });
  });

  describe("CSRF origin check", () => {
    it("rejects state-changing requests from a foreign origin", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows requests without an origin (non-browser clients)", async () => {
      await request(app)
        .post("/api/auth/register")
        .send({ name: "Curl", email: EMAIL, password: PASSWORD })
        .expect(201);
    });
  });
});
