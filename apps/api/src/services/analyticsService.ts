import type { PrismaClient } from "@ai-study-companion/db";
import type {
  ActivityDayPoint,
  ActivitySummary,
  HomeAnalytics,
  MasteryDistribution,
  ProjectAnalytics,
} from "@ai-study-companion/shared";
import { ValidationError } from "../errors/AppError.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow } from "./accessService.js";
import { statusForScore } from "./masteryCalculator.js";
import { config } from "../config/index.js";

const MS_PER_DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Resolve analytics bounds. Defaults to the trailing 30 days ending now;
 * explicit bounds are honored (validation rejects from > to). Ranges over
 * a year are rejected to bound bucket counts. All UTC internally — the
 * frontend converts display timestamps to viewer timezone (docs/ANALYTICS).
 */
export function resolveDateRange(from?: Date, to?: Date): DateRange {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
  if (start > end) {
    throw new ValidationError("from must not be after to");
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    throw new ValidationError("Date range must not exceed 366 days");
  }
  return { from: start, to: end };
}

function masteryBands() {
  return {
    attentionBelow: config.MASTERY_ATTENTION_BELOW,
    developingBelow: config.MASTERY_DEVELOPING_BELOW,
    strongAt: config.MASTERY_STRONG_AT,
  };
}

export function distributionFor(scores: number[]): MasteryDistribution {
  const bands = masteryBands();
  const dist: MasteryDistribution = {
    needsAttention: 0,
    developing: 0,
    stable: 0,
    strong: 0,
    unassessed: 0,
  };
  for (const score of scores) {
    const status = statusForScore(score, bands);
    if (status === "NEEDS_ATTENTION") dist.needsAttention += 1;
    else if (status === "DEVELOPING") dist.developing += 1;
    else if (status === "STABLE") dist.stable += 1;
    else dist.strong += 1;
  }
  return dist;
}

interface DayRow {
  day: Date;
  count: bigint;
}

interface ScoreDayRow {
  day: Date;
  avg: number | null;
}

/**
 * UTC day-bucketed counts via a single grouped query — ActivityEvent
 * rows are never loaded into Node for aggregation. Gaps are zero-filled
 * in JS (bounded by the validated range length).
 */
async function activitySeries(
  db: PrismaClient,
  where: { userId?: string; projectId?: string },
  range: DateRange
): Promise<ActivityDayPoint[]> {
  const conditions: string[] = [`"createdAt" >= $1`, `"createdAt" < $2`];
  const params: unknown[] = [range.from, range.to];
  if (where.userId !== undefined) {
    params.push(where.userId);
    conditions.push(`"userId" = $${params.length}::uuid`);
  }
  if (where.projectId !== undefined) {
    params.push(where.projectId);
    conditions.push(`"projectId" = $${params.length}::uuid`);
  }
  const rows = await db.$queryRawUnsafe<DayRow[]>(
    `SELECT date_trunc('day', "createdAt")::timestamptz AS day, COUNT(*)::bigint AS count
     FROM "activity_events" WHERE ${conditions.join(" AND ")}
     GROUP BY 1 ORDER BY 1`,
    ...params
  );
  return fillDays(range, new Map(rows.map((r) => [dayKey(new Date(r.day)), Number(r.count)])));
}

async function masteryTrendSeries(
  db: PrismaClient,
  where: { userId?: string; projectId?: string },
  range: DateRange
): Promise<ActivityDayPoint[]> {
  const conditions: string[] = [`"createdAt" >= $1`, `"createdAt" < $2`];
  const params: unknown[] = [range.from, range.to];
  if (where.userId !== undefined) {
    params.push(where.userId);
    conditions.push(`"userId" = $${params.length}::uuid`);
  }
  if (where.projectId !== undefined) {
    params.push(where.projectId);
    conditions.push(`"projectId" = $${params.length}::uuid`);
  }
  const rows = await db.$queryRawUnsafe<ScoreDayRow[]>(
    `SELECT date_trunc('day', "createdAt")::timestamptz AS day, AVG("newScore") AS avg
     FROM "mastery_events" WHERE ${conditions.join(" AND ")}
     GROUP BY 1 ORDER BY 1`,
    ...params
  );
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.avg !== null) byDay.set(dayKey(new Date(row.day)), row.avg);
  }
  // No zero-fill for scores: a day with no assessments has no average,
  // and fabricating one would be fake data. Points only.
  return [...byDay]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fillDays(range: DateRange, counts: Map<string, number>): ActivityDayPoint[] {
  const points: ActivityDayPoint[] = [];
  const cursor = new Date(
    Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate())
  );
  const end = range.to.getTime();
  while (cursor.getTime() <= end) {
    const key = dayKey(cursor);
    points.push({ date: `${key}T00:00:00.000Z`, count: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

/** Distinct UTC activity dates (ISO day strings) in range, ascending. */
async function activityDays(
  db: PrismaClient,
  where: { userId?: string; projectId?: string },
  range: DateRange
): Promise<string[]> {
  const conditions: string[] = [`"createdAt" >= $1`, `"createdAt" < $2`];
  const params: unknown[] = [range.from, range.to];
  if (where.userId !== undefined) {
    params.push(where.userId);
    conditions.push(`"userId" = $${params.length}::uuid`);
  }
  if (where.projectId !== undefined) {
    params.push(where.projectId);
    conditions.push(`"projectId" = $${params.length}::uuid`);
  }
  const rows = await db.$queryRawUnsafe<{ day: Date }[]>(
    `SELECT DISTINCT date_trunc('day', "createdAt")::timestamptz AS day
     FROM "activity_events" WHERE ${conditions.join(" AND ")} ORDER BY 1`,
    ...params
  );
  return rows.map((r) => dayKey(new Date(r.day)));
}

/**
 * Current learning streak in days (UTC): consecutive active days ending
 * today, or ending yesterday when today has no activity yet. Deterministic
 * from the persisted date set — no heuristics, no time-of-day edge cases.
 */
export function streakFromDays(days: string[], now: Date = new Date()): number {
  const set = new Set(days);
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!set.has(dayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!set.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
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

const activitySelect = {
  id: true,
  eventType: true,
  entityType: true,
  entityId: true,
  createdAt: true,
} as const;

/**
 * Project analytics. Every number derives from persisted rows scoped to
 * the owned project (+user for user-owned tables); empty states are
 * zeros/nulls, never invented. Aggregation happens in PostgreSQL
 * (counts, averages, date buckets) — bounded selects only.
 */
export async function getProjectAnalytics(
  userId: string,
  projectId: string,
  input: { from?: Date; to?: Date } = {},
  db: PrismaClient = requireDb()
): Promise<ProjectAnalytics> {
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const range = resolveDateRange(input.from, input.to);
  const pid = owned.id;

  const [
    activityCount,
    series,
    days,
    masteryRows,
    conceptCount,
    trend,
    materials,
    tutorCount,
    quizCount,
    attempts,
    completedAttempts,
    assessments,
    assessmentAvg,
    recCreated,
    recCompleted,
    recDismissed,
    recent,
  ] = await Promise.all([
    db.activityEvent.count({
      where: { projectId: pid, createdAt: { gte: range.from, lt: range.to } },
    }),
    activitySeries(db, { projectId: pid }, range),
    activityDays(db, { projectId: pid }, range),
    db.conceptMastery.findMany({
      where: { userId, projectId: pid },
      select: { masteryScore: true, evidenceCount: true },
    }),
    db.concept.count({ where: { projectId: pid } }),
    masteryTrendSeries(db, { userId, projectId: pid }, range),
    db.material.groupBy({
      by: ["status"],
      where: { projectId: pid, ownerId: userId },
      _count: true,
    }),
    db.activityEvent.count({
      where: {
        projectId: pid,
        eventType: "TUTOR_INTERACTION",
        createdAt: { gte: range.from, lt: range.to },
      },
    }),
    db.quiz.count({ where: { projectId: pid, createdAt: { gte: range.from, lt: range.to } } }),
    db.quizAttempt.count({
      where: { projectId: pid, userId, createdAt: { gte: range.from, lt: range.to } },
    }),
    db.quizAttempt.count({
      where: { projectId: pid, userId, completedAt: { not: null, gte: range.from, lt: range.to } },
    }),
    db.assessment.count({
      where: { projectId: pid, userId, createdAt: { gte: range.from, lt: range.to } },
    }),
    db.assessment.aggregate({
      where: {
        projectId: pid,
        userId,
        score: { not: null },
        createdAt: { gte: range.from, lt: range.to },
      },
      _avg: { score: true },
    }),
    db.recommendation.count({
      where: { projectId: pid, userId, createdAt: { gte: range.from, lt: range.to } },
    }),
    db.recommendation.count({
      where: {
        projectId: pid,
        userId,
        status: "COMPLETED",
        completedAt: { gte: range.from, lt: range.to },
      },
    }),
    db.recommendation.count({
      where: {
        projectId: pid,
        userId,
        status: "DISMISSED",
        updatedAt: { gte: range.from, lt: range.to },
      },
    }),
    db.activityEvent.findMany({
      where: { projectId: pid },
      select: activitySelect,
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const byStatus = new Map(materials.map((m) => [m.status, m._count]));
  const assessed = masteryRows.filter((m) => m.evidenceCount > 0);
  const distribution = distributionFor(assessed.map((m) => m.masteryScore));
  distribution.unassessed = masteryRows.length - assessed.length;

  return {
    projectId: pid,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    totals: {
      activity: activityCount,
      activityDays: days.length,
      learningStreakDays: streakFromDays(days),
      materials: materials.reduce((sum, m) => sum + m._count, 0),
      materialsReady: byStatus.get("READY") ?? 0,
      materialsProcessing: (byStatus.get("QUEUED") ?? 0) + (byStatus.get("PROCESSING") ?? 0),
      materialsFailed: byStatus.get("FAILED") ?? 0,
      tutorInteractions: tutorCount,
      quizzes: quizCount,
      quizAttempts: attempts,
      quizzesCompleted: completedAttempts,
      assessments: assessments,
      averageAssessmentScore: assessmentAvg._avg.score,
      conceptsTracked: conceptCount,
      conceptsAssessed: assessed.length,
      recommendationsCreated: recCreated,
      recommendationsCompleted: recCompleted,
      recommendationsDismissed: recDismissed,
    },
    activityOverTime: series,
    masteryDistribution: distribution,
    masteryTrend: trend,
    recentActivity: recent.map(toActivitySummary),
  };
}

/**
 * Focused user-level analytics. Complements /api/home (which keeps its
 * dashboard shape) — homeService is untouched; this endpoint aggregates
 * the trend and cross-project totals the home page charts need.
 */
export async function getHomeAnalytics(
  userId: string,
  input: { from?: Date; to?: Date } = {},
  db: PrismaClient = requireDb()
): Promise<HomeAnalytics> {
  const range = resolveDateRange(input.from, input.to);

  const [
    spaces,
    projects,
    activeProjects,
    materialsReady,
    tutorCount,
    attempts,
    assessmentsDone,
    assessmentAvg,
    attention,
    latestDeltas,
    recCompleted,
    recPending,
    series,
    days,
    recent,
  ] = await Promise.all([
    db.space.count({ where: { ownerId: userId } }),
    db.project.count({ where: { ownerId: userId } }),
    db.project.count({ where: { ownerId: userId, status: "ACTIVE" } }),
    db.material.count({ where: { ownerId: userId, status: "READY" } }),
    db.activityEvent.count({
      where: {
        userId,
        eventType: "TUTOR_INTERACTION",
        createdAt: { gte: range.from, lt: range.to },
      },
    }),
    db.quizAttempt.count({ where: { userId, createdAt: { gte: range.from, lt: range.to } } }),
    db.assessment.count({ where: { userId, createdAt: { gte: range.from, lt: range.to } } }),
    db.assessment.aggregate({
      where: { userId, score: { not: null }, createdAt: { gte: range.from, lt: range.to } },
      _avg: { score: true },
    }),
    db.conceptMastery.count({
      where: {
        userId,
        evidenceCount: { gt: 0 },
        masteryScore: { lt: config.MASTERY_ATTENTION_BELOW },
      },
    }),
    // "Improving" without history scans: concepts whose mean event delta
    // in range is positive. A coarse but honest proxy, labeled as such.
    db.masteryEvent.groupBy({
      by: ["conceptId"],
      where: { userId, createdAt: { gte: range.from, lt: range.to } },
      _avg: { delta: true },
    }),
    db.recommendation.count({ where: { userId, status: "COMPLETED" } }),
    db.recommendation.count({ where: { userId, status: "PENDING" } }),
    activitySeries(db, { userId }, range),
    activityDays(db, { userId }, range),
    db.activityEvent.findMany({
      where: { userId },
      select: activitySelect,
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  const improvingCount = latestDeltas.filter((d) => (d._avg.delta ?? 0) > 0).length;

  return {
    userId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    totals: {
      spaces,
      projects,
      activeProjects,
      materialsReady,
      tutorInteractions: tutorCount,
      quizAttempts: attempts,
      assessmentsCompleted: assessmentsDone,
      averageAssessmentScore: assessmentAvg._avg.score,
      conceptsNeedingAttention: attention,
      conceptsImproving: improvingCount,
      recommendationsCompleted: recCompleted,
      recommendationsPending: recPending,
      activeDays: days.length,
    },
    activityOverTime: series,
    recentActivity: recent.map(toActivitySummary),
  };
}
