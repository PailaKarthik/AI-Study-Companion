import type { PrismaClient, StorageProvider } from "@ai-study-companion/db";
import { buildPaginatedResult, parsePagination } from "@ai-study-companion/db";
import type { CreateSpaceInput, UpdateSpaceInput } from "@ai-study-companion/validation";
import type { Paginated, SpaceDetail, SpaceSummary } from "@ai-study-companion/shared";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { requireDb } from "../repositories/base.js";
import { getApiStorage } from "../lib/storage.js";
import { getOwnedSpaceOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";

export interface SpaceListParams {
  page?: unknown;
  pageSize?: unknown;
  q?: string;
}

const spaceSummarySelect = {
  id: true,
  name: true,
  description: true,
  icon: true,
  color: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { projects: true } },
} as const;

/** Shape returned by spaceSummarySelect (ownerId deliberately excluded). */
type SpaceRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { projects: number };
};

function toSummary(row: SpaceRow): SpaceSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    projectCount: row._count.projects,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: SpaceRow): SpaceDetail {
  return toSummary(row);
}

/** List only the caller's spaces, newest first, with project counts. */
export async function listSpaces(
  userId: string,
  params: SpaceListParams,
  db: PrismaClient = requireDb()
): Promise<Paginated<SpaceSummary>> {
  const { page, pageSize, skip, take } = parsePagination(params);
  const q = params.q?.trim();
  const where = {
    ownerId: userId,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.space.findMany({
      where,
      select: spaceSummarySelect,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
    db.space.count({ where }),
  ]);
  return buildPaginatedResult(rows.map(toSummary), total, { page, pageSize });
}

/** Create a space owned by the caller + SPACE_CREATED, atomically. */
export async function createSpace(
  userId: string,
  input: CreateSpaceInput,
  db: PrismaClient = requireDb()
): Promise<SpaceDetail> {
  try {
    return await db.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: {
          ownerId: userId,
          name: input.name,
          description: input.description,
          icon: input.icon,
          color: input.color,
        },
        select: spaceSummarySelect,
      });
      await recordActivity(tx, {
        userId,
        spaceId: space.id,
        eventType: "SPACE_CREATED",
        entityType: "Space",
        entityId: space.id,
      });
      return toDetail(space);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A space with this name already exists");
    }
    throw error;
  }
}

/** Single owned space with its project count. 404 covers missing + foreign. */
export async function getSpace(
  userId: string,
  spaceId: string,
  db: PrismaClient = requireDb()
): Promise<SpaceDetail> {
  const space = await db.space.findFirst({
    where: { id: spaceId, ownerId: userId },
    select: spaceSummarySelect,
  });
  if (!space) {
    throw new NotFoundError("Space not found");
  }
  // View events are best-effort audit: a read that fails to log must not
  // fail the read itself.
  await recordActivity(db, {
    userId,
    spaceId: space.id,
    eventType: "SPACE_VIEWED",
    entityType: "space",
    entityId: space.id,
  }).catch((error: unknown) =>
    logger.warn(
      { spaceId: space.id, error: error instanceof Error ? error.message : String(error) },
      "Space view event skipped"
    )
  );
  return toDetail(space);
}

/** Patch allowed fields only; ownership can never change. */
export async function updateSpace(
  userId: string,
  spaceId: string,
  patch: UpdateSpaceInput,
  db: PrismaClient = requireDb()
): Promise<SpaceDetail> {
  try {
    // Ownership is verified INSIDE the transaction against the same
    // snapshot the write commits on — no check-then-act window where a
    // concurrent change could slip between verification and update.
    return await db.$transaction(async (tx) => {
      const owned = await getOwnedSpaceOrThrow(userId, spaceId, tx);
      const space = await tx.space.update({
        where: { id: owned.id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
        },
        select: spaceSummarySelect,
      });
      await recordActivity(tx, {
        userId,
        spaceId: space.id,
        eventType: "SPACE_UPDATED",
        entityType: "Space",
        entityId: space.id,
      });
      return toDetail(space);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A space with this name already exists");
    }
    throw error;
  }
}

/**
 * Permanent delete. Metadata cascades (Space → Projects → learning
 * data) per the Prompt 2 schema design — intentional, no metadata
 * orphans. Bucket objects do NOT cascade (the bucket is outside
 * PostgreSQL): their keys are collected up front and removed after the
 * commit, tolerantly. The SPACE_DELETED row
 * is written first in the same transaction and survives (spaceId is a
 * plain scalar with no FK) as audit history; project-scoped rows under it
 * have their projectId nulled by the cascade's SetNull behavior.
 */
export async function deleteSpace(
  userId: string,
  spaceId: string,
  db: PrismaClient = requireDb(),
  storage: StorageProvider | null = getApiStorage()
): Promise<{ id: string }> {
  const owned = await getOwnedSpaceOrThrow(userId, spaceId, db);
  const blobs = await db.materialBlob.findMany({
    where: { material: { project: { spaceId: owned.id, ownerId: userId } } },
    select: { storageKey: true },
  });
  await db.$transaction(async (tx) => {
    await recordActivity(tx, {
      userId,
      spaceId: owned.id,
      eventType: "SPACE_DELETED",
      entityType: "Space",
      entityId: owned.id,
    });
    await tx.space.delete({ where: { id: owned.id } });
  });
  if (blobs.length > 0 && storage) {
    await storage.deleteObjects(blobs.map((b) => b.storageKey)).catch((error: unknown) => {
      logger.error(
        {
          spaceId: owned.id,
          keys: blobs.map((b) => b.storageKey),
          error: error instanceof Error ? error.message : String(error),
        },
        "Bucket cleanup failed after space delete; objects orphaned"
      );
    });
  }
  return { id: spaceId };
}
