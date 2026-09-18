import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express, Request, Response } from "express";
import { createApp } from "./app.js";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import { requireProjectAccess, requireSpaceOwner } from "./middleware/authorization.js";
import { asyncHandler } from "./middleware/errorHandler.js";
import { toSuccess } from "./utils/response.js";
import { getRequestId } from "./middleware/requestId.js";
import { buildTestHarness } from "./test/harness.js";
import { closeTestDb, hasTestDb, resetTestDb, getTestPrisma } from "./test/db.js";

const PASSWORD = "test-password-123";

/**
 * Test-only routes proving the middleware chain end-to-end. They live on a
 * test harness (never in src/routes) — no feature endpoints ship yet.
 */
function buildTestApp(): Express {
  return buildTestHarness((router) => {
    router.get(
      "/admin-ping",
      ...requireAdmin,
      asyncHandler(async (req: Request, res: Response) => {
        res.status(200).json(toSuccess({ admin: true }, getRequestId(req)));
      })
    );
    router.get(
      "/spaces/:spaceId",
      requireAuth,
      requireSpaceOwner("spaceId"),
      asyncHandler(async (req: Request, res: Response) => {
        const space = (req as unknown as { ownedSpace: { id: string } }).ownedSpace;
        res.status(200).json(toSuccess({ spaceId: space.id }, getRequestId(req)));
      })
    );
    router.get(
      "/projects/:projectId",
      requireAuth,
      requireProjectAccess(),
      asyncHandler(async (req: Request, res: Response) => {
        const project = (req as unknown as { ownedProject: { id: string } }).ownedProject;
        res.status(200).json(toSuccess({ projectId: project.id }, getRequestId(req)));
      })
    );
  });
}

/** Register via the REAL app; return the raw session cookie value. */
async function sessionCookie(app: Express, email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Tester", email, password: PASSWORD })
    .expect(201);
  const setCookies = res.headers["set-cookie"] as unknown as string[];
  return (setCookies ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!hasTestDb)("authorization (isolated test DB)", () => {
  let app: Express;
  let harness: Express;

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    harness = buildTestApp();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("unauthenticated requests get 401 on protected routes", async () => {
    const real = await request(app).get("/api/auth/me");
    expect(real.status).toBe(401);
    expect(real.body.error.code).toBe("UNAUTHENTICATED");
    expect(real.body.requestId).toBeDefined();

    for (const path of ["/admin-ping", "/spaces/00000000-0000-4000-8000-000000000000"]) {
      const res = await request(harness).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("non-admin is denied admin routes; admin is allowed", async () => {
    const cookie = await sessionCookie(app, "user@example.com");

    const denied = await request(harness).get("/admin-ping").set("Cookie", cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    // Promote server-side (the ONLY way — no client-provided role is read).
    const db = getTestPrisma();
    const row = await db.user.findUniqueOrThrow({ where: { email: "user@example.com" } });
    await db.user.update({ where: { id: row.id }, data: { role: "ADMIN" } });

    const allowed = await request(harness).get("/admin-ping").set("Cookie", cookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toEqual({ admin: true });
  });

  it("malformed ids are 404, never 500", async () => {
    const cookie = await sessionCookie(app, "user@example.com");
    const res = await request(harness).get("/projects/not-a-uuid").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
