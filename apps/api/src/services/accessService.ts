import type { PrismaClient } from "@ai-study-companion/db";
import { NotFoundError } from "../errors/AppError.js";
import { requireDb } from "../repositories/base.js";

/**
 * Minimal structural surface for ownership reads. Both PrismaClient and
 * interactive-transaction clients satisfy it, so ownership checks can run
 * INSIDE mutating transactions (no check-then-act window) without
 * widening to the full client type.
 */
export interface OwnershipDb {
  space: {
    findFirst(args: unknown): Promise<{ id: string; ownerId: string; name: string } | null>;
  };
  project: {
    findFirst(args: unknown): Promise<{
      id: string;
      ownerId: string;
      spaceId: string;
      name: string;
    } | null>;
  };
}

/**
 * Ownership enforcement for Space/Project resources.
 *
 * Pattern (never violated):
 *   authenticatedUserId → Space ownership → Project ownership → resource.
 *
 * Queries encode ownership directly (`{ id, ownerId }`) instead of fetching
 * by bare id and checking afterwards — there is no window where an
 * IDOR slip can happen. Misses return 404 NOT_FOUND (never 403) so callers
 * can't probe whether another user's resource exists.
 */

export interface OwnedSpace {
  id: string;
  ownerId: string;
  name: string;
}

export interface OwnedProject {
  id: string;
  ownerId: string;
  spaceId: string;
  name: string;
}

/** Load a space owned by the user or throw 404. */
export async function getOwnedSpaceOrThrow(
  userId: string,
  spaceId: string,
  db: OwnershipDb | PrismaClient = requireDb()
): Promise<OwnedSpace> {
  const space = await db.space.findFirst({
    where: { id: spaceId, ownerId: userId },
    select: { id: true, ownerId: true, name: true },
  });
  if (!space) {
    throw new NotFoundError("Space not found");
  }
  return space;
}

/** Load a project owned by the user or throw 404. */
export async function getOwnedProjectOrThrow(
  userId: string,
  projectId: string,
  db: OwnershipDb | PrismaClient = requireDb()
): Promise<OwnedProject> {
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true, ownerId: true, spaceId: true, name: true },
  });
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

/**
 * Full chain: the project must sit inside a space the user owns.
 * Guards against ownerId/spaceId inconsistencies (e.g. moved rows).
 */
export async function assertProjectAccess(
  userId: string,
  spaceId: string,
  projectId: string,
  db: OwnershipDb | PrismaClient = requireDb()
): Promise<OwnedProject> {
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: userId, spaceId },
    select: { id: true, ownerId: true, spaceId: true, name: true },
  });
  if (!project) {
    throw new NotFoundError("Project not found");
  }
  return project;
}
