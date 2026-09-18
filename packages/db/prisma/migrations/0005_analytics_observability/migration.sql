-- Migration 0005_analytics_observability: idempotency + analytics indexes.
--
-- `ActivityEvent.idempotencyKey` (nullable unique) lets retried operations
-- reuse a key (`quiz-complete:<attemptId>`, `knowledge:<materialId>`)
-- instead of duplicating logical events. NULL keys stay unlimited since
-- PostgreSQL treats NULLs as distinct in unique indexes.
-- Remaining statements are pure index additions for analytics filtering;
-- no model changes, no data backfill.

-- AlterTable
ALTER TABLE "activity_events" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable (lifecycle timestamp for dismissal/completion analytics;
-- DEFAULT NOW() backfills existing rows honestly at migration time).
ALTER TABLE "recommendations" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "activity_events_idempotencyKey_key"
  ON "activity_events"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "activity_events_spaceId_createdAt_idx"
  ON "activity_events"("spaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_provider_createdAt_idx"
  ON "ai_usage"("provider", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_status_createdAt_idx"
  ON "ai_usage"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "document_jobs_status_createdAt_idx"
  ON "document_jobs"("status", "createdAt");
