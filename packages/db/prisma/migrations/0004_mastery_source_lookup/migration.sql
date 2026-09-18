-- Migration 0004_mastery_source_lookup: idempotency index for mastery events.
--
-- `processAttemptMastery` (apps/api/src/services/masteryService.ts) checks
-- for an existing MasteryEvent by (sourceType, sourceId, conceptId) before
-- writing, so re-processing the same quiz response can never double-count
-- evidence. Hand-written: a single CREATE INDEX, no model changes.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mastery_events_sourceType_sourceId_idx"
  ON "mastery_events"("sourceType", "sourceId");
