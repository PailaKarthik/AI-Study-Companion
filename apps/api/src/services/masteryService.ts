import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import type {
  ConceptAssessmentEvidence,
  ConceptDetailData,
  ConceptGrowth,
  ConceptMasteryDetail,
  ConceptMistake,
  GrowthData,
  GrowthTrend,
  MasteryStatus,
  RecommendationDetail,
} from "@ai-study-companion/shared";
import { config } from "../config/index.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { enqueueAIEvaluation, isQueueConfigured } from "../lib/queues.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";
import { applyEvidence, statusForScore, type EvidenceItem } from "./masteryCalculator.js";
import { analyzeGrowth } from "./growthAnalyzer.js";
import {
  buildCandidates,
  dedupeCandidates,
  fallbackCandidate,
  type RecommendationSignal,
} from "./recommendationEngine.js";

export interface MasteryServiceOptions {
  db?: PrismaClient;
}

type DbOrTx = PrismaClient | Prisma.TransactionClient;

function weights() {
  return {
    quiz: config.MASTERY_QUIZ_WEIGHT,
    openEnded: config.MASTERY_OPEN_ENDED_WEIGHT,
    activity: config.MASTERY_ACTIVITY_WEIGHT,
    tutor: config.MASTERY_TUTOR_WEIGHT,
    maxSingleWeight: config.MASTERY_MAX_SINGLE_WEIGHT,
    recencyHalfLifeDays: config.MASTERY_RECENCY_HALF_LIFE_DAYS,
    recencyFloor: config.MASTERY_RECENCY_FLOOR,
  };
}

function bands() {
  return {
    attentionBelow: config.MASTERY_ATTENTION_BELOW,
    developingBelow: config.MASTERY_DEVELOPING_BELOW,
    strongAt: config.MASTERY_STRONG_AT,
  };
}

function confidenceOf(metadata: unknown): number {
  if (typeof metadata !== "object" || metadata === null) return 0.5;
  const value = (metadata as { confidence?: unknown }).confidence;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.5;
}

// ---------------------------------------------------------------------------
// Attempt processing (the learning-loop hook)
// ---------------------------------------------------------------------------

export interface ProcessAttemptResult {
  conceptsUpdated: number;
  eventsCreated: number;
  recommendationsRefreshed: boolean;
}

interface ResponseEvidence {
  responseId: string;
  conceptId: string;
  sourceType: "QUIZ" | "OPEN_ENDED_ASSESSMENT";
  item: EvidenceItem;
}

/**
 * Fold one completed attempt's evaluated responses into per-concept
 * mastery. Called post-commit from quiz completion (and from the
 * idempotent re-complete path, where it no-ops). Extracted as a plain
 * service — no AI calls, no open transactions — so it can move to BullMQ
 * later without rewriting; see docs/LEARNING_LOOP.md.
 *
 * Idempotency: (sourceType, sourceId=responseId, conceptId) is checked
 * before writing, so re-processing never double-counts. One short
 * transaction persists each concept's MasteryEvent + ConceptMastery row
 * atomically.
 */
export async function processAttemptMastery(
  userId: string,
  attemptId: string,
  options: MasteryServiceOptions = {}
): Promise<ProcessAttemptResult> {
  const db = options.db ?? requireDb();
  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { id: true, projectId: true, userId: true, completedAt: true, quizId: true },
  });
  if (!attempt || !attempt.completedAt)
    return { conceptsUpdated: 0, eventsCreated: 0, recommendationsRefreshed: false };
  await getOwnedProjectOrThrow(userId, attempt.projectId, db);

  const responses = await db.quizResponse.findMany({
    where: { attemptId: attempt.id },
    include: {
      question: { select: { conceptId: true, difficulty: true, type: true } },
      assessment: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const evidence: ResponseEvidence[] = [];
  for (const response of responses) {
    const conceptId = response.question.conceptId;
    // Untagged questions and unevaluated answers carry no concept signal.
    if (!conceptId || response.isCorrect === null || response.score === null) continue;
    if (response.question.type === "MCQ") {
      evidence.push({
        responseId: response.id,
        conceptId,
        sourceType: "QUIZ",
        item: {
          kind: "QUIZ",
          score: response.isCorrect ? 1 : 0,
          quality: 1,
          difficulty: response.question.difficulty,
          correct: response.isCorrect,
          occurredAt: response.createdAt,
        },
      });
    } else {
      // Open-ended: the Groq score discounted by evaluator confidence —
      // uncertain AI judgment is never equivalent to a deterministic key.
      const quality = response.assessment
        ? confidenceOf(response.assessment.evaluatorMetadata)
        : 0.5;
      evidence.push({
        responseId: response.id,
        conceptId,
        sourceType: "OPEN_ENDED_ASSESSMENT",
        item: {
          kind: "OPEN_ENDED_ASSESSMENT",
          score: Math.min(1, Math.max(0, response.score)),
          quality,
          difficulty: response.question.difficulty,
          correct: response.isCorrect,
          occurredAt: response.createdAt,
        },
      });
    }
  }
  if (evidence.length === 0) {
    return { conceptsUpdated: 0, eventsCreated: 0, recommendationsRefreshed: false };
  }

  const existing = await db.masteryEvent.findMany({
    where: {
      userId,
      projectId: attempt.projectId,
      sourceType: { in: ["QUIZ", "OPEN_ENDED_ASSESSMENT"] },
      sourceId: { in: evidence.map((e) => e.responseId) },
    },
    select: { sourceType: true, sourceId: true, conceptId: true },
  });
  const seen = new Set(existing.map((e) => `${e.sourceType}::${e.sourceId}::${e.conceptId}`));
  const fresh = evidence.filter(
    (e) => !seen.has(`${e.sourceType}::${e.responseId}::${e.conceptId}`)
  );
  if (fresh.length === 0) {
    return { conceptsUpdated: 0, eventsCreated: 0, recommendationsRefreshed: false };
  }

  const byConcept = new Map<string, ResponseEvidence[]>();
  for (const item of fresh) {
    const list = byConcept.get(item.conceptId) ?? [];
    list.push(item);
    byConcept.set(item.conceptId, list);
  }

  const now = new Date();
  let eventsCreated = 0;
  const touchedConcepts: string[] = [];

  // One short transaction for the whole attempt: every concept's event +
  // row update commits together, never half-written. No AI/network inside.
  // Lost race on the new source-dedupe unique index (migration 0006) means
  // a concurrent twin already committed this attempt's events — return a
  // no-op instead of 500ing the retry.
  try {
    await db.$transaction(async (tx) => {
      for (const [conceptId, items] of byConcept) {
        const row = await tx.conceptMastery.findUnique({
          where: {
            userId_projectId_conceptId: { userId, projectId: attempt.projectId, conceptId },
          },
        });
        const out = applyEvidence({
          oldMastery: row?.masteryScore ?? 0,
          oldEvidenceCount: row?.evidenceCount ?? 0,
          evidence: items.map((i) => i.item),
          weights: weights(),
          now,
        });
        if (!out) continue;
        const previousScore = row?.masteryScore ?? null;
        const previousStatus = row ? statusForScore(row.masteryScore, bands()) : null;
        const newStatus = statusForScore(out.newMastery, bands());
        await tx.masteryEvent.createMany({
          data: items.map((item) => ({
            userId,
            projectId: attempt.projectId,
            conceptId,
            sourceType: item.sourceType,
            sourceId: item.responseId,
            previousScore,
            newScore: out.newMastery,
            delta: out.delta,
            confidence: out.confidence,
            metadata: {
              evidenceWeight: out.evidenceWeight,
              reason: out.reason,
              attemptId: attempt.id,
            },
          })),
        });
        await tx.conceptMastery.upsert({
          where: {
            userId_projectId_conceptId: { userId, projectId: attempt.projectId, conceptId },
          },
          update: {
            masteryScore: out.newMastery,
            confidence: out.confidence,
            evidenceCount: out.evidenceCount,
            lastAssessedAt: now,
            lastActivityAt: now,
          },
          create: {
            userId,
            projectId: attempt.projectId,
            conceptId,
            masteryScore: out.newMastery,
            confidence: out.confidence,
            evidenceCount: out.evidenceCount,
            lastAssessedAt: now,
            lastActivityAt: now,
          },
        });
        eventsCreated += items.length;
        touchedConcepts.push(conceptId);
        // Status-transition events fire only on real crossings, never on
        // first touch: landing in NEEDS_ATTENTION with no history is for
        // the growth analyzer to corroborate, not an instant flag.
        if (previousStatus !== "STRONG" && newStatus === "STRONG") {
          await recordActivity(tx, {
            userId,
            projectId: attempt.projectId,
            eventType: "CONCEPT_IMPROVED",
            entityType: "concept",
            entityId: conceptId,
            metadata: { previousScore, newScore: out.newMastery } as Prisma.InputJsonValue,
          });
        } else if (
          previousStatus !== null &&
          previousStatus !== "NEEDS_ATTENTION" &&
          newStatus === "NEEDS_ATTENTION"
        ) {
          await recordActivity(tx, {
            userId,
            projectId: attempt.projectId,
            eventType: "CONCEPT_NEEDS_ATTENTION",
            entityType: "concept",
            entityId: conceptId,
            metadata: { previousScore, newScore: out.newMastery } as Prisma.InputJsonValue,
          });
        }
      }

      await recordActivity(tx, {
        userId,
        projectId: attempt.projectId,
        eventType: "MASTERY_UPDATED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        metadata: {
          conceptsUpdated: touchedConcepts.length,
          eventsCreated,
        } as Prisma.InputJsonValue,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn(
        { userId, projectId: attempt.projectId, attemptId },
        "Mastery race lost: concurrent twin committed first; treating as no-op"
      );
      return { conceptsUpdated: 0, eventsCreated: 0, recommendationsRefreshed: false };
    }
    throw error;
  }

  await detectRepeatedMistakes(db, userId, attempt.projectId, touchedConcepts);
  await refreshRecommendations(userId, attempt.projectId, { db });

  logger.info(
    {
      userId,
      projectId: attempt.projectId,
      attemptId,
      conceptsUpdated: touchedConcepts.length,
      eventsCreated,
    },
    "Mastery updated from completed attempt"
  );
  return { conceptsUpdated: touchedConcepts.length, eventsCreated, recommendationsRefreshed: true };
}

// ---------------------------------------------------------------------------
// Tutor engagement markers (exposure history, not score evidence)
// ---------------------------------------------------------------------------

/**
 * Record grounded tutor engagement against linked concepts. These events
 * are deliberately score-neutral (previousScore == newScore, evidence
 * untouched): a good chat is exposure, not proof of understanding, and
 * must never inflate mastery or confidence. They exist so concept history
 * shows real engagement and growth reads see recent activity.
 * Idempotent on (TUTOR_INTERACTION, messageId, conceptId).
 */
export async function recordTutorEngagement(
  userId: string,
  projectId: string,
  messageId: string,
  conceptIds: string[],
  options: MasteryServiceOptions = {}
): Promise<number> {
  const db = options.db ?? requireDb();
  if (conceptIds.length === 0) return 0;
  await getOwnedProjectOrThrow(userId, projectId, db);

  const existing = await db.masteryEvent.findMany({
    where: { userId, projectId, sourceType: "TUTOR_INTERACTION", sourceId: messageId },
    select: { conceptId: true },
  });
  const seen = new Set(existing.map((e) => e.conceptId));
  const fresh = [...new Set(conceptIds)].filter((id) => !seen.has(id));
  if (fresh.length === 0) return 0;

  const rows = await db.conceptMastery.findMany({
    where: { userId, projectId, conceptId: { in: fresh } },
    select: { conceptId: true, masteryScore: true },
  });
  const scoreByConcept = new Map(rows.map((r) => [r.conceptId, r.masteryScore]));
  const now = new Date();

  // Same lost-race rule as processAttemptMastery: the source-dedupe
  // index makes concurrent twins safe — the loser returns 0 new rows.
  try {
    await db.$transaction(async (tx) => {
      await tx.masteryEvent.createMany({
        data: fresh.map((conceptId) => {
          const current = scoreByConcept.get(conceptId) ?? 0;
          return {
            userId,
            projectId,
            conceptId,
            sourceType: "TUTOR_INTERACTION" as const,
            sourceId: messageId,
            previousScore: current,
            newScore: current,
            delta: 0,
            confidence: null,
            metadata: { exposureOnly: true },
          };
        }),
      });
      for (const conceptId of fresh) {
        await tx.conceptMastery.upsert({
          where: { userId_projectId_conceptId: { userId, projectId, conceptId } },
          update: { lastActivityAt: now },
          create: {
            userId,
            projectId,
            conceptId,
            masteryScore: 0,
            confidence: 0,
            evidenceCount: 0,
            lastActivityAt: now,
          },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn(
        { userId, projectId, messageId },
        "Tutor-engagement race lost: concurrent twin committed first"
      );
      return 0;
    }
    throw error;
  }
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Repeated-mistake patterns → LearnerContext
// ---------------------------------------------------------------------------

/**
 * Threshold detector: ≥N incorrect responses across ≥2 distinct attempts
 * for one concept becomes a persistent REPEATED_MISTAKE context row;
 * resolved patterns are removed so context stays truthful. Single answers
 * never become traits — only recurring, multi-attempt patterns qualify.
 */
export async function detectRepeatedMistakes(
  db: PrismaClient,
  userId: string,
  projectId: string,
  conceptIds: string[]
): Promise<void> {
  if (conceptIds.length === 0) return;
  const threshold = config.MASTERY_REPEATED_MISTAKE_THRESHOLD;

  const incorrect = await db.quizResponse.findMany({
    where: {
      userId,
      projectId,
      isCorrect: false,
      question: { conceptId: { in: conceptIds } },
    },
    select: { attemptId: true, question: { select: { conceptId: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const byConcept = new Map<string, { count: number; attempts: Set<string> }>();
  for (const row of incorrect) {
    const conceptId = row.question.conceptId;
    if (!conceptId) continue;
    const entry = byConcept.get(conceptId) ?? { count: 0, attempts: new Set<string>() };
    entry.count += 1;
    entry.attempts.add(row.attemptId);
    byConcept.set(conceptId, entry);
  }

  const existing = await db.learnerContext.findMany({
    where: { userId, projectId, type: "REPEATED_MISTAKE" },
    select: { id: true, metadata: true },
  });
  const concepts = await db.concept.findMany({
    where: { projectId, id: { in: conceptIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(concepts.map((c) => [c.id, c.name]));

  for (const conceptId of conceptIds) {
    const stats = byConcept.get(conceptId);
    const qualifies = stats !== undefined && stats.count >= threshold && stats.attempts.size >= 2;
    const row = existing.find((e) => contextConceptId(e.metadata) === conceptId);
    const name = nameById.get(conceptId) ?? "a concept";
    if (qualifies && !row) {
      await db.learnerContext.create({
        data: {
          userId,
          projectId,
          type: "REPEATED_MISTAKE",
          content: `${name} is a recurring difficulty (${stats.count} incorrect across ${stats.attempts.size} attempts)`,
          metadata: { conceptId, incorrectCount: stats.count, attemptCount: stats.attempts.size },
          importance: 0.7,
        },
      });
    } else if (qualifies && row) {
      await db.learnerContext.update({
        where: { id: row.id },
        data: {
          content: `${name} is a recurring difficulty (${stats.count} incorrect across ${stats.attempts.size} attempts)`,
          metadata: { conceptId, incorrectCount: stats.count, attemptCount: stats.attempts.size },
        },
      });
    } else if (!qualifies && row) {
      await db.learnerContext.delete({ where: { id: row.id } });
    }
  }
}

function contextConceptId(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { conceptId?: unknown }).conceptId;
  return typeof value === "string" ? value : null;
}

/** Material ids persisted in generated-question sources (server-side). */
function questionMaterialIds(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const source = (metadata as { source?: unknown }).source;
  if (typeof source !== "object" || source === null) return [];
  const ids = (source as { materialIds?: unknown }).materialIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Chunk ids persisted in generated-question sources (server-side). */
function questionChunkIds(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const source = (metadata as { source?: unknown }).source;
  if (typeof source !== "object" || source === null) return [];
  const ids = (source as { chunkIds?: unknown }).chunkIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Trace retrieval chunks back to concepts through generated-question
 * sources. Only concepts the project actually quizzes on can link — a
 * chat about unassessed material produces no markers rather than guesses.
 */
export async function linkChunksToConcepts(
  db: PrismaClient,
  projectId: string,
  chunkIds: string[]
): Promise<string[]> {
  const unique = [...new Set(chunkIds.filter((id) => id.length > 0))];
  if (unique.length === 0) return [];
  const wanted = new Set(unique);
  const questions = await db.quizQuestion.findMany({
    where: { projectId, conceptId: { not: null } },
    select: { conceptId: true, metadata: true },
    take: 500,
  });
  const linked = new Set<string>();
  for (const q of questions) {
    if (!q.conceptId) continue;
    if (questionChunkIds(q.metadata).some((id) => wanted.has(id))) {
      linked.add(q.conceptId);
    }
  }
  return [...linked];
}

// ---------------------------------------------------------------------------
// Growth reads
// ---------------------------------------------------------------------------

interface ConceptSignal {
  conceptId: string;
  conceptName: string;
  masteryScore: number | null;
  evidenceCount: number;
  lastAssessedAt: Date | null;
  events: { newScore: number; createdAt: Date }[];
  recentAccuracy: number | null;
  recentIncorrect: number;
}

async function loadSignals(
  db: PrismaClient,
  userId: string,
  projectId: string
): Promise<{ concepts: { id: string; name: string }[]; signals: ConceptSignal[] }> {
  const concepts = await db.concept.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (concepts.length === 0) return { concepts, signals: [] };
  const ids = concepts.map((c) => c.id);

  const [masteryRows, events, responses] = await Promise.all([
    db.conceptMastery.findMany({
      where: { userId, projectId, conceptId: { in: ids } },
    }),
    db.masteryEvent.findMany({
      where: { userId, projectId, conceptId: { in: ids } },
      select: { conceptId: true, newScore: true, createdAt: true },
      // Newest first so the global cap keeps every concept's recent
      // history; groups are reversed back to ascending below.
      orderBy: { createdAt: "desc" },
      take: config.GROWTH_MAX_EVENTS_PER_CONCEPT * ids.length,
    }),
    db.quizResponse.findMany({
      where: { userId, projectId },
      select: {
        isCorrect: true,
        createdAt: true,
        question: { select: { conceptId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const masteryById = new Map(masteryRows.map((m) => [m.conceptId, m]));
  const eventsById = new Map<string, { newScore: number; createdAt: Date }[]>();
  for (const e of events) {
    const list = eventsById.get(e.conceptId) ?? [];
    list.push({ newScore: e.newScore, createdAt: e.createdAt });
    eventsById.set(e.conceptId, list);
  }
  for (const list of eventsById.values()) list.reverse();
  // Recent window per concept: last 10 answered responses.
  const recentById = new Map<string, { correct: number; total: number; incorrect: number }>();
  for (const r of responses) {
    const conceptId = r.question.conceptId;
    if (!conceptId || !ids.includes(conceptId)) continue;
    const entry = recentById.get(conceptId) ?? { correct: 0, total: 0, incorrect: 0 };
    if (entry.total >= 10) continue;
    entry.total += 1;
    if (r.isCorrect === true) entry.correct += 1;
    else if (r.isCorrect === false) entry.incorrect += 1;
    recentById.set(conceptId, entry);
  }

  const signals: ConceptSignal[] = concepts.map((c) => {
    const mastery = masteryById.get(c.id);
    const recent = recentById.get(c.id);
    return {
      conceptId: c.id,
      conceptName: c.name,
      masteryScore: mastery ? mastery.masteryScore : null,
      evidenceCount: mastery ? mastery.evidenceCount : 0,
      lastAssessedAt: mastery?.lastAssessedAt ?? null,
      events: eventsById.get(c.id) ?? [],
      recentAccuracy: recent && recent.total > 0 ? recent.correct / recent.total : null,
      recentIncorrect: recent ? recent.incorrect : 0,
    };
  });
  return { concepts, signals };
}

function toGrowth(signal: ConceptSignal): ConceptGrowth {
  const analysis = analyzeGrowth({
    events: signal.events,
    recentAccuracy: signal.recentAccuracy,
    recentIncorrect: signal.recentIncorrect,
    minEvents: config.GROWTH_MIN_EVENTS,
    trendDelta: config.GROWTH_TREND_DELTA,
    weakBelow: config.GROWTH_WEAK_BELOW,
    maxEvents: config.GROWTH_MAX_EVENTS_PER_CONCEPT,
  });
  const score = signal.masteryScore ?? 0;
  return {
    conceptId: signal.conceptId,
    conceptName: signal.conceptName,
    masteryScore: score,
    status: statusForScore(score, bands()),
    trend: analysis.trend,
    trendStrength: analysis.trendStrength,
    confidence: analysis.confidence,
    reasons: analysis.reasons,
    evidenceCount: signal.evidenceCount,
    lastAssessedAt: signal.lastAssessedAt ? signal.lastAssessedAt.toISOString() : null,
  };
}

/** Project growth board. Empty concept list → empty buckets (honest, never 0%). */
export async function getGrowth(
  userId: string,
  projectId: string,
  options: MasteryServiceOptions = {}
): Promise<GrowthData> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const { concepts, signals } = await loadSignals(db, userId, owned.id);
  const assessed = signals.filter((s) => s.evidenceCount > 0);
  const all = signals.map(toGrowth);
  return {
    projectId: owned.id,
    concepts: all,
    improving: all.filter((c) => c.trend === "IMPROVING"),
    stable: all.filter((c) => c.trend === "STABLE"),
    needsAttention: all.filter((c) => c.trend === "NEEDS_ATTENTION"),
    insufficientData: all.filter((c) => c.trend === "INSUFFICIENT_DATA"),
    averageMastery:
      assessed.length > 0
        ? assessed.reduce((sum, s) => sum + (s.masteryScore ?? 0), 0) / assessed.length
        : null,
    assessedConcepts: assessed.length,
    totalConcepts: concepts.length,
  };
}

function toMasteryDetail(
  signal: ConceptSignal,
  latestEvent: { previousScore: number | null; delta: number | null } | null
): ConceptMasteryDetail {
  return {
    conceptId: signal.conceptId,
    conceptName: signal.conceptName,
    masteryScore: signal.masteryScore ?? 0,
    confidence: 0,
    status: statusForScore(signal.masteryScore ?? 0, bands()),
    evidenceCount: signal.evidenceCount,
    lastAssessedAt: signal.lastAssessedAt ? signal.lastAssessedAt.toISOString() : null,
    lastActivityAt: null,
    previousScore: latestEvent?.previousScore ?? null,
    scoreChange: latestEvent?.delta ?? null,
  };
}

/** Concept detail: info + mastery + trend + history + evidence + mistakes + recs. */
export async function getConceptDetail(
  userId: string,
  projectId: string,
  conceptId: string,
  options: MasteryServiceOptions = {}
): Promise<ConceptDetailData> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const concept = await db.concept.findFirst({
    where: { id: conceptId, projectId: owned.id },
    select: { id: true, name: true, description: true, difficulty: true },
  });
  if (!concept) throw new NotFoundError("Concept not found");

  const { signals } = await loadSignals(db, userId, owned.id);
  const signal = signals.find((s) => s.conceptId === concept.id);

  const [masteryRow, history, assessments, mistakes, recommendations] = await Promise.all([
    db.conceptMastery.findUnique({
      where: { userId_projectId_conceptId: { userId, projectId: owned.id, conceptId: concept.id } },
    }),
    db.masteryEvent.findMany({
      where: { userId, projectId: owned.id, conceptId: concept.id },
      select: {
        id: true,
        previousScore: true,
        newScore: true,
        delta: true,
        sourceType: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.assessment.findMany({
      where: { userId, projectId: owned.id, conceptId: concept.id },
      select: {
        id: true,
        responseId: true,
        attemptId: true,
        score: true,
        feedback: true,
        createdAt: true,
        response: { select: { isCorrect: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.quizResponse.findMany({
      where: { userId, projectId: owned.id, isCorrect: false, question: { conceptId: concept.id } },
      select: {
        id: true,
        attemptId: true,
        score: true,
        feedback: true,
        createdAt: true,
        attempt: { select: { quizId: true } },
        question: { select: { prompt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.recommendation.findMany({
      where: { userId, projectId: owned.id, conceptId: concept.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const conceptNames = new Map([[concept.id, concept.name]]);
  const latestEvent = history[0] ?? null;
  const detail: ConceptMasteryDetail | null = signal
    ? {
        ...toMasteryDetail(signal, latestEvent),
        confidence: masteryRow?.confidence ?? 0,
        lastActivityAt: masteryRow?.lastActivityAt ? masteryRow.lastActivityAt.toISOString() : null,
      }
    : null;

  return {
    concept: {
      id: concept.id,
      name: concept.name,
      description: concept.description,
      difficulty: concept.difficulty,
    },
    mastery: detail,
    growth: signal ? toGrowth(signal) : null,
    history: [...history].reverse().map((h) => ({
      masteryEventId: h.id,
      previousScore: h.previousScore,
      newScore: h.newScore,
      delta: h.delta,
      sourceType: h.sourceType,
      createdAt: h.createdAt.toISOString(),
    })),
    recentEvidence: assessments.map((a) => ({
      assessmentId: a.id,
      responseId: a.responseId ?? "",
      attemptId: a.attemptId,
      score: a.score,
      correct: a.response?.isCorrect ?? null,
      feedback: a.feedback,
      createdAt: a.createdAt.toISOString(),
    })),
    mistakes: mistakes.map((m) => ({
      responseId: m.id,
      attemptId: m.attemptId,
      quizId: m.attempt.quizId,
      questionPrompt: m.question.prompt,
      feedback: m.feedback,
      score: m.score,
      createdAt: m.createdAt.toISOString(),
    })),
    recommendations: recommendations.map((r) => toRecommendationDetail(r, conceptNames)),
  };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

const MAX_ACTIVE_RECOMMENDATIONS = 6;

function toRecommendationDetail(
  row: {
    id: string;
    projectId: string;
    conceptId: string | null;
    type: "REVIEW" | "PRACTICE" | "EXPLORE" | "REVISIT" | "NEXT_STEP";
    title: string;
    description: string | null;
    action: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    reason: string | null;
    status: "PENDING" | "COMPLETED" | "DISMISSED" | "EXPIRED";
    createdAt: Date;
    completedAt: Date | null;
  },
  conceptNames: Map<string, string>
): RecommendationDetail {
  let action = null;
  try {
    const parsed = row.action ? (JSON.parse(row.action) as unknown) : null;
    if (parsed && typeof parsed === "object" && "kind" in parsed) {
      action = parsed as RecommendationDetail["action"];
    }
  } catch {
    action = null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    conceptId: row.conceptId,
    conceptName: row.conceptId ? (conceptNames.get(row.conceptId) ?? null) : null,
    type: row.type,
    title: row.title,
    description: row.description,
    action,
    priority: row.priority,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * Deterministic refresh: load mastery + growth + relations + recent
 * materials, rank candidates, expire stale rows, complete achieved goals,
 * persist new rows (deduped). Same state in → same rows out.
 */
export async function refreshRecommendations(
  userId: string,
  projectId: string,
  options: MasteryServiceOptions = {}
): Promise<RecommendationDetail[]> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const { concepts, signals } = await loadSignals(db, userId, owned.id);

  const growthById = new Map(signals.map((s) => [s.conceptId, toGrowth(s)]));
  const weakIds = new Set(
    [...growthById]
      .filter(
        ([, g]) => g.trend === "NEEDS_ATTENTION" || g.masteryScore < config.MASTERY_ATTENTION_BELOW
      )
      .map(([id]) => id)
  );

  const [relations, pending, questions] = await Promise.all([
    db.conceptRelation.findMany({
      where: { projectId: owned.id },
      select: { fromConceptId: true, toConceptId: true, type: true },
      take: 200,
    }),
    db.recommendation.findMany({
      where: { userId, projectId: owned.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    db.quizQuestion.findMany({
      where: { projectId: owned.id, conceptId: { in: concepts.map((c) => c.id) } },
      select: { conceptId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // Latest material per concept, traced through generated-question
  // sources (QuizQuestion.metadata.source.materialIds — server-persisted,
  // never client input). Guarantees REVIEW_MATERIAL targets exist.
  const materialByConcept = new Map<string, { id: string; name: string }>();
  const materialIds = [
    ...new Set(questions.flatMap((q) => questionMaterialIds(q.metadata)).slice(0, 100)),
  ];
  const materials =
    materialIds.length > 0
      ? await db.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, filename: true },
        })
      : [];
  const materialNameById = new Map(materials.map((m) => [m.id, m.filename]));
  for (const q of questions) {
    if (!q.conceptId || materialByConcept.has(q.conceptId)) continue;
    const sourceId = questionMaterialIds(q.metadata)[0];
    const name = sourceId ? materialNameById.get(sourceId) : undefined;
    if (sourceId && name) materialByConcept.set(q.conceptId, { id: sourceId, name });
  }

  const prereqSupport = new Map<string, string>();
  const blockedBy = new Map<string, string>();
  const related = new Map<string, { id: string; name: string }[]>();
  const nameById = new Map(concepts.map((c) => [c.id, c.name]));
  for (const rel of relations) {
    if (rel.type === "PREREQUISITE" && weakIds.has(rel.toConceptId)) {
      if (!prereqSupport.has(rel.fromConceptId)) {
        prereqSupport.set(rel.fromConceptId, nameById.get(rel.toConceptId) ?? "a concept");
      }
      if (!blockedBy.has(rel.toConceptId)) {
        blockedBy.set(rel.toConceptId, nameById.get(rel.fromConceptId) ?? "a concept");
      }
    }
    if (!weakIds.has(rel.toConceptId)) {
      const list = related.get(rel.fromConceptId) ?? [];
      const target = nameById.get(rel.toConceptId);
      if (target && !list.some((r) => r.id === rel.toConceptId)) {
        list.push({ id: rel.toConceptId, name: target });
      }
      related.set(rel.fromConceptId, list);
    }
  }

  const engineSignals: RecommendationSignal[] = signals.map((s) => {
    const g = growthById.get(s.conceptId);
    const material = materialByConcept.get(s.conceptId);
    return {
      conceptId: s.conceptId,
      conceptName: s.conceptName,
      masteryScore: s.masteryScore,
      evidenceCount: s.evidenceCount,
      trend: g?.trend ?? "INSUFFICIENT_DATA",
      trendStrength: g?.trendStrength ?? 0,
      recentIncorrect: s.recentIncorrect,
      recentAccuracy: s.recentAccuracy,
      supportsWeakConcept: prereqSupport.has(s.conceptId),
      supportsConceptName: prereqSupport.get(s.conceptId) ?? null,
      blockedByPrereqName: blockedBy.get(s.conceptId) ?? null,
      materialId: material?.id ?? null,
      materialName: material?.name ?? null,
      relatedConcepts: (related.get(s.conceptId) ?? []).slice(0, 3),
    };
  });

  let candidates = buildCandidates(engineSignals, {
    strongAt: config.MASTERY_STRONG_AT,
    attentionBelow: config.MASTERY_ATTENTION_BELOW,
    developingBelow: config.MASTERY_DEVELOPING_BELOW,
  });
  const fallback = fallbackCandidate(concepts.length > 0);
  if (candidates.length === 0 && fallback) candidates = [fallback];
  // Staleness is judged against the rebuilt set BEFORE dedup: a pending
  // row whose twin was deduped away is still valid and must be kept.
  const rebuiltKeys = new Set(candidates.map((c) => `${c.type}::${c.conceptId ?? ""}`));
  candidates = dedupeCandidates(
    candidates,
    pending.map((p) => ({ conceptId: p.conceptId, type: p.type }))
  ).slice(0, MAX_ACTIVE_RECOMMENDATIONS);

  const now = new Date();
  const freshKeys = rebuiltKeys;
  const createdRecommendationIds: string[] = [];

  await db.$transaction(async (tx) => {
    // Stale lifecycle: mastered goals complete; superseded rows expire.
    for (const row of pending) {
      const mastery = row.conceptId
        ? (signals.find((s) => s.conceptId === row.conceptId)?.masteryScore ?? null)
        : null;
      if (row.conceptId && mastery !== null && mastery >= config.MASTERY_STRONG_AT) {
        await tx.recommendation.update({
          where: { id: row.id },
          data: { status: "COMPLETED", completedAt: now },
        });
        await recordActivity(tx, {
          userId,
          projectId: owned.id,
          eventType: "RECOMMENDATION_COMPLETED",
          entityType: "recommendation",
          entityId: row.id,
          metadata: { reason: "concept-mastered" } as Prisma.InputJsonValue,
        });
      } else if (!freshKeys.has(`${row.type}::${row.conceptId ?? ""}`)) {
        await tx.recommendation.update({
          where: { id: row.id },
          data: { status: "EXPIRED" },
        });
        await recordActivity(tx, {
          userId,
          projectId: owned.id,
          eventType: "RECOMMENDATION_COMPLETED",
          entityType: "recommendation",
          entityId: row.id,
          metadata: { reason: "superseded" } as Prisma.InputJsonValue,
        });
      }
    }

    for (const candidate of candidates) {
      const created = await tx.recommendation.create({
        data: {
          userId,
          projectId: owned.id,
          conceptId: candidate.conceptId,
          type: candidate.type,
          title: candidate.title,
          description: candidate.description,
          action: JSON.stringify(candidate.action),
          priority: candidate.priority,
          reason: candidate.reason,
          status: "PENDING",
          evidence: { refreshedAt: now.toISOString() },
        },
        select: { id: true },
      });
      await recordActivity(tx, {
        userId,
        projectId: owned.id,
        eventType: "RECOMMENDATION_CREATED",
        entityType: "recommendation",
        entityId: created.id,
        metadata: { type: candidate.type } as Prisma.InputJsonValue,
      });
      createdRecommendationIds.push(created.id);
    }

    await recordActivity(tx, {
      userId,
      projectId: owned.id,
      eventType: "GROWTH_ANALYZED",
      entityType: "project",
      entityId: owned.id,
      metadata: { concepts: concepts.length } as Prisma.InputJsonValue,
    });
  });

  // Recommendation quality evaluations run async — bounded (only rows
  // created above), best-effort, never blocking the refresh response.
  if (isQueueConfigured()) {
    for (const id of createdRecommendationIds) {
      await enqueueAIEvaluation("recommendation", id, `recommendation-${id}`).catch(
        (error: unknown) =>
          logger.warn(
            {
              recommendationId: id,
              error: error instanceof Error ? error.message : String(error),
            },
            "AI evaluation enqueue skipped"
          )
      );
    }
  }

  return listRecommendations(userId, owned.id, { db });
}

export async function listRecommendations(
  userId: string,
  projectId: string,
  options: MasteryServiceOptions = {}
): Promise<RecommendationDetail[]> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const [rows, concepts] = await Promise.all([
    db.recommendation.findMany({
      where: { userId, projectId: owned.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.concept.findMany({ where: { projectId: owned.id }, select: { id: true, name: true } }),
  ]);
  const names = new Map(concepts.map((c) => [c.id, c.name]));
  const rank: Record<RecommendationDetail["priority"], number> = {
    URGENT: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  return rows
    .map((r) => toRecommendationDetail(r, names))
    .sort((a, b) => rank[a.priority] - rank[b.priority]);
}

async function resolveRecommendation(userId: string, recommendationId: string, db: PrismaClient) {
  const row = await db.recommendation.findFirst({
    where: { id: recommendationId, userId },
  });
  if (!row) throw new NotFoundError("Recommendation not found");
  await getOwnedProjectOrThrow(userId, row.projectId, db);
  if (row.status !== "PENDING") {
    throw new ConflictError(`Recommendation is already ${row.status.toLowerCase()}`);
  }
  return row;
}

export async function completeRecommendation(
  userId: string,
  recommendationId: string,
  options: MasteryServiceOptions = {}
): Promise<RecommendationDetail> {
  const db = options.db ?? requireDb();
  const row = await resolveRecommendation(userId, recommendationId, db);
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.recommendation.update({
      where: { id: row.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await recordActivity(tx, {
      userId,
      projectId: row.projectId,
      eventType: "RECOMMENDATION_COMPLETED",
      entityType: "recommendation",
      entityId: row.id,
      metadata: { by: "learner" } as Prisma.InputJsonValue,
    });
    return next;
  });
  const concepts = await db.concept.findMany({
    where: { projectId: row.projectId },
    select: { id: true, name: true },
  });
  return toRecommendationDetail(updated, new Map(concepts.map((c) => [c.id, c.name])));
}

export async function dismissRecommendation(
  userId: string,
  recommendationId: string,
  options: MasteryServiceOptions = {}
): Promise<RecommendationDetail> {
  const db = options.db ?? requireDb();
  const row = await resolveRecommendation(userId, recommendationId, db);
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.recommendation.update({
      where: { id: row.id },
      data: { status: "DISMISSED" },
    });
    await recordActivity(tx, {
      userId,
      projectId: row.projectId,
      eventType: "RECOMMENDATION_DISMISSED",
      entityType: "recommendation",
      entityId: row.id,
      metadata: { by: "learner" } as Prisma.InputJsonValue,
    });
    return next;
  });
  const concepts = await db.concept.findMany({
    where: { projectId: row.projectId },
    select: { id: true, name: true },
  });
  return toRecommendationDetail(updated, new Map(concepts.map((c) => [c.id, c.name])));
}
