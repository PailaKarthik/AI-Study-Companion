import type { PrismaClient } from "@ai-study-companion/db";
import { getPrisma, isUniqueViolation } from "@ai-study-companion/db";
import { UnrecoverableError } from "bullmq";
import type { JobLogContext } from "../../processors/systemHealth.js";
import { logger } from "../../lib/logger.js";
import {
  EVALUATOR_VERSION,
  evaluateAttempt,
  evaluateQuiz,
  evaluateRecommendation,
  evaluateTutorMessage,
  type EvalScores,
} from "./evaluators.js";
import {
  aiEvaluateJobSchema,
  type AiEvaluateJobData,
  type AiEvaluateJobResult,
  type EvaluationTargetType,
} from "./job-types.js";

/**
 * `ai.evaluate` BullMQ processor. Loads the target's persisted rows,
 * runs the deterministic evaluators, and stores one AIEvaluation.
 *
 * Idempotency has two layers: the deterministic BullMQ jobId collapses
 * duplicate enqueues, and an existing row for
 * (targetType, targetId, evaluator) short-circuits reprocessing. Unknown
 * targets (deleted rows) return `target-missing` — success, not failure —
 * so dead jobs never retry forever. No LLM calls, no loops: evaluation
 * never enqueues further work.
 */

function resolveDb(): PrismaClient {
  const db = getPrisma();
  if (!db) {
    throw new UnrecoverableError("Database is not configured; cannot evaluate.");
  }
  return db;
}

function metaModel(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const model = (metadata as { model?: unknown }).model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

function metaConfidence(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const confidence = (metadata as { confidence?: unknown }).confidence;
  return typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null;
}

async function evaluateTutorMessageTarget(
  db: PrismaClient,
  messageId: string
): Promise<{
  feature: "TUTOR";
  model: string;
  scores: EvalScores;
  notes: Record<string, number>;
} | null> {
  const message = await db.message.findUnique({
    where: { id: messageId },
    select: { content: true, metadata: true },
  });
  if (!message) return null;
  const evidence = await db.tutorEvidence.findMany({
    where: { messageId },
    select: { relevanceScore: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const scores = evaluateTutorMessage({ content: message.content, evidence });
  return {
    feature: "TUTOR",
    model: metaModel(message.metadata) ?? "unknown",
    scores,
    notes: { evidenceCount: evidence.length },
  };
}

async function evaluateQuizAttemptTarget(
  db: PrismaClient,
  attemptId: string
): Promise<{
  feature: "ASSESSMENT";
  model: string;
  scores: EvalScores;
  notes: Record<string, number>;
} | null> {
  const attempt = await db.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true },
  });
  if (!attempt) return null;
  const [responses, assessments] = await Promise.all([
    db.quizResponse.findMany({
      where: { attemptId },
      select: { isCorrect: true, question: { select: { conceptId: true } } },
      take: 200,
    }),
    db.assessment.findMany({
      where: { attemptId },
      select: {
        score: true,
        relevance: true,
        reasoningQuality: true,
        evaluatorMetadata: true,
        evaluatorModel: true,
      },
      take: 200,
    }),
  ]);
  const scores = evaluateAttempt({
    responses: responses.map((r) => ({ isCorrect: r.isCorrect, conceptId: r.question.conceptId })),
    assessments: assessments.map((a) => ({
      score: a.score,
      relevance: a.relevance,
      reasoningQuality: a.reasoningQuality,
      confidence: metaConfidence(a.evaluatorMetadata),
    })),
  });
  const model = assessments.map((a) => a.evaluatorModel).find((m): m is string => !!m) ?? "unknown";
  return {
    feature: "ASSESSMENT",
    model,
    scores,
    notes: { responseCount: responses.length, assessmentCount: assessments.length },
  };
}

async function evaluateQuizTarget(
  db: PrismaClient,
  quizId: string
): Promise<{
  feature: "QUIZ_GENERATION";
  model: string;
  scores: EvalScores;
  notes: Record<string, number>;
} | null> {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: { metadata: true },
  });
  if (!quiz) return null;
  const questions = await db.quizQuestion.findMany({
    where: { quizId },
    select: { conceptId: true, difficulty: true, type: true },
    orderBy: { order: "asc" },
    take: 100,
  });
  const metadata =
    typeof quiz.metadata === "object" && quiz.metadata !== null
      ? (quiz.metadata as { mode?: unknown })
      : {};
  const scores = evaluateQuiz({
    mode: typeof metadata.mode === "string" ? metadata.mode : null,
    questions,
  });
  return {
    feature: "QUIZ_GENERATION",
    model: "unknown",
    scores,
    notes: { questionCount: questions.length },
  };
}

async function evaluateRecommendationTarget(
  db: PrismaClient,
  recommendationId: string
): Promise<{
  feature: "RECOMMENDATION";
  model: string;
  scores: EvalScores;
  notes: Record<string, number>;
} | null> {
  const rec = await db.recommendation.findUnique({ where: { id: recommendationId } });
  if (!rec) return null;
  const action =
    typeof rec.action === "object" && rec.action !== null
      ? (rec.action as { kind?: unknown; targetId?: unknown })
      : null;
  const kind = typeof action?.kind === "string" ? action.kind : null;
  const targetId = typeof action?.targetId === "string" ? action.targetId : null;
  let targetExists: boolean | null = null;
  if (kind && targetId) {
    if (kind === "PRACTICE_CONCEPT") {
      targetExists = (await db.concept.count({ where: { id: targetId } })) > 0;
    } else if (kind === "REVIEW_MATERIAL") {
      targetExists = (await db.material.count({ where: { id: targetId } })) > 0;
    } else {
      targetExists = true;
    }
  }
  const mastery = rec.conceptId
    ? await db.conceptMastery.findFirst({
        where: { conceptId: rec.conceptId, userId: rec.userId },
        select: { masteryScore: true },
      })
    : null;
  const recentMistakes = rec.conceptId
    ? await db.quizResponse.count({
        where: { userId: rec.userId, isCorrect: false, question: { conceptId: rec.conceptId } },
      })
    : 0;
  const scores = evaluateRecommendation({
    type: rec.type,
    reason: rec.reason,
    actionKind: kind,
    actionTargetExists: targetExists,
    conceptExists: rec.conceptId
      ? (await db.concept.count({ where: { id: rec.conceptId } })) > 0
      : false,
    conceptMastery: mastery?.masteryScore ?? null,
    recentMistakes: Math.min(recentMistakes, 50),
  });
  return { feature: "RECOMMENDATION", model: "unknown", scores, notes: {} };
}

export async function processAiEvaluate(
  data: unknown,
  ctx: JobLogContext
): Promise<AiEvaluateJobResult> {
  const parsed = aiEvaluateJobSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid ai.evaluate job data: ${parsed.error.message}`);
  }
  const job: AiEvaluateJobData = parsed.data;
  const db = resolveDb();

  const existing = await db.aIEvaluation.findFirst({
    where: { targetType: job.targetType, targetId: job.targetId, evaluator: EVALUATOR_VERSION },
    select: { id: true },
  });
  if (existing) {
    logger.info(
      { jobId: ctx.jobId, targetType: job.targetType, targetId: job.targetId },
      "Evaluation already exists; skipping reprocessing"
    );
    return {
      status: "skipped-existing",
      targetType: job.targetType,
      targetId: job.targetId,
      evaluationId: existing.id,
      correlationId: job.correlationId,
    };
  }

  const evaluated = await evaluateTarget(db, job.targetType, job.targetId);
  if (!evaluated) {
    logger.info(
      { jobId: ctx.jobId, targetType: job.targetType, targetId: job.targetId },
      "Evaluation target no longer exists; nothing to persist"
    );
    return {
      status: "target-missing",
      targetType: job.targetType,
      targetId: job.targetId,
      evaluationId: null,
      correlationId: job.correlationId,
    };
  }

  let created: { id: string };
  try {
    created = await db.aIEvaluation.create({
      data: {
        feature: evaluated.feature,
        model: evaluated.model,
        provider: "SYSTEM",
        targetType: job.targetType,
        targetId: job.targetId,
        scores: evaluated.scores,
        evaluator: EVALUATOR_VERSION,
        evaluatorMetadata: { notes: evaluated.notes, correlationId: job.correlationId },
      },
      select: { id: true },
    });
  } catch (error) {
    // Lost race on the target-dedupe unique index (migration 0006): a twin
    // worker committed first (crash retry, manual double-run). The
    // evaluation exists — report skipped, never duplicate, never fail.
    if (isUniqueViolation(error)) {
      const winner = await db.aIEvaluation.findFirst({
        where: { targetType: job.targetType, targetId: job.targetId, evaluator: EVALUATOR_VERSION },
        select: { id: true },
      });
      logger.warn(
        { jobId: ctx.jobId, targetType: job.targetType, targetId: job.targetId },
        "Evaluation race lost; twin committed first"
      );
      return {
        status: "skipped-existing",
        targetType: job.targetType,
        targetId: job.targetId,
        evaluationId: winner?.id ?? null,
        correlationId: job.correlationId,
      };
    }
    throw error;
  }
  logger.info(
    {
      jobId: ctx.jobId,
      targetType: job.targetType,
      targetId: job.targetId,
      evaluationId: created.id,
    },
    "AI evaluation persisted"
  );
  return {
    status: "evaluated",
    targetType: job.targetType,
    targetId: job.targetId,
    evaluationId: created.id,
    correlationId: job.correlationId,
  };
}

async function evaluateTarget(
  db: PrismaClient,
  targetType: EvaluationTargetType,
  targetId: string
) {
  switch (targetType) {
    case "tutor_message":
      return evaluateTutorMessageTarget(db, targetId);
    case "quiz_attempt":
      return evaluateQuizAttemptTarget(db, targetId);
    case "quiz":
      return evaluateQuizTarget(db, targetId);
    case "recommendation":
      return evaluateRecommendationTarget(db, targetId);
  }
}
