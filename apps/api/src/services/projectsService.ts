import type { PrismaClient, StorageProvider } from "@ai-study-companion/db";
import type { ProjectStatus } from "@ai-study-companion/shared";
import { buildPaginatedResult, parsePagination } from "@ai-study-companion/db";
import type { CreateProjectInput, UpdateProjectInput } from "@ai-study-companion/validation";
import type {
  ActivitySummary,
  AttentionConcept,
  MasterySummary,
  Paginated,
  ProjectDetail,
  ProjectOverview,
  ProjectSummary,
  RecommendationSummary,
} from "@ai-study-companion/shared";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { requireDb } from "../repositories/base.js";
import { getApiStorage } from "../lib/storage.js";
import { getOwnedProjectOrThrow, getOwnedSpaceOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";
import { getGrowth } from "./masteryService.js";

export interface ProjectListParams {
  page?: unknown;
  pageSize?: unknown;
  q?: string;
  status?: ProjectStatus;
}

const projectSummarySelect = {
  id: true,
  spaceId: true,
  name: true,
  description: true,
  goal: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastActivityAt: true,
  _count: { select: { materials: true, concepts: true } },
} as const;

/** Shape returned by projectSummarySelect (ownerId deliberately excluded). */
type ProjectRow = {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  goal: string | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  _count: { materials: number; concepts: number };
};

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    description: row.description,
    goal: row.goal,
    status: row.status,
    materialCount: row._count.materials,
    conceptCount: row._count.concepts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

function toDetail(row: ProjectRow, spaceName: string): ProjectDetail {
  return { ...toSummary(row), space: { id: row.spaceId, name: spaceName } };
}

/** Projects of one owned space, newest activity first, with light counts. */
export async function listProjects(
  userId: string,
  spaceId: string,
  params: ProjectListParams,
  db: PrismaClient = requireDb()
): Promise<Paginated<ProjectSummary>> {
  await getOwnedSpaceOrThrow(userId, spaceId, db);
  const { page, pageSize, skip, take } = parsePagination(params);
  const q = params.q?.trim();
  const where = {
    spaceId,
    ownerId: userId,
    ...(params.status ? { status: params.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: projectSummarySelect,
      orderBy: { lastActivityAt: "desc" },
      skip,
      take,
    }),
    db.project.count({ where }),
  ]);
  return buildPaginatedResult(rows.map(toSummary), total, { page, pageSize });
}

/**
 * Real per-status counts for one owned space. Powers the All / Active /
 * Completed / Archived filter badges — a single grouped query so counts
 * always match the filtered lists, even with pagination.
 */
export async function countProjectsByStatus(
  userId: string,
  spaceId: string,
  db: PrismaClient = requireDb()
): Promise<{ all: number; ACTIVE: number; COMPLETED: number; ARCHIVED: number }> {
  await getOwnedSpaceOrThrow(userId, spaceId, db);
  const groups = await db.project.groupBy({
    by: ["status"],
    where: { spaceId, ownerId: userId },
    _count: { status: true },
  });
  const counts = { all: 0, ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
  for (const group of groups) {
    const n = group._count.status;
    counts.all += n;
    if (group.status === "ACTIVE") counts.ACTIVE += n;
    else if (group.status === "COMPLETED") counts.COMPLETED += n;
    else if (group.status === "ARCHIVED") counts.ARCHIVED += n;
  }
  return counts;
}

/** Create inside an owned space + PROJECT_CREATED, atomically. */
export async function createProject(
  userId: string,
  spaceId: string,
  input: CreateProjectInput,
  db: PrismaClient = requireDb()
): Promise<ProjectSummary> {
  await getOwnedSpaceOrThrow(userId, spaceId, db);
  try {
    return await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          spaceId,
          ownerId: userId,
          name: input.name,
          description: input.description,
          goal: input.goal,
          status: "ACTIVE",
        },
        select: projectSummarySelect,
      });
      await recordActivity(tx, {
        userId,
        spaceId,
        projectId: project.id,
        eventType: "PROJECT_CREATED",
        entityType: "Project",
        entityId: project.id,
      });
      return toSummary(project);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A project with this name already exists in this space");
    }
    throw error;
  }
}

/**
 * Owned project detail for the dashboard header. Also records PROJECT_VIEWED
 * and touches lastActivityAt — "recently active" means recently opened.
 */
export async function getProject(
  userId: string,
  projectId: string,
  db: PrismaClient = requireDb()
): Promise<ProjectDetail> {
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const [row, space] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: owned.id },
      select: projectSummarySelect,
    }),
    db.space.findUniqueOrThrow({
      where: { id: owned.spaceId },
      select: { name: true },
    }),
  ]);
  // View tracking must never break the read; failures are logged and
  // swallowed. Documented trade-off: core read stays available even if
  // the audit write fails (see docs/ARCHITECTURE.md).
  const viewedAt = new Date();
  await db
    .$transaction(async (tx) => {
      await tx.project.update({
        where: { id: owned.id },
        data: { lastActivityAt: viewedAt },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: owned.id,
        eventType: "PROJECT_VIEWED",
        entityType: "Project",
        entityId: owned.id,
      });
    })
    .catch((error: unknown) => {
      logger.warn(
        { userId, projectId: owned.id, error: error instanceof Error ? error.message : error },
        "Project view tracking failed; returning detail anyway"
      );
    });
  return toDetail({ ...row, lastActivityAt: viewedAt }, space.name);
}

/** Patch allowed fields only; owner/space/system fields can never change. */
export async function updateProject(
  userId: string,
  projectId: string,
  patch: UpdateProjectInput,
  db: PrismaClient = requireDb()
): Promise<ProjectSummary> {
  try {
    // Ownership verified inside the transaction (see updateSpace).
    return await db.$transaction(async (tx) => {
      const owned = await getOwnedProjectOrThrow(userId, projectId, tx);
      const project = await tx.project.update({
        where: { id: owned.id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          lastActivityAt: new Date(),
        },
        select: projectSummarySelect,
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: owned.id,
        eventType: "PROJECT_UPDATED",
        entityType: "Project",
        entityId: owned.id,
      });
      return toSummary(project);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A project with this name already exists in this space");
    }
    throw error;
  }
}

/**
 * Permanent delete. Metadata cascades to all project-owned learning data
 * per the schema design — including material_blob *metadata* rows, which
 * cascade from the material delete. Bucket objects do NOT cascade (the
 * bucket is outside PostgreSQL): their keys are collected up front and
 * removed after the commit, tolerantly (already-missing keys are fine;
 * failures are logged with keys, never crash the delete). The
 * PROJECT_DELETED row is written first and survives (its projectId FK
 * nulls via SetNull) as audit history.
 */
export async function deleteProject(
  userId: string,
  projectId: string,
  db: PrismaClient = requireDb(),
  storage: StorageProvider | null = getApiStorage()
): Promise<{ id: string }> {
  const verified = await getOwnedProjectOrThrow(userId, projectId, db);
  const blobs = await db.materialBlob.findMany({
    where: { material: { projectId: verified.id, ownerId: userId } },
    select: { storageKey: true },
  });
  const owned = await db.$transaction(async (tx) => {
    await recordActivity(tx, {
      userId,
      spaceId: verified.spaceId,
      projectId: verified.id,
      eventType: "PROJECT_DELETED",
      entityType: "Project",
      entityId: verified.id,
    });
    await tx.project.delete({ where: { id: verified.id } });
    return verified;
  });
  if (blobs.length > 0 && storage) {
    await storage.deleteObjects(blobs.map((b) => b.storageKey)).catch((error: unknown) => {
      logger.error(
        {
          projectId: owned.id,
          keys: blobs.map((b) => b.storageKey),
          error: error instanceof Error ? error.message : String(error),
        },
        "Bucket cleanup failed after project delete; objects orphaned"
      );
    });
  }
  return { id: owned.id };
}

function toActivitySummary(row: {
  id: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}): ActivitySummary {
  return {
    id: row.id,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Lightweight dashboard overview: counts via indexed relations, mastery
 * aggregate, recent activity (10) and pending recommendations (5), plus
 * growth buckets and attention concepts derived from the mastery engine.
 * Never loads messages, document contents, or full histories.
 */
export async function getProjectOverview(
  userId: string,
  projectId: string,
  db: PrismaClient = requireDb()
): Promise<ProjectOverview> {
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const [
    row,
    space,
    counts,
    masteryAgg,
    masteryCount,
    conceptCount,
    activity,
    recommendations,
    growth,
  ] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: owned.id },
      select: projectSummarySelect,
    }),
    db.space.findUniqueOrThrow({
      where: { id: owned.spaceId },
      select: { name: true },
    }),
    db.project
      .findUniqueOrThrow({
        where: { id: owned.id },
        select: {
          _count: {
            select: {
              materials: true,
              concepts: true,
              conversations: true,
              quizzes: true,
              assessments: true,
            },
          },
        },
      })
      .then((r) => r._count),
    db.conceptMastery.aggregate({
      where: { userId, projectId: owned.id },
      _avg: { masteryScore: true },
    }),
    db.conceptMastery.count({ where: { userId, projectId: owned.id } }),
    db.concept.count({ where: { projectId: owned.id } }),
    db.activityEvent.findMany({
      where: { projectId: owned.id },
      select: { id: true, eventType: true, entityType: true, entityId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.recommendation.findMany({
      where: { projectId: owned.id, userId, status: "PENDING" },
      select: {
        id: true,
        projectId: true,
        type: true,
        title: true,
        description: true,
        priority: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getGrowth(userId, owned.id, { db }),
  ]);

  const mastery: MasterySummary = {
    assessedConcepts: masteryCount,
    totalConcepts: conceptCount,
    average: masteryCount > 0 ? masteryAgg._avg.masteryScore : null,
  };

  const recommendationSummaries = recommendations.map((r): RecommendationSummary => ({
    id: r.id,
    projectId: r.projectId,
    type: r.type,
    title: r.title,
    description: r.description,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
  }));
  const priorityRank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

  return {
    project: toDetail(row, space.name),
    counts,
    mastery,
    recentActivity: activity.map(toActivitySummary),
    recommendations: recommendationSummaries,
    attentionConcepts: growth.needsAttention.slice(0, 3).map((c): AttentionConcept => ({
      conceptId: c.conceptId,
      name: c.conceptName,
      projectId: owned.id,
      projectName: row.name,
      masteryScore: c.masteryScore,
      evidenceCount: c.evidenceCount,
    })),
    growth: {
      improving: growth.improving.length,
      stable: growth.stable.length,
      needsAttention: growth.needsAttention.length,
      insufficientData: growth.insufficientData.length,
    },
    nextRecommendation:
      [...recommendationSummaries].sort(
        (a, b) => priorityRank[a.priority] - priorityRank[b.priority]
      )[0] ?? null,
  };
}
