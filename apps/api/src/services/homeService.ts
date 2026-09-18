import type { PrismaClient } from "@ai-study-companion/db";
import type {
  AttentionConcept,
  HomeData,
  ProjectStatus,
  ProjectSummary,
} from "@ai-study-companion/shared";
import { requireDb } from "../repositories/base.js";

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

/**
 * Attention threshold (Prompt 5 heuristic, pending real Growth Analysis):
 * assessed concepts scoring below this genuinely need a revisit. Concepts
 * at/above it are never listed as "requiring attention" — surfacing them
 * would fabricate weaknesses.
 */
export const ATTENTION_THRESHOLD = 0.7;

/**
 * Home aggregation for one user. Everything is scoped by ownerId/userId —
 * another user's rows can never leak in. All reads are bounded selects;
 * no histories, messages, or document contents are loaded.
 *
 * Progress definition (documented, no fake percentages):
 * - `progress.average` = mean masteryScore across the user's mastery rows,
 *   or null when nothing has been assessed yet.
 * - Attention = assessed concepts with the lowest scores (evidence > 0).
 * - `nextAction` = highest-priority pending recommendation (ties oldest),
 *   written by the deterministic refresh engine — only persisted rows
 *   surface here.
 */
export async function getHomeData(
  userId: string,
  db: PrismaClient = requireDb()
): Promise<HomeData> {
  const [
    spaceCount,
    projectCount,
    activeProjectCount,
    recent,
    masteryAgg,
    masteryCount,
    totalConcepts,
    weak,
    pendingActions,
  ] = await Promise.all([
    db.space.count({ where: { ownerId: userId } }),
    db.project.count({ where: { ownerId: userId } }),
    db.project.count({ where: { ownerId: userId, status: "ACTIVE" } }),
    db.project.findMany({
      where: { ownerId: userId },
      select: projectSummarySelect,
      orderBy: { lastActivityAt: "desc" },
      take: 5,
    }),
    db.conceptMastery.aggregate({
      where: { userId },
      _avg: { masteryScore: true },
    }),
    db.conceptMastery.count({ where: { userId } }),
    db.concept.count({ where: { project: { ownerId: userId } } }),
    db.conceptMastery.findMany({
      where: { userId, evidenceCount: { gt: 0 }, masteryScore: { lt: ATTENTION_THRESHOLD } },
      select: {
        masteryScore: true,
        evidenceCount: true,
        concept: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { masteryScore: "asc" },
      take: 5,
    }),
    db.recommendation.findMany({
      where: { userId, status: "PENDING" },
      select: {
        id: true,
        projectId: true,
        type: true,
        title: true,
        description: true,
        priority: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  const recentProjects = recent.map(toSummary);
  const attention: AttentionConcept[] = weak.map((w) => ({
    conceptId: w.concept.id,
    name: w.concept.name,
    projectId: w.project.id,
    projectName: w.project.name,
    masteryScore: w.masteryScore,
    evidenceCount: w.evidenceCount,
  }));
  // Highest-priority pending recommendation wins; ties break oldest-first.
  // Now that refreshRecommendations writes real rows, this surfaces the
  // engine's actual top pick instead of an arbitrary oldest row.
  const priorityRank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const nextAction = [...pendingActions].sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority]
  )[0];

  return {
    continueLearning: recentProjects[0] ?? null,
    recentProjects,
    stats: { spaceCount, projectCount, activeProjectCount },
    progress: {
      assessedConcepts: masteryCount,
      totalConcepts,
      average: masteryCount > 0 ? masteryAgg._avg.masteryScore : null,
    },
    attention,
    nextAction: nextAction
      ? { ...nextAction, createdAt: nextAction.createdAt.toISOString() }
      : null,
  };
}
