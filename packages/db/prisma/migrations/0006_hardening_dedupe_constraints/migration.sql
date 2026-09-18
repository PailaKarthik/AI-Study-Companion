-- Hardening: database-level idempotency invariants (Prompt 12 audit).
--
-- MasteryEvent.sourceId is nullable by schema, so a plain Prisma
-- @@unique cannot express the dedupe rule. These PARTIAL unique indexes
-- enforce it for every row that carries a source, while legacy/source-less
-- rows (sourceId IS NULL) stay unconstrained:
--   * one MasteryEvent per (sourceType, sourceId, conceptId)
--   * one AIEvaluation per (targetType, targetId, evaluator)
--
-- Concurrent writers that lose the race get P2002 and treat the write as
-- already-processed (see masteryService + ai-evaluation processor).

CREATE UNIQUE INDEX IF NOT EXISTS "mastery_events_source_dedupe_idx"
  ON "mastery_events" ("sourceType", "sourceId", "conceptId")
  WHERE "sourceId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_evaluations_target_dedupe_idx"
  ON "ai_evaluations" ("targetType", "targetId", "evaluator")
  WHERE "targetType" IS NOT NULL AND "targetId" IS NOT NULL AND "evaluator" IS NOT NULL;
