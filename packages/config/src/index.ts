/**
 * @ai-study-companion/config
 *
 * Minimal shared configuration conventions for the monorepo.
 * Keep this package intentionally small: per-app typed config lives
 * in apps/api/src/config and apps/worker/src/config.
 * This package only holds cross-cutting constants.
 */

export const APP_NAME = "AI Study Companion" as const;

export const QUEUE_NAMES = {
  system: "system",
  documents: "documents",
  embeddings: "embeddings",
  quiz: "quiz",
  knowledge: "knowledge",
  evaluations: "evaluations",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  systemHealth: "system.health",
  documentProcess: "document.process",
  knowledgeProcess: "knowledge.process",
  aiEvaluate: "ai.evaluate",
} as const;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
