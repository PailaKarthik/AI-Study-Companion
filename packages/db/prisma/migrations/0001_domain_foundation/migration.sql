-- Migration 0001_domain_foundation: complete AI Study Companion domain schema.
--
-- Generated offline via:
--   prisma migrate diff --from-empty --to-schema-datamodel ./prisma/schema.prisma --script
-- so this SQL is guaranteed in sync with prisma/schema.prisma.
-- Apply with a real database via `prisma migrate dev` / `migrate deploy`.
--
-- Notes:
--   - The Prompt 1 placeholder model `SchemaVersion` was never migrated
--     (0000 only enabled pgvector), so there is nothing to drop.
--   - pgvector: the extension is re-asserted idempotently here (0000 also
--     creates it) because `knowledge_chunks.embedding vector(768)` requires
--     it. 768 = Gemini text-embedding-004 dimensions.
--   - The HNSW index at the end of this file is hand-written: Prisma cannot
--     express vector indexes, so it is outside `migrate diff` output.
--     HNSW needs pgvector >= 0.7 (Neon provides it). If HNSW creation fails
--     on an older server, replace it with an IVFFLAT index (see docs/DATABASE.md).
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LearnerContextType" AS ENUM ('GOAL', 'PREFERENCE', 'STRENGTH', 'WEAKNESS', 'HISTORY', 'TUTOR_NOTE', 'ASSESSMENT_SUMMARY', 'REPEATED_MISTAKE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentJobType" AS ENUM ('TEXT_EXTRACTION', 'CHUNKING', 'EMBEDDING', 'FULL_INGEST');

-- CreateEnum
CREATE TYPE "DocumentJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConceptDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "ConceptRelationType" AS ENUM ('PREREQUISITE', 'RELATED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'OPEN_ENDED');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MasterySourceType" AS ENUM ('QUIZ', 'OPEN_ENDED_ASSESSMENT', 'TUTOR_INTERACTION', 'LEARNING_ACTIVITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('REVIEW', 'PRACTICE', 'EXPLORE', 'REVISIT', 'NEXT_STEP');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'COMPLETED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AIFeature" AS ENUM ('TUTOR', 'QUIZ_GENERATION', 'ASSESSMENT', 'RECOMMENDATION', 'EMBEDDING', 'DOCUMENT_UNDERSTANDING', 'EVALUATION');

-- CreateEnum
CREATE TYPE "AIProvider" AS ENUM ('GROQ', 'GEMINI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AIUsageStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_contexts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "type" "LearnerContextType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageUrl" TEXT,
    "checksum" TEXT,
    "status" "MaterialStatus" NOT NULL DEFAULT 'UPLOADED',
    "pageCount" INTEGER,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_jobs" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "jobId" TEXT,
    "type" "DocumentJobType" NOT NULL,
    "status" "DocumentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "extractedText" TEXT NOT NULL,
    "charCount" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "pageId" UUID,
    "pageNumber" INTEGER,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "difficulty" "ConceptDifficulty",
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_relations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fromConceptId" UUID NOT NULL,
    "toConceptId" UUID NOT NULL,
    "type" "ConceptRelationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutor_evidence" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "chunkId" UUID,
    "materialId" UUID NOT NULL,
    "pageId" UUID,
    "pageNumber" INTEGER,
    "relevanceScore" DOUBLE PRECISION,
    "citationLabel" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "difficulty" "ConceptDifficulty",
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "conceptId" UUID,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctAnswer" TEXT,
    "explanation" TEXT,
    "difficulty" "ConceptDifficulty",
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_responses" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "responseText" TEXT,
    "selectedOption" TEXT,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "responseId" UUID,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "conceptId" UUID,
    "score" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "relevance" DOUBLE PRECISION,
    "reasoningQuality" DOUBLE PRECISION,
    "coveredConcepts" JSONB,
    "missingConcepts" JSONB,
    "feedback" TEXT,
    "evaluatorModel" TEXT,
    "evaluatorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_mastery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lastAssessedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concept_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "sourceType" "MasterySourceType" NOT NULL,
    "sourceId" TEXT,
    "previousScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "conceptId" UUID,
    "type" "RecommendationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "action" TEXT,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "evidence" JSONB,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "spaceId" UUID,
    "projectId" UUID,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "projectId" UUID,
    "feature" "AIFeature" NOT NULL,
    "provider" "AIProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DECIMAL(10,6),
    "status" "AIUsageStatus" NOT NULL DEFAULT 'SUCCESS',
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluations" (
    "id" UUID NOT NULL,
    "feature" "AIFeature" NOT NULL,
    "model" TEXT NOT NULL,
    "provider" "AIProvider" NOT NULL DEFAULT 'SYSTEM',
    "targetType" TEXT,
    "targetId" TEXT,
    "scores" JSONB NOT NULL,
    "evaluator" TEXT,
    "evaluatorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "learner_contexts_userId_idx" ON "learner_contexts"("userId");

-- CreateIndex
CREATE INDEX "learner_contexts_userId_projectId_idx" ON "learner_contexts"("userId", "projectId");

-- CreateIndex
CREATE INDEX "learner_contexts_userId_type_idx" ON "learner_contexts"("userId", "type");

-- CreateIndex
CREATE INDEX "spaces_ownerId_idx" ON "spaces"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_ownerId_name_key" ON "spaces"("ownerId", "name");

-- CreateIndex
CREATE INDEX "projects_spaceId_idx" ON "projects"("spaceId");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_lastActivityAt_idx" ON "projects"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "projects_spaceId_name_key" ON "projects"("spaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "materials_storageKey_key" ON "materials"("storageKey");

-- CreateIndex
CREATE INDEX "materials_projectId_idx" ON "materials"("projectId");

-- CreateIndex
CREATE INDEX "materials_status_idx" ON "materials"("status");

-- CreateIndex
CREATE INDEX "materials_checksum_idx" ON "materials"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "document_jobs_jobId_key" ON "document_jobs"("jobId");

-- CreateIndex
CREATE INDEX "document_jobs_materialId_idx" ON "document_jobs"("materialId");

-- CreateIndex
CREATE INDEX "document_jobs_status_idx" ON "document_jobs"("status");

-- CreateIndex
CREATE INDEX "document_jobs_materialId_status_idx" ON "document_jobs"("materialId", "status");

-- CreateIndex
CREATE INDEX "document_pages_materialId_idx" ON "document_pages"("materialId");

-- CreateIndex
CREATE INDEX "document_pages_projectId_idx" ON "document_pages"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_materialId_pageNumber_key" ON "document_pages"("materialId", "pageNumber");

-- CreateIndex
CREATE INDEX "knowledge_chunks_projectId_idx" ON "knowledge_chunks"("projectId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_materialId_idx" ON "knowledge_chunks"("materialId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_pageId_idx" ON "knowledge_chunks"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_materialId_chunkIndex_key" ON "knowledge_chunks"("materialId", "chunkIndex");

-- CreateIndex
CREATE INDEX "concepts_projectId_idx" ON "concepts"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_projectId_name_key" ON "concepts"("projectId", "name");

-- CreateIndex
CREATE INDEX "concept_relations_projectId_idx" ON "concept_relations"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_relations_fromConceptId_toConceptId_type_key" ON "concept_relations"("fromConceptId", "toConceptId", "type");

-- CreateIndex
CREATE INDEX "conversations_projectId_idx" ON "conversations"("projectId");

-- CreateIndex
CREATE INDEX "conversations_ownerId_idx" ON "conversations"("ownerId");

-- CreateIndex
CREATE INDEX "conversations_projectId_updatedAt_idx" ON "conversations"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "messages_projectId_idx" ON "messages"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_sequence_key" ON "messages"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "tutor_evidence_messageId_idx" ON "tutor_evidence"("messageId");

-- CreateIndex
CREATE INDEX "tutor_evidence_chunkId_idx" ON "tutor_evidence"("chunkId");

-- CreateIndex
CREATE INDEX "tutor_evidence_materialId_idx" ON "tutor_evidence"("materialId");

-- CreateIndex
CREATE INDEX "quizzes_projectId_idx" ON "quizzes"("projectId");

-- CreateIndex
CREATE INDEX "quizzes_status_idx" ON "quizzes"("status");

-- CreateIndex
CREATE INDEX "quiz_questions_quizId_idx" ON "quiz_questions"("quizId");

-- CreateIndex
CREATE INDEX "quiz_questions_projectId_idx" ON "quiz_questions"("projectId");

-- CreateIndex
CREATE INDEX "quiz_questions_conceptId_idx" ON "quiz_questions"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_idempotencyKey_key" ON "quiz_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "quiz_attempts_quizId_idx" ON "quiz_attempts"("quizId");

-- CreateIndex
CREATE INDEX "quiz_attempts_projectId_idx" ON "quiz_attempts"("projectId");

-- CreateIndex
CREATE INDEX "quiz_attempts_userId_idx" ON "quiz_attempts"("userId");

-- CreateIndex
CREATE INDEX "quiz_attempts_userId_createdAt_idx" ON "quiz_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "quiz_responses_attemptId_idx" ON "quiz_responses"("attemptId");

-- CreateIndex
CREATE INDEX "quiz_responses_questionId_idx" ON "quiz_responses"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_responses_attemptId_questionId_key" ON "quiz_responses"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_responseId_key" ON "assessments"("responseId");

-- CreateIndex
CREATE INDEX "assessments_attemptId_idx" ON "assessments"("attemptId");

-- CreateIndex
CREATE INDEX "assessments_userId_idx" ON "assessments"("userId");

-- CreateIndex
CREATE INDEX "assessments_projectId_idx" ON "assessments"("projectId");

-- CreateIndex
CREATE INDEX "assessments_conceptId_idx" ON "assessments"("conceptId");

-- CreateIndex
CREATE INDEX "concept_mastery_userId_idx" ON "concept_mastery"("userId");

-- CreateIndex
CREATE INDEX "concept_mastery_projectId_idx" ON "concept_mastery"("projectId");

-- CreateIndex
CREATE INDEX "concept_mastery_conceptId_idx" ON "concept_mastery"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_mastery_userId_projectId_conceptId_key" ON "concept_mastery"("userId", "projectId", "conceptId");

-- CreateIndex
CREATE INDEX "mastery_events_userId_createdAt_idx" ON "mastery_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "mastery_events_projectId_createdAt_idx" ON "mastery_events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "mastery_events_conceptId_createdAt_idx" ON "mastery_events"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "recommendations_userId_idx" ON "recommendations"("userId");

-- CreateIndex
CREATE INDEX "recommendations_projectId_idx" ON "recommendations"("projectId");

-- CreateIndex
CREATE INDEX "recommendations_status_idx" ON "recommendations"("status");

-- CreateIndex
CREATE INDEX "recommendations_projectId_status_idx" ON "recommendations"("projectId", "status");

-- CreateIndex
CREATE INDEX "recommendations_userId_status_idx" ON "recommendations"("userId", "status");

-- CreateIndex
CREATE INDEX "activity_events_userId_createdAt_idx" ON "activity_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_projectId_createdAt_idx" ON "activity_events"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_eventType_createdAt_idx" ON "activity_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_userId_createdAt_idx" ON "ai_usage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_projectId_createdAt_idx" ON "ai_usage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_feature_createdAt_idx" ON "ai_usage"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_requestId_idx" ON "ai_usage"("requestId");

-- CreateIndex
CREATE INDEX "ai_evaluations_feature_createdAt_idx" ON "ai_evaluations"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "ai_evaluations_targetType_targetId_idx" ON "ai_evaluations"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "learner_contexts" ADD CONSTRAINT "learner_contexts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_contexts" ADD CONSTRAINT "learner_contexts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_jobs" ADD CONSTRAINT "document_jobs_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "document_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_fromConceptId_fkey" FOREIGN KEY ("fromConceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_toConceptId_fkey" FOREIGN KEY ("toConceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_evidence" ADD CONSTRAINT "tutor_evidence_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tutor_evidence" ADD CONSTRAINT "tutor_evidence_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "quiz_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_events" ADD CONSTRAINT "mastery_events_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- pgvector similarity index (hand-written; Prisma cannot model vector indexes).
-- Cosine distance matches Gemini embedding retrieval. HNSW is preferred over
-- IVFFLAT: no training step, better recall/latency trade-off, index builds
-- without requiring existing rows.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
