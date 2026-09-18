import { z } from "zod";

/**
 * ai.evaluate job: deterministic quality evaluation of persisted AI
 * output. No LLM calls — every metric derives from rows the feature
 * already wrote (messages + evidence, assessments, questions,
 * recommendations + mastery). Anything not computable is recorded as
 * null (unavailable), never fabricated.
 *
 * Idempotency: deterministic jobId `ai-eval-<targetType>-<targetId>`
 * collapses duplicate enqueues in Redis, and the processor returns the
 * existing AIEvaluation when one already covers the target.
 */

export const EVALUATION_TARGET_TYPES = [
  "tutor_message",
  "quiz_attempt",
  "quiz",
  "recommendation",
] as const;

export type EvaluationTargetType = (typeof EVALUATION_TARGET_TYPES)[number];

export const aiEvaluateJobSchema = z.object({
  targetType: z.enum(EVALUATION_TARGET_TYPES),
  /** Message id / attempt id / quiz id / recommendation id. */
  targetId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
  enqueuedAt: z.string().datetime(),
});

export type AiEvaluateJobData = z.infer<typeof aiEvaluateJobSchema>;

export interface AiEvaluateJobResult {
  status: "evaluated" | "skipped-existing" | "target-missing";
  targetType: EvaluationTargetType;
  targetId: string;
  evaluationId: string | null;
  correlationId: string;
}

/**
 * Deterministic BullMQ jobId so duplicate enqueues collapse in Redis.
 * Dashes, never colons: BullMQ rejects custom ids containing `:`.
 */
export function aiEvaluateJobId(targetType: EvaluationTargetType, targetId: string): string {
  return `ai-eval-${targetType}-${targetId}`;
}
