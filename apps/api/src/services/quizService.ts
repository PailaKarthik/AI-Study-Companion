import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import type {
  AttemptQuestionState,
  AttemptState,
  ConceptDifficulty,
  ConceptPerformance,
  OpenEndedReview,
  QuizDetail,
  QuizResult,
  QuizSummary,
  SafeQuizQuestion,
} from "@ai-study-companion/shared";
import type { CreateQuizInput } from "@ai-study-companion/validation";
import { AppError, ConflictError, NotFoundError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { enqueueAIEvaluation, isQueueConfigured } from "../lib/queues.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";
import { ensureConcepts } from "./conceptExtraction.js";
import { evaluateOpenEnded } from "./quizEvaluation.js";
import { processAttemptMastery } from "./masteryService.js";
import { normalizePrompt, generateQuestions, fitDraftsToCount } from "./questionGenerator.js";
import { selectTargets, type ConceptSignalInput } from "./quizAdaptive.js";
import { recordQuizUsage, resolveQuizChat, __setQuizChatForTests } from "./quizLlm.js";
import type { ChatCompletionProvider, EmbeddingProvider } from "@ai-study-companion/ai";
import { isTimeoutError } from "@ai-study-companion/ai";

export type { ChatCompletionProvider };
export { __setQuizChatForTests };

export interface QuizServiceOptions {
  db?: PrismaClient;
  requestId?: string;
  chat?: ChatCompletionProvider | null;
  embedder?: EmbeddingProvider | null;
}

type DbOrTx = PrismaClient | Prisma.TransactionClient;

interface OwnedQuiz {
  id: string;
  projectId: string;
  spaceId: string;
  title: string;
}

/** Sentinel: a concurrent twin claimed the attempt first (see completeAttempt). */
class CompletionRacedError extends Error {
  constructor() {
    super("Attempt was completed concurrently");
    this.name = "CompletionRacedError";
  }
}

async function getOwnedQuizOrThrow(
  userId: string,
  quizId: string,
  db: Pick<PrismaClient, "quiz">
): Promise<OwnedQuiz> {
  // Atomic ownership filter (id + project.ownerId in one WHERE) — no
  // fetch-then-check window, and the outcome is still a uniform 404.
  const quiz = await db.quiz.findFirst({
    where: { id: quizId, project: { ownerId: userId } },
    select: {
      id: true,
      title: true,
      project: { select: { id: true, ownerId: true, spaceId: true } },
    },
  });
  if (!quiz) {
    throw new NotFoundError("Quiz not found");
  }
  return {
    id: quiz.id,
    projectId: quiz.project.id,
    spaceId: quiz.project.spaceId,
    title: quiz.title,
  };
}

// ---------------------------------------------------------------------------
// Sanitizers (answer-key protection)
// ---------------------------------------------------------------------------

interface QuestionRow {
  id: string;
  type: "MCQ" | "OPEN_ENDED";
  prompt: string;
  options: unknown;
  correctAnswer: string | null;
  explanation: string | null;
  conceptId: string | null;
  difficulty: ConceptDifficulty | null;
  order: number;
  metadata: unknown;
  concept: { id: string; name: string } | null;
}

function optionsArray(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  const items = options.filter((o): o is string => typeof o === "string");
  return items.length > 0 ? items : null;
}

function toSafeQuestion(row: QuestionRow): SafeQuizQuestion {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    options: row.type === "MCQ" ? optionsArray(row.options) : null,
    conceptId: row.conceptId,
    conceptName: row.concept?.name ?? null,
    difficulty: row.difficulty,
    order: row.order,
  };
}

function keyPointsOf(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const points = (metadata as { keyPoints?: unknown }).keyPoints;
  return Array.isArray(points) ? points.filter((p): p is string => typeof p === "string") : [];
}

function evaluationStateOf(metadata: unknown): AttemptQuestionState["evaluationState"] {
  if (typeof metadata !== "object" || metadata === null) return null;
  const state = (metadata as { evaluationState?: unknown }).evaluationState;
  return state === "EVALUATED" || state === "EVALUATION_FAILED" || state === "PENDING_EVALUATION"
    ? state
    : null;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

const MODE_LABEL: Record<CreateQuizInput["mode"], string> = {
  ADAPTIVE: "Adaptive quiz",
  CONCEPT_FOCUS: "Focused quiz",
  MIXED_REVIEW: "Review quiz",
};

async function buildSignals(
  db: PrismaClient,
  userId: string,
  projectId: string,
  conceptIds: string[]
): Promise<ConceptSignalInput[]> {
  const [masteryRows, responses, relations] = await Promise.all([
    db.conceptMastery.findMany({ where: { userId, projectId } }),
    db.quizResponse.findMany({
      where: { userId, projectId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        isCorrect: true,
        score: true,
        createdAt: true,
        question: { select: { conceptId: true } },
      },
    }),
    db.conceptRelation.findMany({
      where: { projectId, type: "PREREQUISITE" },
      select: { fromConceptId: true, toConceptId: true },
    }),
  ]);
  const masteryByConcept = new Map(masteryRows.map((m) => [m.conceptId, m.masteryScore]));

  const byConcept = new Map<
    string,
    { correct: number; total: number; recent: { correct: boolean; at: Date }[] }
  >();
  for (const response of responses) {
    const conceptId = response.question.conceptId;
    if (!conceptId || !conceptIds.includes(conceptId)) continue;
    const entry = byConcept.get(conceptId) ?? { correct: 0, total: 0, recent: [] };
    entry.total += 1;
    if (response.isCorrect === true) entry.correct += 1;
    if (entry.recent.length < 5) {
      entry.recent.push({ correct: response.isCorrect === true, at: response.createdAt });
    }
    byConcept.set(conceptId, entry);
  }

  const accuracyByConcept = new Map<string, number>();
  for (const [conceptId, entry] of byConcept) {
    accuracyByConcept.set(conceptId, entry.total > 0 ? entry.correct / entry.total : 0);
  }
  const weak = new Set(
    [...accuracyByConcept].filter(([, accuracy]) => accuracy < 0.6).map(([id]) => id)
  );
  const supportsWeak = new Set(
    relations.filter((r) => weak.has(r.toConceptId)).map((r) => r.fromConceptId)
  );

  const now = Date.now();
  return conceptIds.map((conceptId) => {
    const entry = byConcept.get(conceptId);
    const recent = entry?.recent ?? [];
    return {
      conceptId,
      name: "",
      masteryScore: masteryByConcept.get(conceptId) ?? null,
      accuracy: entry && entry.total > 0 ? entry.correct / entry.total : null,
      recentIncorrect: recent.filter((r) => !r.correct).length,
      recentCorrect: recent.filter((r) => r.correct).length,
      isNew: !entry || entry.total === 0,
      supportsWeakConcept: supportsWeak.has(conceptId),
      msSinceLastAnswered: recent.length > 0 ? now - (recent[0]?.at.getTime() ?? now) : null,
    };
  });
}

/**
 * Adaptive quiz creation: ensure concepts → score signals → select targets →
 * grounded batch generation → validated persist. Throws 400 when the
 * project has no indexed knowledge (honest, never an empty quiz) and 503
 * when the AI service is unconfigured.
 */
export async function createQuiz(
  userId: string,
  projectId: string,
  input: CreateQuizInput,
  options: QuizServiceOptions = {}
): Promise<QuizDetail> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);

  if (input.conceptIds && input.conceptIds.length > 0) {
    const matched = await db.concept.count({
      where: { projectId: owned.id, id: { in: input.conceptIds } },
    });
    if (matched !== input.conceptIds.length) {
      throw new NotFoundError("Concept not found");
    }
  }

  const concepts = await ensureConcepts({
    db,
    userId,
    projectId: owned.id,
    requestId: options.requestId,
    chat: options.chat,
  });
  if (concepts.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no indexed materials yet. Upload and process documents before generating a quiz."
    );
  }
  const inScope =
    input.mode === "CONCEPT_FOCUS" && input.conceptIds
      ? concepts.filter((c) => input.conceptIds?.includes(c.id))
      : concepts;
  if (inScope.length === 0) {
    throw new NotFoundError("Concept not found");
  }

  const nameById = new Map(inScope.map((c) => [c.id, c.name]));
  const signals = (
    await buildSignals(
      db,
      userId,
      owned.id,
      inScope.map((c) => c.id)
    )
  ).map((s) => ({ ...s, name: nameById.get(s.conceptId) ?? s.conceptId }));
  const targets = selectTargets({
    concepts: signals,
    count: input.questionCount,
    typePreference: input.typePreference,
    difficulty: input.difficulty ?? null,
    conceptIds: input.mode === "CONCEPT_FOCUS" ? inScope.map((c) => c.id) : undefined,
  });

  const existingPrompts = new Set(
    (
      await db.quizQuestion.findMany({
        where: { projectId: owned.id },
        select: { prompt: true },
      })
    ).map((q) => normalizePrompt(q.prompt))
  );

  const descriptionByConcept = new Map(inScope.map((c) => [c.id, c.description]));
  const generated = await generateQuestions({
    db,
    userId,
    projectId: owned.id,
    targets: targets.map((t) => ({
      conceptId: t.conceptId,
      conceptName: t.conceptName,
      conceptDescription: descriptionByConcept.get(t.conceptId) ?? null,
      difficulty: t.difficulty,
      type: t.type,
    })),
    existingPrompts,
    requestId: options.requestId,
    chat: options.chat,
    embedder: options.embedder,
  });
  // Hard guarantee: never persist more than requested, even if the model
  // ignored its per-batch count. Shortfalls stay honest (metadata records
  // both numbers and the UI shows the real generated count).
  const drafts = fitDraftsToCount(generated, input.questionCount);
  if (drafts.length === 0) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Question generation failed. Please try again in a moment."
    );
  }

  const title =
    input.title?.trim() || `${MODE_LABEL[input.mode]} · ${new Date().toISOString().slice(0, 10)}`;
  const chat = resolveQuizChat(options.chat);
  const quiz = await db.$transaction(async (tx) => {
    const created = await tx.quiz.create({
      data: {
        projectId: owned.id,
        createdById: userId,
        title,
        description: input.description ?? null,
        status: "PUBLISHED",
        metadata: {
          mode: input.mode,
          requestedCount: input.questionCount,
          generatedCount: drafts.length,
        },
      },
      select: { id: true },
    });
    await tx.quizQuestion.createMany({
      data: drafts.map((draft, index) => ({
        quizId: created.id,
        projectId: owned.id,
        conceptId: draft.conceptId,
        type: draft.type,
        prompt: draft.prompt,
        options: draft.options ?? undefined,
        correctAnswer: draft.correctAnswer,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
        order: index,
        metadata: {
          keyPoints: draft.keyPoints,
          source: draft.source,
          generationModel: chat?.model ?? "unknown",
        },
      })),
    });
    await recordActivity(tx, {
      userId,
      spaceId: owned.spaceId,
      projectId: owned.id,
      eventType: "QUIZ_CREATED",
      entityType: "quiz",
      entityId: created.id,
      metadata: { questionCount: drafts.length, mode: input.mode },
    });
    return created;
  });

  const detail = await getQuiz(userId, quiz.id, { ...options, db });
  // Generation quality evaluation runs async in the worker — never blocks creation.
  if (isQueueConfigured()) {
    await enqueueAIEvaluation("quiz", quiz.id, `quiz-${quiz.id}`).catch((error: unknown) =>
      logger.warn(
        { quizId: quiz.id, error: error instanceof Error ? error.message : String(error) },
        "AI evaluation enqueue skipped"
      )
    );
  }
  return detail;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ConceptListItem {
  id: string;
  name: string;
  description: string | null;
  difficulty: ConceptDifficulty | null;
}

/** Project concepts for quiz focus selection (no mastery here — Prompt 10). */
export async function listConcepts(
  userId: string,
  projectId: string,
  options: QuizServiceOptions = {}
): Promise<ConceptListItem[]> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const concepts = await db.concept.findMany({
    where: { projectId: owned.id },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, description: true, difficulty: true },
  });
  return concepts.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    difficulty: c.difficulty as ConceptDifficulty | null,
  }));
}

export async function listQuizzes(
  userId: string,
  projectId: string,
  options: QuizServiceOptions = {}
): Promise<QuizSummary[]> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const quizzes = await db.quiz.findMany({
    where: { projectId: owned.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { questions: true, attempts: true } } },
  });
  const attempts = await db.quizAttempt.findMany({
    where: { projectId: owned.id, userId, quizId: { in: quizzes.map((q) => q.id) } },
    orderBy: { createdAt: "desc" },
  });
  const latestByQuiz = new Map<string, (typeof attempts)[number]>();
  for (const attempt of [...attempts].reverse()) {
    latestByQuiz.set(attempt.quizId, attempt);
  }
  return quizzes.map((q) => {
    const latest = latestByQuiz.get(q.id);
    const mode =
      typeof q.metadata === "object" && q.metadata !== null
        ? ((q.metadata as { mode?: unknown }).mode as QuizSummary["mode"] | undefined)
        : undefined;
    return {
      id: q.id,
      projectId: q.projectId,
      title: q.title,
      description: q.description,
      status: q.status,
      mode: mode ?? "ADAPTIVE",
      questionCount: q._count.questions,
      attemptCount: q._count.attempts,
      latestAttempt: latest
        ? {
            id: latest.id,
            status: latest.completedAt ? "COMPLETED" : "ACTIVE",
            score: latest.score,
            completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
            startedAt: latest.startedAt.toISOString(),
          }
        : null,
      createdAt: q.createdAt.toISOString(),
    };
  });
}

export async function getQuiz(
  userId: string,
  quizId: string,
  options: QuizServiceOptions = {}
): Promise<QuizDetail> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedQuizOrThrow(userId, quizId, db);
  const quiz = await db.quiz.findUniqueOrThrow({
    where: { id: owned.id },
    include: {
      questions: {
        orderBy: { order: "asc" },
        include: { concept: { select: { id: true, name: true } } },
      },
    },
  });
  const mode =
    typeof quiz.metadata === "object" && quiz.metadata !== null
      ? ((quiz.metadata as { mode?: unknown }).mode as QuizDetail["mode"] | undefined)
      : undefined;
  const meta = (quiz.metadata ?? {}) as { requestedCount?: unknown; generatedCount?: unknown };
  const generatedCount = quiz.questions.length;
  return {
    id: quiz.id,
    projectId: quiz.projectId,
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    mode: mode ?? "ADAPTIVE",
    questions: quiz.questions.map((q) =>
      toSafeQuestion({ ...q, difficulty: q.difficulty as ConceptDifficulty | null })
    ),
    createdAt: quiz.createdAt.toISOString(),
    requestedCount:
      typeof meta.requestedCount === "number" ? meta.requestedCount : generatedCount,
    generatedCount:
      typeof meta.generatedCount === "number" ? meta.generatedCount : generatedCount,
  };
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

async function toAttemptState(
  db: PrismaClient,
  attempt: {
    id: string;
    quizId: string;
    projectId: string;
    score: number | null;
    startedAt: Date;
    completedAt: Date | null;
  }
): Promise<AttemptState> {
  const questions = await db.quizQuestion.findMany({
    where: { quizId: attempt.quizId },
    orderBy: { order: "asc" },
    include: { concept: { select: { id: true, name: true } } },
  });
  const responses = await db.quizResponse.findMany({
    where: { attemptId: attempt.id },
  });
  const responseByQuestion = new Map(responses.map((r) => [r.questionId, r]));
  const states: AttemptQuestionState[] = questions.map((q) => {
    const response = responseByQuestion.get(q.id);
    const answered = !!response;
    return {
      ...toSafeQuestion({ ...q, difficulty: q.difficulty as ConceptDifficulty | null }),
      answered,
      selectedOption: response?.selectedOption ?? null,
      responseText: response?.responseText ?? null,
      isCorrect: response?.isCorrect ?? null,
      score: response?.score ?? null,
      // Answer key joins ONLY after this question is answered — and as
      // an absent key (not null) before that, so unanswered payloads
      // never even name the field.
      ...(answered ? { correctAnswer: q.correctAnswer ?? null } : {}),
      feedback: answered ? (response?.feedback ?? null) : null,
      explanation: answered ? (q.explanation ?? null) : null,
      evaluationState: response ? evaluationStateOf(response.metadata) : null,
    };
  });
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    projectId: attempt.projectId,
    status: attempt.completedAt ? "COMPLETED" : "ACTIVE",
    questions: states,
    answeredCount: states.filter((s) => s.answered).length,
    questionCount: states.length,
    score: attempt.score,
    startedAt: attempt.startedAt.toISOString(),
    completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
  };
}

async function getOwnedAttemptOrThrow(
  userId: string,
  attemptId: string,
  db: PrismaClient
): Promise<{ id: string; quizId: string; projectId: string; userId: string }> {
  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { id: true, quizId: true, projectId: true, userId: true },
  });
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }
  await getOwnedProjectOrThrow(userId, attempt.projectId, db);
  return attempt;
}

export async function startAttempt(
  userId: string,
  quizId: string,
  input: { restart?: boolean; idempotencyKey?: string },
  options: QuizServiceOptions = {}
): Promise<AttemptState> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedQuizOrThrow(userId, quizId, db);

  if (input.idempotencyKey) {
    const replayed = await db.quizAttempt.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replayed) {
      if (replayed.userId !== userId || replayed.quizId !== owned.id) {
        throw new NotFoundError("Attempt not found");
      }
      const full = await db.quizAttempt.findUniqueOrThrow({ where: { id: replayed.id } });
      return toAttemptState(db, full);
    }
  }

  if (!input.restart) {
    const active = await db.quizAttempt.findFirst({
      where: { quizId: owned.id, userId, completedAt: null },
      orderBy: { createdAt: "desc" },
    });
    // Resume: never strand a learner on refresh — the active attempt IS the state.
    if (active) return toAttemptState(db, active);
  }

  const questionCount = await db.quizQuestion.count({ where: { quizId: owned.id } });
  try {
    const created = await db.$transaction(async (tx) => {
      const attempt = await tx.quizAttempt.create({
        data: {
          quizId: owned.id,
          projectId: owned.projectId,
          userId,
          maxScore: questionCount,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: owned.projectId,
        eventType: "QUIZ_STARTED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        metadata: { quizId: owned.id },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: owned.projectId,
        eventType: "QUIZ_ATTEMPT_STARTED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        metadata: { quizId: owned.id },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: owned.projectId,
        eventType: "ASSESSMENT_STARTED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        metadata: { quizId: owned.id },
      });
      return attempt;
    });
    return toAttemptState(db, created);
  } catch (error) {
    // Lost race on the idempotency key → return the winner's attempt.
    if (
      input.idempotencyKey &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      const winner = await db.quizAttempt.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (winner.userId !== userId || winner.quizId !== owned.id) {
        throw new NotFoundError("Attempt not found");
      }
      return toAttemptState(db, winner);
    }
    throw error;
  }
}

export async function getAttempt(
  userId: string,
  attemptId: string,
  options: QuizServiceOptions = {}
): Promise<AttemptState> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedAttemptOrThrow(userId, attemptId, db);
  const full = await db.quizAttempt.findUniqueOrThrow({ where: { id: owned.id } });
  return toAttemptState(db, full);
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface SubmitResponseInput {
  questionId: string;
  selectedOption?: string;
  responseText?: string;
}

function samePayload(
  existing: { selectedOption: string | null; responseText: string | null },
  input: SubmitResponseInput
): boolean {
  return (
    (existing.selectedOption ?? undefined) === input.selectedOption &&
    (existing.responseText ?? undefined) === input.responseText
  );
}

/**
 * Answer submission. MCQ is evaluated deterministically against the stored
 * answer key (the model is never asked "was this correct?"). Open-ended
 * answers persist first, then evaluate synchronously: a failed evaluation
 * keeps the answer with EVALUATION_FAILED so an identical resubmission
 * retries without losing work. Duplicate identical submissions are
 * idempotent; changed answers on answered questions are rejected.
 */
export async function submitResponse(
  userId: string,
  attemptId: string,
  input: SubmitResponseInput,
  options: QuizServiceOptions = {}
): Promise<AttemptQuestionState> {
  const db = options.db ?? requireDb();
  const attemptRef = await getOwnedAttemptOrThrow(userId, attemptId, db);
  const attempt = await db.quizAttempt.findUniqueOrThrow({ where: { id: attemptRef.id } });
  if (attempt.completedAt) {
    throw new ConflictError("This attempt is already completed");
  }

  const question = await db.quizQuestion.findFirst({
    where: { id: input.questionId, quizId: attempt.quizId },
    include: { concept: { select: { id: true, name: true } } },
  });
  // The question must belong to this attempt's quiz — client ids are verified.
  if (!question) {
    throw new NotFoundError("Question not found");
  }

  const existing = await db.quizResponse.findUnique({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
  });
  if (existing) {
    if (samePayload(existing, input)) {
      // Idempotent retry: identical resubmission re-runs a failed
      // evaluation, otherwise returns the stored outcome.
      if (
        evaluationStateOf(existing.metadata) === "EVALUATION_FAILED" &&
        question.type === "OPEN_ENDED"
      ) {
        await evaluateOpenEndedResponse(db, userId, attempt, question, existing, options);
      }
      const state = await toAttemptState(db, attempt);
      const answered = state.questions.find((q) => q.id === question.id);
      if (!answered) throw new NotFoundError("Question not found");
      return answered;
    }
    throw new ConflictError("This question has already been answered in this attempt");
  }

  if (question.type === "MCQ") {
    if (input.selectedOption === undefined || input.responseText !== undefined) {
      throw new AppError("VALIDATION_ERROR", "MCQ answers require selectedOption");
    }
    const choices = optionsArray(question.options) ?? [];
    const normalized = input.selectedOption.trim();
    if (!choices.some((c) => c.trim() === normalized)) {
      throw new AppError("VALIDATION_ERROR", "Selected option is not one of the question options");
    }
    const correct = (question.correctAnswer ?? "").trim() === normalized;
    const created = await db.$transaction(async (tx) => {
      const response = await tx.quizResponse.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          projectId: attempt.projectId,
          userId,
          selectedOption: normalized,
          isCorrect: correct,
          score: correct ? 1 : 0,
          feedback: correct ? "Correct." : (question.explanation ?? "Incorrect."),
          evaluatedAt: new Date(),
          metadata: { evaluationState: "EVALUATED", method: "answer-key" },
        },
      });
      await tx.assessment.create({
        data: {
          attemptId: attempt.id,
          responseId: response.id,
          userId,
          projectId: attempt.projectId,
          conceptId: question.conceptId,
          score: correct ? 1 : 0,
          accuracy: correct ? 1 : 0,
          feedback: response.feedback,
          evaluatorModel: "system-deterministic",
          evaluatorMetadata: { questionId: question.id, method: "answer-key" },
        },
      });
      await recordActivity(tx, {
        userId,
        spaceId: (await getOwnedQuizOrThrow(userId, attempt.quizId, tx)).spaceId,
        projectId: attempt.projectId,
        eventType: "QUIZ_QUESTION_ANSWERED",
        entityType: "quiz_response",
        entityId: response.id,
        metadata: { quizId: attempt.quizId, attemptId: attempt.id },
      });
      return response;
    });
    void created;
  } else {
    if (input.responseText === undefined || input.selectedOption !== undefined) {
      throw new AppError("VALIDATION_ERROR", "Open-ended answers require responseText");
    }
    const created = await db.quizResponse.create({
      data: {
        attemptId: attempt.id,
        questionId: question.id,
        projectId: attempt.projectId,
        userId,
        responseText: input.responseText.trim(),
        metadata: { evaluationState: "PENDING_EVALUATION" },
      },
    });
    await recordActivity(db, {
      userId,
      projectId: attempt.projectId,
      eventType: "QUIZ_QUESTION_ANSWERED",
      entityType: "quiz_response",
      entityId: created.id,
      metadata: { quizId: attempt.quizId, attemptId: attempt.id },
    });
    await evaluateOpenEndedResponse(db, userId, attempt, question, created, options);
  }

  const state = await toAttemptState(db, attempt);
  const answered = state.questions.find((q) => q.id === question.id);
  if (!answered) throw new NotFoundError("Question not found");
  return answered;
}

interface ResponseRef {
  id: string;
  responseText: string | null;
}

async function evaluateOpenEndedResponse(
  db: PrismaClient,
  userId: string,
  attempt: { id: string; quizId: string; projectId: string },
  question: {
    id: string;
    prompt: string;
    metadata: unknown;
    conceptId: string | null;
  },
  response: ResponseRef,
  options: QuizServiceOptions
): Promise<void> {
  const chat = resolveQuizChat(options.chat);
  const startedAt = Date.now();
  if (!chat) {
    await db.quizResponse.update({
      where: { id: response.id },
      data: {
        metadata: { evaluationState: "EVALUATION_FAILED", error: "AI service not configured" },
      },
    });
    await recordQuizUsage(db, {
      userId,
      projectId: attempt.projectId,
      feature: "ASSESSMENT",
      provider: "GROQ",
      model: "unconfigured",
      requestId: options.requestId,
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      status: "FAILED",
      error: "GROQ_API_KEY missing",
      metadata: { responseId: response.id },
    }).catch(() => undefined);
    return;
  }

  // Server-side evidence for grounding: never model-invented sources.
  const source = sourceOf(question.metadata);
  const chunks =
    source.chunkIds.length > 0
      ? await db.knowledgeChunk.findMany({
          where: { id: { in: source.chunkIds.slice(0, 6) } },
          select: { content: true, materialId: true, pageNumber: true },
        })
      : [];
  let materialNames = new Map<string, string>();
  if (chunks.length > 0) {
    const materials = await db.material.findMany({
      where: { id: { in: [...new Set(chunks.map((c) => c.materialId))] } },
      select: { id: true, filename: true },
    });
    materialNames = new Map(materials.map((m) => [m.id, m.filename]));
  }

  try {
    const { evaluation, inputTokens, outputTokens, model } = await evaluateOpenEnded(chat, {
      questionPrompt: question.prompt,
      keyPoints: keyPointsOf(question.metadata),
      evidence: chunks.map((c, i) => {
        const name = materialNames.get(c.materialId) ?? "material";
        const page = c.pageNumber !== null ? `, page ${c.pageNumber}` : "";
        return { label: `[Source ${i + 1}] (${name}${page})`, content: c.content };
      }),
      learnerAnswer: response.responseText ?? "",
    });
    const total = evaluation.coveredConcepts.length + evaluation.missingConcepts.length;
    await db.$transaction(async (tx) => {
      await tx.quizResponse.update({
        where: { id: response.id },
        data: {
          isCorrect: evaluation.correct,
          score: evaluation.score,
          feedback: evaluation.feedback,
          evaluatedAt: new Date(),
          metadata: { evaluationState: "EVALUATED" },
        },
      });
      await tx.assessment.upsert({
        where: { responseId: response.id },
        update: {
          score: evaluation.score,
          accuracy: evaluation.correct ? 1 : 0,
          relevance: total > 0 ? evaluation.coveredConcepts.length / total : null,
          reasoningQuality:
            evaluation.reasoningQuality === "GOOD"
              ? 1
              : evaluation.reasoningQuality === "PARTIAL"
                ? 0.5
                : 0,
          coveredConcepts: evaluation.coveredConcepts,
          missingConcepts: evaluation.missingConcepts,
          feedback: evaluation.feedback,
          evaluatorModel: model,
          evaluatorMetadata: {
            questionId: question.id,
            confidence: evaluation.confidence,
            misconceptions: evaluation.misconceptions,
            reasoningQuality: evaluation.reasoningQuality,
          },
        },
        create: {
          attemptId: attempt.id,
          responseId: response.id,
          userId,
          projectId: attempt.projectId,
          conceptId: question.conceptId,
          score: evaluation.score,
          accuracy: evaluation.correct ? 1 : 0,
          relevance: total > 0 ? evaluation.coveredConcepts.length / total : null,
          reasoningQuality:
            evaluation.reasoningQuality === "GOOD"
              ? 1
              : evaluation.reasoningQuality === "PARTIAL"
                ? 0.5
                : 0,
          coveredConcepts: evaluation.coveredConcepts,
          missingConcepts: evaluation.missingConcepts,
          feedback: evaluation.feedback,
          evaluatorModel: model,
          evaluatorMetadata: {
            questionId: question.id,
            confidence: evaluation.confidence,
            misconceptions: evaluation.misconceptions,
            reasoningQuality: evaluation.reasoningQuality,
          },
        },
      });
      await recordActivity(tx, {
        userId,
        projectId: attempt.projectId,
        eventType: "OPEN_ENDED_EVALUATED",
        entityType: "assessment",
        entityId: response.id,
        metadata: { quizId: attempt.quizId, attemptId: attempt.id },
      });
    });
    await recordQuizUsage(db, {
      userId,
      projectId: attempt.projectId,
      feature: "ASSESSMENT",
      provider: chat.name === "mock" ? "SYSTEM" : "GROQ",
      model,
      requestId: options.requestId,
      latencyMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      status: "SUCCESS",
      metadata: { responseId: response.id },
    });
  } catch (error) {
    // Never silently correct/incorrect: the answer survives, evaluation retries.
    // Timeouts keep their own status (see tutorService) for honest analytics.
    await db.quizResponse.update({
      where: { id: response.id },
      data: {
        metadata: {
          evaluationState: "EVALUATION_FAILED",
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        },
      },
    });
    await recordQuizUsage(db, {
      userId,
      projectId: attempt.projectId,
      feature: "ASSESSMENT",
      provider: chat.name === "mock" ? "SYSTEM" : "GROQ",
      model: chat.model,
      requestId: options.requestId,
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      status: isTimeoutError(error) ? "TIMEOUT" : "FAILED",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      metadata: { responseId: response.id },
    }).catch(() => undefined);
  }
}

function sourceOf(metadata: unknown): { chunkIds: string[]; materialIds: string[] } {
  if (typeof metadata !== "object" || metadata === null) return { chunkIds: [], materialIds: [] };
  const source = (metadata as { source?: unknown }).source;
  if (typeof source !== "object" || source === null) return { chunkIds: [], materialIds: [] };
  const { chunkIds, materialIds } = source as { chunkIds?: unknown; materialIds?: unknown };
  return {
    chunkIds: Array.isArray(chunkIds)
      ? chunkIds.filter((c): c is string => typeof c === "string")
      : [],
    materialIds: Array.isArray(materialIds)
      ? materialIds.filter((m): m is string => typeof m === "string")
      : [],
  };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Completion: every question must be answered and every open-ended
 * answer evaluated. The aggregate persists on the attempt (score + summary
 * metadata); per-response Assessment records already exist from
 * submission time. Long-term mastery is NOT computed — this result is
 * evidence for Prompt 10.
 */
export async function completeAttempt(
  userId: string,
  attemptId: string,
  options: QuizServiceOptions = {}
): Promise<QuizResult> {
  const db = options.db ?? requireDb();
  const attemptRef = await getOwnedAttemptOrThrow(userId, attemptId, db);
  const attempt = await db.quizAttempt.findUniqueOrThrow({ where: { id: attemptRef.id } });
  if (attempt.completedAt) {
    // Idempotent re-complete also reconciles mastery (no-op when every
    // response was already processed — recovery when a prior hook missed).
    await processAttemptMastery(userId, attempt.id, { db });
    return buildResult(db, attempt.id);
  }

  const questions = await db.quizQuestion.findMany({
    where: { quizId: attempt.quizId },
    orderBy: { order: "asc" },
    include: { concept: { select: { id: true, name: true } } },
  });
  const responses = await db.quizResponse.findMany({ where: { attemptId: attempt.id } });
  const responseByQuestion = new Map(responses.map((r) => [r.questionId, r]));
  const missing = questions.filter((q) => !responseByQuestion.get(q.id));
  if (missing.length > 0) {
    throw new ConflictError(`Attempt is incomplete: ${missing.length} question(s) unanswered`, {
      missingQuestionIds: missing.map((q) => q.id),
    });
  }

  // Evaluate outstanding open-ended answers synchronously (bounded).
  for (const question of questions) {
    if (question.type !== "OPEN_ENDED") continue;
    const response = responseByQuestion.get(question.id);
    if (!response) continue;
    const state = evaluationStateOf(response.metadata);
    if (state === "EVALUATED") continue;
    await evaluateOpenEndedResponse(db, userId, attempt, question, response, options);
    const refreshed = await db.quizResponse.findUniqueOrThrow({ where: { id: response.id } });
    if (evaluationStateOf(refreshed.metadata) !== "EVALUATED") {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Open-ended evaluation is unavailable. Your answers are saved — retry completion in a moment."
      );
    }
    responseByQuestion.set(question.id, refreshed);
  }

  const owned = await getOwnedQuizOrThrow(userId, attempt.quizId, db);
  // Atomic completion claim: exactly one concurrent twin flips
  // completedAt from null. The loser takes the same path as an
  // idempotent re-complete (rebuild result + reconcile mastery) instead
  // of colliding on the per-attempt activity idempotency keys below.
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.quizAttempt.updateMany({
        where: { id: attempt.id, completedAt: null },
        data: { completedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new CompletionRacedError();
      }
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: attempt.projectId,
        eventType: "QUIZ_ATTEMPT_COMPLETED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        idempotencyKey: `quiz-attempt-completed:${attempt.id}`,
        metadata: { quizId: attempt.quizId },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: attempt.projectId,
        eventType: "QUIZ_COMPLETED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        idempotencyKey: `quiz-completed:${attempt.id}`,
        metadata: { quizId: attempt.quizId },
      });
      await recordActivity(tx, {
        userId,
        spaceId: owned.spaceId,
        projectId: attempt.projectId,
        eventType: "ASSESSMENT_COMPLETED",
        entityType: "quiz_attempt",
        entityId: attempt.id,
        idempotencyKey: `assessment-completed:${attempt.id}`,
        metadata: { quizId: attempt.quizId },
      });
    });
  } catch (error) {
    if (error instanceof CompletionRacedError) {
      logger.info(
        { attemptId: attempt.id },
        "Completion race lost: twin claimed the attempt; reconciling instead"
      );
      await processAttemptMastery(userId, attempt.id, { db });
      return buildResult(db, attempt.id);
    }
    throw error;
  }

  const result = await buildResult(db, attempt.id);
  await db.quizAttempt.update({
    where: { id: attempt.id },
    data: {
      score: result.score,
      metadata: {
        aggregate: {
          correctCount: result.correctCount,
          incorrectCount: result.incorrectCount,
          openEndedCount: result.openEndedCount,
          conceptCoverage: result.conceptPerformance,
          strengths: result.strengths,
          weakAreas: result.weakAreas,
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  // Post-commit learning loop: fold evaluated responses into mastery,
  // refresh recommendations. Deterministic, no AI calls — extracted as a
  // queue-ready service (docs/LEARNING_LOOP.md). Loud on failure: the
  // re-complete path above reconciles, so nothing is silently lost.
  await processAttemptMastery(userId, attempt.id, { db });
  // Attempt quality evaluation runs async in the worker — never blocks completion.
  if (isQueueConfigured()) {
    await enqueueAIEvaluation("quiz_attempt", attempt.id, `attempt-${attempt.id}`).catch(
      (error: unknown) =>
        logger.warn(
          { attemptId: attempt.id, error: error instanceof Error ? error.message : String(error) },
          "AI evaluation enqueue skipped"
        )
    );
  }
  return result;
}

async function buildResult(db: PrismaClient, attemptId: string): Promise<QuizResult> {
  const attempt = await db.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const questions = await db.quizQuestion.findMany({
    where: { quizId: attempt.quizId },
    orderBy: { order: "asc" },
    include: { concept: { select: { id: true, name: true } } },
  });
  const responses = await db.quizResponse.findMany({ where: { attemptId } });
  const assessments = await db.assessment.findMany({ where: { attemptId } });
  const assessmentByResponse = new Map(
    assessments.filter((a) => a.responseId).map((a) => [a.responseId as string, a])
  );
  const responseByQuestion = new Map(responses.map((r) => [r.questionId, r]));

  let score = 0;
  let correctCount = 0;
  let openEndedCount = 0;
  const conceptStats = new Map<
    string,
    { name: string; answered: number; correct: number; totalScore: number }
  >();

  for (const question of questions) {
    const response = responseByQuestion.get(question.id);
    const value = response?.score ?? 0;
    score += value;
    if (response?.isCorrect === true) correctCount += 1;
    if (question.type === "OPEN_ENDED") openEndedCount += 1;
    const key = question.conceptId ?? "__none__";
    const entry = conceptStats.get(key) ?? {
      name: question.concept?.name ?? "Untagged",
      answered: 0,
      correct: 0,
      totalScore: 0,
    };
    entry.answered += 1;
    entry.totalScore += value;
    if (response?.isCorrect === true) entry.correct += 1;
    conceptStats.set(key, entry);
  }

  const conceptPerformance: ConceptPerformance[] = [...conceptStats].map(([key, entry]) => ({
    conceptId: key === "__none__" ? null : key,
    conceptName: entry.name,
    answered: entry.answered,
    correct: entry.correct,
    averageScore: entry.answered > 0 ? entry.totalScore / entry.answered : null,
  }));
  const strengths = conceptPerformance
    .filter((c) => (c.averageScore ?? 0) >= 0.8)
    .map((c) => c.conceptName);
  const weakAreas = conceptPerformance
    .filter((c) => (c.averageScore ?? 1) < 0.6)
    .map((c) => c.conceptName);

  // Server-side source labels for open-ended reviews (never model-invented).
  const chunkIds = [
    ...new Set(questions.flatMap((q) => sourceOf(q.metadata).chunkIds).slice(0, 60)),
  ];
  const chunks =
    chunkIds.length > 0
      ? await db.knowledgeChunk.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true, materialId: true, pageNumber: true },
        })
      : [];
  const materials =
    chunks.length > 0
      ? await db.material.findMany({
          where: { id: { in: [...new Set(chunks.map((c) => c.materialId))] } },
          select: { id: true, filename: true },
        })
      : [];
  const materialName = new Map(materials.map((m) => [m.id, m.filename]));
  const sourceLabelByChunk = new Map(
    chunks.map((c) => {
      const name = materialName.get(c.materialId) ?? "Material";
      return [c.id, c.pageNumber !== null ? `${name} · p. ${c.pageNumber}` : name] as const;
    })
  );

  const openEndedReviews: OpenEndedReview[] = [];
  for (const question of questions) {
    if (question.type !== "OPEN_ENDED") continue;
    const response = responseByQuestion.get(question.id);
    const assessment = response ? assessmentByResponse.get(response.id) : undefined;
    if (!response || !assessment) continue;
    const misconceptions =
      assessment.evaluatorMetadata &&
      typeof assessment.evaluatorMetadata === "object" &&
      Array.isArray((assessment.evaluatorMetadata as { misconceptions?: unknown }).misconceptions)
        ? (assessment.evaluatorMetadata as { misconceptions: unknown[] }).misconceptions.filter(
            (m): m is string => typeof m === "string"
          )
        : [];
    openEndedReviews.push({
      questionId: question.id,
      prompt: question.prompt,
      answer: response.responseText ?? "",
      score: assessment.score ?? 0,
      correct: response.isCorrect ?? false,
      feedback: assessment.feedback ?? "",
      coveredConcepts: Array.isArray(assessment.coveredConcepts)
        ? assessment.coveredConcepts.filter((c): c is string => typeof c === "string")
        : [],
      missingConcepts: Array.isArray(assessment.missingConcepts)
        ? assessment.missingConcepts.filter((c): c is string => typeof c === "string")
        : [],
      misconceptions,
      sourceRefs: sourceOf(question.metadata)
        .chunkIds.map((id) => sourceLabelByChunk.get(id))
        .filter((s): s is string => !!s)
        .slice(0, 6),
    });
  }

  return {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    projectId: attempt.projectId,
    score,
    maxScore: questions.length,
    correctCount,
    incorrectCount: questions.length - correctCount,
    openEndedCount,
    conceptPerformance,
    strengths,
    weakAreas,
    openEndedReviews,
    completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : new Date().toISOString(),
  };
}
