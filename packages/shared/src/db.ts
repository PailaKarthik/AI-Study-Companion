/**
 * @ai-study-companion/shared — database domain types.
 *
 * Frontend-safe mirrors of the Prisma enums in `packages/db/prisma/schema.prisma`.
 * The browser must NEVER import `@prisma/client` or `@ai-study-companion/db`
 * (see docs/DATABASE.md): Next.js → Express API → services → Prisma.
 *
 * These are plain string-union types so they serialize over JSON unchanged.
 * Keep them in sync with the Prisma schema when enums change.
 */

export type UserRole = "USER" | "ADMIN";

export type LearnerContextType =
  | "GOAL"
  | "PREFERENCE"
  | "STRENGTH"
  | "WEAKNESS"
  | "HISTORY"
  | "TUTOR_NOTE"
  | "ASSESSMENT_SUMMARY"
  | "REPEATED_MISTAKE";

export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "COMPLETED";

export type MaterialStatus = "UPLOADED" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";

/** Knowledge-indexing lifecycle. Distinct from MaterialStatus (PDF state). */
export type KnowledgeStatus = "NOT_STARTED" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export type DocumentJobType = "TEXT_EXTRACTION" | "CHUNKING" | "EMBEDDING" | "FULL_INGEST";

export type DocumentJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type ConceptDifficulty = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

export type ConceptRelationType = "PREREQUISITE" | "RELATED";

export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";

export type QuestionType = "MCQ" | "OPEN_ENDED";

export type QuizStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type MasterySourceType =
  "QUIZ" | "OPEN_ENDED_ASSESSMENT" | "TUTOR_INTERACTION" | "LEARNING_ACTIVITY" | "SYSTEM";

export type RecommendationType = "REVIEW" | "PRACTICE" | "EXPLORE" | "REVISIT" | "NEXT_STEP";

export type RecommendationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type RecommendationStatus = "PENDING" | "COMPLETED" | "DISMISSED" | "EXPIRED";

export type AIFeature =
  | "TUTOR"
  | "QUIZ_GENERATION"
  | "ASSESSMENT"
  | "RECOMMENDATION"
  | "EMBEDDING"
  | "DOCUMENT_UNDERSTANDING"
  | "EVALUATION";

export type AIProvider = "GROQ" | "GEMINI" | "SYSTEM";

export type AIUsageStatus = "SUCCESS" | "FAILED" | "TIMEOUT";

/**
 * Activity event types tracked in `activity_events.eventType`.
 * Stored as a validated string (not a DB enum) so new product events do not
 * require a migration. Import the matching Zod schema from
 * `@ai-study-companion/validation` when validating API input.
 *
 * Taxonomy rule: a type exists here only if application code emits it for
 * a real action (see docs/ANALYTICS.md for the action→event map). Types
 * are never added to inflate analytics.
 */
export const ACTIVITY_EVENT_TYPES = [
  "USER_REGISTERED",
  "USER_LOGIN",
  "USER_LOGOUT",
  "SPACE_CREATED",
  "SPACE_UPDATED",
  "SPACE_DELETED",
  "SPACE_VIEWED",
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_DELETED",
  "PROJECT_VIEWED",
  "MATERIAL_UPLOADED",
  "MATERIAL_DELETED",
  "MATERIAL_PROCESSING_STARTED",
  "MATERIAL_PROCESSING_COMPLETED",
  "MATERIAL_PROCESSING_FAILED",
  "MATERIAL_RETRY_REQUESTED",
  "TUTOR_INTERACTION",
  "TUTOR_CONVERSATION_CREATED",
  "TUTOR_RESPONSE_FAILED",
  "QUIZ_CREATED",
  "QUIZ_STARTED",
  "QUIZ_ATTEMPT_STARTED",
  "QUIZ_QUESTION_ANSWERED",
  "QUIZ_ATTEMPT_COMPLETED",
  "QUIZ_COMPLETED",
  "OPEN_ENDED_EVALUATED",
  "ASSESSMENT_STARTED",
  "ASSESSMENT_COMPLETED",
  "MASTERY_UPDATED",
  "CONCEPT_IMPROVED",
  "CONCEPT_NEEDS_ATTENTION",
  "GROWTH_ANALYZED",
  "RECOMMENDATION_CREATED",
  "RECOMMENDATION_COMPLETED",
  "RECOMMENDATION_DISMISSED",
  "PROJECT_ACTIVITY",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * pgvector column width. Produced by `gemini-embedding-001` with
 * `outputDimensionality: 768` (see packages/ai). Must match the
 * `vector(768)` column + HNSW index; enforced at runtime on every
 * embedding write.
 */
export const EMBEDDING_DIMENSIONS = 768;
