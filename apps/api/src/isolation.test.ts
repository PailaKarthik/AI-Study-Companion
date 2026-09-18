import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express, Request, Response } from "express";
import { createApp } from "./app.js";
import { requireAuth } from "./middleware/auth.js";
import { requireProjectAccess, requireSpaceOwner } from "./middleware/authorization.js";
import { asyncHandler } from "./middleware/errorHandler.js";
import { toSuccess } from "./utils/response.js";
import { getRequestId } from "./middleware/requestId.js";
import { buildTestHarness } from "./test/harness.js";
import {
  assertProjectAccess,
  getOwnedProjectOrThrow,
  getOwnedSpaceOrThrow,
} from "./services/accessService.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";

const PASSWORD = "test-password-123";

/**
 * IDOR matrix: User A must never reach User B's Space/Project (or anything
 * under it), even with exact IDs — and misses are 404, not 403, so no
 * existence oracle leaks. Test-only routes on a harness exercise the same
 * ownership middleware the future Spaces/Projects endpoints will use.
 */
function buildTestApp(): Express {
  return buildTestHarness((router) => {
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
      "/spaces/:spaceId/projects/:projectId",
      requireAuth,
      requireSpaceOwner("spaceId"),
      requireProjectAccess({ param: "projectId", spaceParam: "spaceId" }),
      asyncHandler(async (req: Request, res: Response) => {
        const project = (req as unknown as { ownedProject: { id: string } }).ownedProject;
        res.status(200).json(toSuccess({ projectId: project.id }, getRequestId(req)));
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

/** Register+login via the REAL app; return the raw session cookie. */
async function registerAndLogin(app: Express, email: string): Promise<string> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({ name: email, email, password: PASSWORD })
    .expect(201);
  const login = await agent.post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const setCookies = login.headers["set-cookie"] as unknown as string[];
  return (setCookies ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!hasTestDb)("project isolation / IDOR (isolated test DB)", () => {
  let app: Express;
  let harness: Express;

  let spaceA = "";
  let spaceB = "";
  let projectA = "";
  let projectB = "";
  let cookieA = "";
  let cookieB = "";

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    harness = buildTestApp();
    const db = getTestPrisma();

    cookieA = await registerAndLogin(app, "a@example.com");
    cookieB = await registerAndLogin(app, "b@example.com");

    const rowA = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    const rowB = await db.user.findUniqueOrThrow({ where: { email: "b@example.com" } });
    const sA = await db.space.create({ data: { ownerId: rowA.id, name: "Space A" } });
    const sB = await db.space.create({ data: { ownerId: rowB.id, name: "Space B" } });
    const pA = await db.project.create({
      data: { spaceId: sA.id, ownerId: rowA.id, name: "Project A" },
    });
    const pB = await db.project.create({
      data: { spaceId: sB.id, ownerId: rowB.id, name: "Project B" },
    });
    spaceA = sA.id;
    spaceB = sB.id;
    projectA = pA.id;
    projectB = pB.id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("service layer: own resources allowed, cross-user denied as 404", async () => {
    const db = getTestPrisma();
    const rowA = await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } });
    const rowB = await db.user.findUniqueOrThrow({ where: { email: "b@example.com" } });

    await expect(getOwnedSpaceOrThrow(rowA.id, spaceA)).resolves.toMatchObject({ id: spaceA });
    await expect(getOwnedProjectOrThrow(rowA.id, projectA)).resolves.toMatchObject({
      id: projectA,
    });
    await expect(assertProjectAccess(rowA.id, spaceA, projectA)).resolves.toMatchObject({
      id: projectA,
    });

    await expect(getOwnedSpaceOrThrow(rowA.id, spaceB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getOwnedProjectOrThrow(rowA.id, projectB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getOwnedProjectOrThrow(rowB.id, projectA)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Project B is not inside Space A even for its own owner check chain.
    await expect(assertProjectAccess(rowA.id, spaceA, projectB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("HTTP layer: A↔B cross-access denied with known IDs", async () => {
    const get = (path: string, cookie: string) => request(harness).get(path).set("Cookie", cookie);

    // Own resources: allowed.
    await get(`/spaces/${spaceA}`, cookieA).expect(200);
    await get(`/projects/${projectA}`, cookieA).expect(200);
    await get(`/spaces/${spaceB}`, cookieB).expect(200);
    await get(`/projects/${projectB}`, cookieB).expect(200);

    // Cross-user with exact IDs: denied, and indistinguishable from a
    // genuinely missing id of the same resource type (no oracle).
    const missingSpace = await get("/spaces/00000000-0000-4000-8000-000000000000", cookieA);
    const missingProject = await get("/projects/00000000-0000-4000-8000-000000000000", cookieA);
    expect(missingSpace.status).toBe(404);
    expect(missingProject.status).toBe(404);
    for (const [res, missing] of [
      [await get(`/spaces/${spaceB}`, cookieA), missingSpace],
      [await get(`/spaces/${spaceA}`, cookieB), missingSpace],
      [await get(`/projects/${projectB}`, cookieA), missingProject],
      [await get(`/projects/${projectA}`, cookieB), missingProject],
    ] as const) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(missing.body.error);
    }

    // Chained route: project must also sit inside the given owned space.
    await get(`/spaces/${spaceA}/projects/${projectA}`, cookieA).expect(200);
    await get(`/spaces/${spaceA}/projects/${projectB}`, cookieA).expect(404);
  });
});
