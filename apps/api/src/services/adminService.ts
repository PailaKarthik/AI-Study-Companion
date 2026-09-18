import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import { buildPaginatedResult, parsePagination } from "@ai-study-companion/db";
import type {
  AdminActivityItem,
  AdminAIEvaluationItem,
  AdminAIUsageItem,
  AdminJobItem,
  AdminLearningAnalytics,
  AdminOverview,
  AdminSystemHealth,
  AdminUserDetail,
  AdminUserSummary,
  Paginated,
} from "@ai-study-companion/shared";
import { checkDatabase } from "@ai-study-companion/db";
import { NotFoundError, ValidationError } from "../errors/AppError.js";
import { config, isRedisConfigured } from "../config/index.js";
import { requireDb } from "../repositories/base.js";
import { getApiStorage } from "../lib/storage.js";
import { distributionFor, resolveDateRange } from "./analyticsService.js";

const RECENT_DAYS = 7;

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function costOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  // Keep full DECIMAL(10,6) precision — rounding to cents would erase
  // sub-cent AI call costs entirely.
  return Number.isFinite(num) ? Math.round(num * 1_000_000) / 1_000_000 : null;
}

/** Admin overview: system-wide aggregates, all from persisted rows. */
export async function getAdminOverview(
  input: { from?: Date; to?: Date } = {},
  db: PrismaClient = requireDb()
): Promise<AdminOverview> {
  const range = resolveDateRange(input.from, input.to);
  const recentSince = new Date(Date.now() - RECENT_DAYS * 86_400_000);
  const inRange = { gte: range.from, lt: range.to };

  const [
    userTotal,
    userRecent,
    userActive,
    spaceTotal,
    projectTotal,
    materials,
    tutorCount,
    attempts,
    assessmentsDone,
    aiAgg,
    aiFailed,
    jobs,
    jobDurations,
    activeDays,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: recentSince } } }),
    db.user.count({ where: { lastActiveAt: { gte: range.from } } }),
    db.space.count(),
    db.project.count(),
    db.material.groupBy({ by: ["status"], _count: true }),
    db.activityEvent.count({ where: { eventType: "TUTOR_INTERACTION", createdAt: inRange } }),
    db.quizAttempt.count({ where: { createdAt: inRange } }),
    db.assessment.count({ where: { createdAt: inRange } }),
    db.aIUsage.aggregate({
      where: { createdAt: inRange },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
      _avg: { latencyMs: true },
    }),
    db.aIUsage.count({ where: { status: { in: ["FAILED", "TIMEOUT"] }, createdAt: inRange } }),
    db.documentJob.groupBy({ by: ["status"], _count: true }),
    db.$queryRaw<{ avgMs: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) AS "avgMs"
      FROM "document_jobs"
      WHERE "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
        AND "completedAt" >= ${range.from} AND "completedAt" < ${range.to}
    `,
    db.$queryRaw<{ days: bigint }[]>`
      SELECT COUNT(DISTINCT date_trunc('day', "createdAt")) AS days
      FROM "activity_events"
      WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
    `,
  ]);

  const materialByStatus = new Map(materials.map((m) => [m.status, m._count]));
  const jobByStatus = new Map(jobs.map((j) => [j.status, j._count]));
  const completed = jobByStatus.get("COMPLETED") ?? 0;
  const failed = jobByStatus.get("FAILED") ?? 0;
  const finished = completed + failed;

  return {
    users: { total: userTotal, recent: userRecent, active: userActive },
    spaces: { total: spaceTotal, projects: projectTotal },
    materials: {
      uploaded: materials.reduce((sum, m) => sum + m._count, 0),
      ready: materialByStatus.get("READY") ?? 0,
      processing: (materialByStatus.get("QUEUED") ?? 0) + (materialByStatus.get("PROCESSING") ?? 0),
      failed: materialByStatus.get("FAILED") ?? 0,
    },
    learning: {
      tutorInteractions: tutorCount,
      quizAttempts: attempts,
      assessmentsCompleted: assessmentsDone,
      activeDays: Number(activeDays[0]?.days ?? 0),
    },
    ai: {
      calls: aiAgg._count,
      successful: aiAgg._count - aiFailed,
      failed: aiFailed,
      inputTokens: aiAgg._sum.inputTokens ?? 0,
      outputTokens: aiAgg._sum.outputTokens ?? 0,
      estimatedCostUsd: costOrNull(aiAgg._sum.estimatedCost),
      averageLatencyMs: aiAgg._avg.latencyMs,
    },
    jobs: {
      queued: jobByStatus.get("QUEUED") ?? 0,
      processing: jobByStatus.get("PROCESSING") ?? 0,
      completed,
      failed,
      failureRate: finished > 0 ? failed / finished : null,
      averageDurationMs: jobDurations[0]?.avgMs ?? null,
    },
  };
}

export interface AdminUserListInput {
  page?: unknown;
  pageSize?: unknown;
  q?: string;
  role?: "USER" | "ADMIN";
}

/** Paginated users with safe summaries + per-user counts. No secrets ever. */
export async function listAdminUsers(
  input: AdminUserListInput,
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminUserSummary>> {
  const { page, pageSize, skip, take } = parsePagination({
    page: input.page,
    pageSize: input.pageSize,
  });
  const where: Prisma.UserWhereInput = {};
  if (input.role) where.role = input.role;
  if (input.q) {
    where.OR = [
      { email: { contains: input.q, mode: "insensitive" } },
      { name: { contains: input.q, mode: "insensitive" } },
    ];
  }
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        lastActiveAt: true,
        _count: {
          select: {
            spaces: true,
            projects: true,
            materials: true,
            quizAttempts: true,
            assessments: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.user.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: toIso(u.lastActiveAt),
      counts: {
        spaces: u._count.spaces,
        projects: u._count.projects,
        materials: u._count.materials,
        quizAttempts: u._count.quizAttempts,
        assessments: u._count.assessments,
      },
    })),
    total,
    { page, pageSize }
  );
}

/** Single-user journey: account, content tree, activity, mastery, recs. */
export async function getAdminUser(
  userId: string,
  db: PrismaClient = requireDb()
): Promise<AdminUserDetail> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      lastActiveAt: true,
      _count: {
        select: {
          spaces: true,
          projects: true,
          materials: true,
          quizAttempts: true,
          assessments: true,
        },
      },
    },
  });
  if (!user) throw new NotFoundError("User not found");
  const [spaces, recentActivity, masteryAgg, masteryCount, totalConcepts, recs] = await Promise.all(
    [
      db.space.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true, createdAt: true, _count: { select: { projects: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.activityEvent.findMany({
        where: { userId },
        select: { id: true, eventType: true, entityType: true, entityId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.conceptMastery.aggregate({ where: { userId }, _avg: { masteryScore: true } }),
      db.conceptMastery.count({ where: { userId } }),
      db.concept.count({ where: { project: { ownerId: userId } } }),
      db.recommendation.groupBy({ by: ["status"], where: { userId }, _count: true }),
    ]
  );
  const recByStatus = new Map(recs.map((r) => [r.status, r._count]));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: toIso(user.lastActiveAt),
    counts: {
      spaces: user._count.spaces,
      projects: user._count.projects,
      materials: user._count.materials,
      quizAttempts: user._count.quizAttempts,
      assessments: user._count.assessments,
    },
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      projectCount: s._count.projects,
      createdAt: s.createdAt.toISOString(),
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      entityType: a.entityType,
      entityId: a.entityId,
      createdAt: a.createdAt.toISOString(),
    })),
    mastery: {
      assessedConcepts: masteryCount,
      totalConcepts,
      average: masteryCount > 0 ? masteryAgg._avg.masteryScore : null,
    },
    recommendations: {
      pending: recByStatus.get("PENDING") ?? 0,
      completed: recByStatus.get("COMPLETED") ?? 0,
      dismissed: recByStatus.get("DISMISSED") ?? 0,
    },
  };
}

export interface AdminSpaceRow {
  id: string;
  name: string;
  ownerEmail: string | null;
  projectCount: number;
  createdAt: string;
}

export async function listAdminSpaces(
  input: { page?: unknown; pageSize?: unknown; q?: string },
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminSpaceRow>> {
  const { page, pageSize, skip, take } = parsePagination(input);
  const where: Prisma.SpaceWhereInput = input.q
    ? { name: { contains: input.q, mode: "insensitive" } }
    : {};
  const [rows, total] = await Promise.all([
    db.space.findMany({
      where,
      select: {
        id: true,
        name: true,
        createdAt: true,
        owner: { select: { email: true } },
        _count: { select: { projects: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.space.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      ownerEmail: s.owner?.email ?? null,
      projectCount: s._count.projects,
      createdAt: s.createdAt.toISOString(),
    })),
    total,
    { page, pageSize }
  );
}

export interface AdminProjectRow {
  id: string;
  name: string;
  status: string;
  ownerEmail: string | null;
  spaceName: string | null;
  materialCount: number;
  conceptCount: number;
  createdAt: string;
}

export async function listAdminProjects(
  input: { page?: unknown; pageSize?: unknown; q?: string },
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminProjectRow>> {
  const { page, pageSize, skip, take } = parsePagination(input);
  const where: Prisma.ProjectWhereInput = input.q
    ? { name: { contains: input.q, mode: "insensitive" } }
    : {};
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        owner: { select: { email: true } },
        space: { select: { name: true } },
        _count: { select: { materials: true, concepts: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.project.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      ownerEmail: p.owner?.email ?? null,
      spaceName: p.space?.name ?? null,
      materialCount: p._count.materials,
      conceptCount: p._count.concepts,
      createdAt: p.createdAt.toISOString(),
    })),
    total,
    { page, pageSize }
  );
}

export interface AdminActivityInput {
  page?: unknown;
  pageSize?: unknown;
  from?: Date;
  to?: Date;
  userId?: string;
  eventType?: string;
  spaceId?: string;
  projectId?: string;
  sort?: "asc" | "desc";
}

/** Filtered, paginated, newest/oldest-sortable activity stream. */
export async function listAdminActivity(
  input: AdminActivityInput,
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminActivityItem>> {
  const { page, pageSize, skip, take } = parsePagination({
    page: input.page,
    pageSize: input.pageSize,
  });
  const where: Prisma.ActivityEventWhereInput = {};
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lt: input.to } : {}),
    };
  }
  if (input.userId) where.userId = input.userId;
  if (input.eventType) where.eventType = input.eventType;
  if (input.spaceId) where.spaceId = input.spaceId;
  if (input.projectId) where.projectId = input.projectId;
  const [rows, total] = await Promise.all([
    db.activityEvent.findMany({
      where,
      select: {
        id: true,
        userId: true,
        spaceId: true,
        projectId: true,
        eventType: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: { createdAt: input.sort === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
    db.activityEvent.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.user?.email ?? null,
      spaceId: r.spaceId,
      projectId: r.projectId,
      eventType: r.eventType,
      entityType: r.entityType,
      entityId: r.entityId,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    { page, pageSize }
  );
}

/** System-wide learning analytics from persisted rows. */
export async function getAdminLearning(
  input: { from?: Date; to?: Date } = {},
  db: PrismaClient = requireDb()
): Promise<AdminLearningAnalytics> {
  const range = resolveDateRange(input.from, input.to);
  const inRange = { gte: range.from, lt: range.to };
  const [
    quizzesCreated,
    attempts,
    completed,
    correct,
    answered,
    assessmentsDone,
    assessmentAvg,
    masteryRows,
    totalConcepts,
    weak,
    improvingDeltas,
    recCreated,
    recCompleted,
    mistakes,
    series,
  ] = await Promise.all([
    db.quiz.count({ where: { createdAt: inRange } }),
    db.quizAttempt.count({ where: { createdAt: inRange } }),
    db.quizAttempt.count({ where: { completedAt: { not: null, gte: range.from, lt: range.to } } }),
    db.quizResponse.count({ where: { isCorrect: true, createdAt: inRange } }),
    db.quizResponse.count({ where: { isCorrect: { not: null }, createdAt: inRange } }),
    db.assessment.count({ where: { createdAt: inRange } }),
    db.assessment.aggregate({
      where: { score: { not: null }, createdAt: inRange },
      _avg: { score: true },
    }),
    db.conceptMastery.findMany({ select: { masteryScore: true, evidenceCount: true } }),
    db.concept.count(),
    db.conceptMastery.count({
      where: { evidenceCount: { gt: 0 }, masteryScore: { lt: config.MASTERY_ATTENTION_BELOW } },
    }),
    // Improving proxy (labeled as such): concepts whose mean event delta
    // in range is positive. Full trend math lives in growthAnalyzer and
    // runs per project on the growth board — not scanned system-wide here.
    db.masteryEvent.groupBy({
      by: ["conceptId"],
      where: { createdAt: inRange },
      _avg: { delta: true },
    }),
    db.recommendation.count({ where: { createdAt: inRange } }),
    db.recommendation.count({ where: { status: "COMPLETED", completedAt: inRange } }),
    db.learnerContext.findMany({
      where: { type: "REPEATED_MISTAKE" },
      select: { metadata: true, content: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    db.$queryRawUnsafe<{ day: Date; count: bigint }[]>(
      `SELECT date_trunc('day', "createdAt")::timestamptz AS day, COUNT(*)::bigint AS count
       FROM "activity_events" WHERE "createdAt" >= $1 AND "createdAt" < $2
       GROUP BY 1 ORDER BY 1`,
      range.from,
      range.to
    ),
  ]);

  const assessed = masteryRows.filter((m) => m.evidenceCount > 0);
  const distribution = distributionFor(assessed.map((m) => m.masteryScore));
  // Unassessed = concepts with no row at all + rows with zero evidence.
  distribution.unassessed = totalConcepts - assessed.length;

  const byDay = new Map<string, number>(
    series.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)])
  );
  const activityOverTime: { date: string; count: number }[] = [];
  const cursor = new Date(
    Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate())
  );
  while (cursor.getTime() <= range.to.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    activityOverTime.push({ date: `${key}T00:00:00.000Z`, count: byDay.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    quizzes: {
      created: quizzesCreated,
      attempts,
      completed,
      completionRate: attempts > 0 ? completed / attempts : null,
    },
    accuracy: {
      correct,
      answered,
      rate: answered > 0 ? correct / answered : null,
    },
    assessments: { completed: assessmentsDone, averageScore: assessmentAvg._avg.score },
    masteryDistribution: distribution,
    improving: improvingDeltas.filter((d) => (d._avg.delta ?? 0) > 0).length,
    needingAttention: weak,
    activityOverTime,
    recommendations: {
      created: recCreated,
      completed: recCompleted,
      completionRate: recCreated > 0 ? recCompleted / recCreated : null,
    },
    repeatedMistakes: mistakes.map((m) => {
      const meta =
        typeof m.metadata === "object" && m.metadata !== null
          ? (m.metadata as { conceptId?: unknown; incorrectCount?: unknown })
          : {};
      return {
        conceptId: typeof meta.conceptId === "string" ? meta.conceptId : "",
        conceptName: m.content.slice(0, 120),
        incorrectCount: typeof meta.incorrectCount === "number" ? meta.incorrectCount : 0,
      };
    }),
  };
}

export interface AdminAIUsageInput {
  page?: unknown;
  pageSize?: unknown;
  from?: Date;
  to?: Date;
  feature?:
    | "TUTOR"
    | "QUIZ_GENERATION"
    | "ASSESSMENT"
    | "RECOMMENDATION"
    | "EMBEDDING"
    | "DOCUMENT_UNDERSTANDING"
    | "EVALUATION";
  provider?: "GROQ" | "GEMINI" | "SYSTEM";
  status?: "SUCCESS" | "FAILED" | "TIMEOUT";
  sort?: "asc" | "desc";
}

/** Paginated AI call ledger. Costs surface as estimated USD, never exact. */
export async function listAdminAIUsage(
  input: AdminAIUsageInput,
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminAIUsageItem>> {
  const { page, pageSize, skip, take } = parsePagination({
    page: input.page,
    pageSize: input.pageSize,
  });
  const where: Prisma.AIUsageWhereInput = {};
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lt: input.to } : {}),
    };
  }
  if (input.feature) where.feature = input.feature;
  if (input.provider) where.provider = input.provider;
  if (input.status) where.status = input.status;
  const [rows, total] = await Promise.all([
    db.aIUsage.findMany({
      where,
      orderBy: { createdAt: input.sort === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
    db.aIUsage.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      projectId: r.projectId,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      estimatedCostUsd: costOrNull(r.estimatedCost),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    { page, pageSize }
  );
}

export interface AdminAIEvaluationsInput {
  page?: unknown;
  pageSize?: unknown;
  feature?:
    | "TUTOR"
    | "QUIZ_GENERATION"
    | "ASSESSMENT"
    | "RECOMMENDATION"
    | "EMBEDDING"
    | "DOCUMENT_UNDERSTANDING"
    | "EVALUATION";
  sort?: "asc" | "desc";
}

/**
 * Paginated quality evaluations. Score values stay server-side for
 * payload size; `scoreKeys` shows which metrics each evaluation carries
 * (absent metrics render as unavailable, never fabricated).
 */
export async function listAdminAIEvaluations(
  input: AdminAIEvaluationsInput,
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminAIEvaluationItem>> {
  const { page, pageSize, skip, take } = parsePagination({
    page: input.page,
    pageSize: input.pageSize,
  });
  const where: Prisma.AIEvaluationWhereInput = {};
  if (input.feature) where.feature = input.feature;
  const [rows, total] = await Promise.all([
    db.aIEvaluation.findMany({
      where,
      orderBy: { createdAt: input.sort === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
    db.aIEvaluation.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((r) => ({
      id: r.id,
      feature: r.feature,
      model: r.model,
      provider: r.provider,
      targetType: r.targetType,
      targetId: r.targetId,
      evaluator: r.evaluator,
      createdAt: r.createdAt.toISOString(),
      scoreKeys: typeof r.scores === "object" && r.scores !== null ? Object.keys(r.scores) : [],
    })),
    total,
    { page, pageSize }
  );
}

export interface AdminJobsInput {
  page?: unknown;
  pageSize?: unknown;
  from?: Date;
  to?: Date;
  type?: "TEXT_EXTRACTION" | "CHUNKING" | "EMBEDDING" | "FULL_INGEST";
  status?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  sort?: "asc" | "desc";
}

/**
 * Background-job explorer over persisted DocumentJob rows — the durable
 * record is authoritative for history (BullMQ holds only live queue
 * depth; see docs/ANALYTICS.md). Durations derive from startedAt/
 * completedAt; rows missing either report null, not zero.
 */
export async function listAdminJobs(
  input: AdminJobsInput,
  db: PrismaClient = requireDb()
): Promise<Paginated<AdminJobItem>> {
  const { page, pageSize, skip, take } = parsePagination({
    page: input.page,
    pageSize: input.pageSize,
  });
  const where: Prisma.DocumentJobWhereInput = {};
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: input.from } : {}),
      ...(input.to ? { lt: input.to } : {}),
    };
  }
  if (input.type) where.type = input.type;
  if (input.status) where.status = input.status;
  const [rows, total] = await Promise.all([
    db.documentJob.findMany({
      where,
      select: {
        id: true,
        materialId: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        material: { select: { filename: true, projectId: true } },
      },
      orderBy: { createdAt: input.sort === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
    db.documentJob.count({ where }),
  ]);
  return buildPaginatedResult(
    rows.map((j) => ({
      id: j.id,
      materialId: j.materialId,
      materialName: j.material?.filename ?? null,
      projectId: j.material?.projectId ?? null,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      error: j.error,
      durationMs:
        j.startedAt && j.completedAt ? j.completedAt.getTime() - j.startedAt.getTime() : null,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    })),
    total,
    { page, pageSize }
  );
}

/**
 * Admin-safe system health. Lightweight by design: one timed DB query,
 * config-presence checks for Redis/AI keys (the API never owns the
 * Redis connection — see /ready), a cheap HeadBucket probe for the
 * Neon Object Storage file backend, and worker liveness inferred from
 * recent persisted job completions. No credentials, no connection
 * strings, no expensive probes per dashboard request.
 */
export async function getAdminSystemHealth(
  db: PrismaClient = requireDb()
): Promise<AdminSystemHealth> {
  const started = Date.now();
  let database: AdminSystemHealth["services"]["database"] = { status: "healthy" };
  try {
    const check = await checkDatabase();
    database =
      check.status === "up"
        ? { status: "healthy", latencyMs: Date.now() - started }
        : { status: "degraded", detail: check.detail };
  } catch (error) {
    database = {
      status: "degraded",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const redis = isRedisConfigured()
    ? { status: "skipped" as const, detail: "Redis configured; live check owned by worker" }
    : { status: "skipped" as const, detail: "Redis is not configured" };

  const latestJob = await db.documentJob.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { status: true, updatedAt: true },
  });
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  const worker: AdminSystemHealth["services"]["worker"] = !latestJob
    ? { status: "unknown", detail: "No job history yet" }
    : latestJob.status === "FAILED"
      ? { status: "degraded", detail: `Latest job failed at ${latestJob.updatedAt.toISOString()}` }
      : latestJob.updatedAt.getTime() >= fifteenMinutesAgo
        ? { status: "healthy", detail: `Active at ${latestJob.updatedAt.toISOString()}` }
        : { status: "unknown", detail: `Idle since ${latestJob.updatedAt.toISOString()}` };

  // File bytes live in the Neon Object Storage bucket: probe bucket
  // reachability with a HeadBucket (no values read). Presence-only
  // credential checks would lie — this performs the real call.
  let storage: AdminSystemHealth["services"]["storage"];
  const bucket = getApiStorage();
  if (!bucket) {
    storage = { status: "not-configured", detail: "File storage is not configured" };
  } else {
    try {
      await bucket.healthCheck();
      const objects = await db.materialBlob.count();
      storage = {
        status: "configured",
        detail:
          `Neon Object Storage bucket reachable ` +
          `(${objects} referenced object${objects === 1 ? "" : "s"})`,
      };
    } catch (error) {
      storage = {
        status: "degraded",
        detail: `Bucket unreachable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const overall =
    database.status === "degraded" || worker.status === "degraded" ? "degraded" : "healthy";

  return {
    status: overall,
    services: {
      database,
      redis,
      worker,
      storage,
      ai: {
        groq: { status: config.GROQ_API_KEY ? "configured" : "not-configured" },
        gemini: { status: config.GEMINI_API_KEY ? "configured" : "not-configured" },
      },
    },
    version: config.version,
    timestamp: new Date().toISOString(),
  };
}
