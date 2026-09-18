import type { ConceptDifficulty, MasteryStatus } from "@ai-study-companion/shared";

/**
 * Deterministic mastery math (Prompt 10).
 *
 * Update rule (exponential moving average over one concept's new evidence,
 * oldest first):
 *
 *   mastery ← mastery × (1 − w) + score × w
 *
 * per evidence item, where the effective weight w is:
 *
 *   w = min(maxSingle, base(kind) × difficulty × quality × recency)
 *
 * Rationale (see docs/MASTERY.md):
 * - Assessment evidence dominates: quiz (0.45) + open-ended (0.35) dwarf
 *   activity/tutor (0.10 each), so passive engagement can never overwhelm
 *   graded proof. Uncertain Groq evaluations are discounted by evaluator
 *   confidence; deterministic MCQ correctness is not.
 * - Difficulty scales the WEIGHT, never the score: hard-correct moves
 *   mastery more than easy-correct; easy-wrong hurts more than hard-wrong.
 *   The maxSingle cap keeps any one question from radically changing
 *   mastery, and repeated same-direction evidence has diminishing returns
 *   by construction (each step closes a fraction of the remaining gap).
 * - Recency decays gently toward a floor: old evidence still counts, and
 *   mere absence never aggressively decays mastery.
 * - Everything stays in [0, 1] by clamping; EMA cannot run away.
 */

export type EvidenceKind =
  "QUIZ" | "OPEN_ENDED_ASSESSMENT" | "TUTOR_INTERACTION" | "LEARNING_ACTIVITY";

export interface EvidenceItem {
  kind: EvidenceKind;
  /** Demonstrated understanding for this item, already in [0, 1]. */
  score: number;
  /**
   * Item quality in [0, 1]: 1 for deterministic MCQ correctness,
   * evaluator confidence for Groq assessments, lower for passive signals.
   */
  quality: number;
  difficulty: ConceptDifficulty | null;
  correct: boolean;
  occurredAt: Date;
}

export interface MasteryWeights {
  quiz: number;
  openEnded: number;
  activity: number;
  tutor: number;
  maxSingleWeight: number;
  recencyHalfLifeDays: number;
  recencyFloor: number;
}

export interface MasteryBands {
  attentionBelow: number;
  developingBelow: number;
  strongAt: number;
}

export interface CalculatorInput {
  oldMastery: number;
  oldEvidenceCount: number;
  evidence: EvidenceItem[];
  weights: MasteryWeights;
  now: Date;
}

export interface CalculatorOutput {
  newMastery: number;
  delta: number;
  /** Sum of effective weights applied (for the event record). */
  evidenceWeight: number;
  confidence: number;
  evidenceCount: number;
  /** Learner-safe summary, e.g. "2 quiz responses, avg score 0.75". */
  reason: string;
}

const MS_PER_DAY = 86_400_000;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Difficulty scales weight asymmetrically: succeeding at hard material is
 * strong evidence; failing easy material is a strong gap signal. Failing
 * hard material is weak negative evidence (expected struggle).
 */
export function difficultyFactor(difficulty: ConceptDifficulty | null, correct: boolean): number {
  if (correct) {
    switch (difficulty) {
      case "ADVANCED":
        return 1.25;
      case "INTERMEDIATE":
        return 1.0;
      case "BEGINNER":
        return 0.8;
      default:
        return 1.0;
    }
  }
  switch (difficulty) {
    case "BEGINNER":
      return 1.25;
    case "INTERMEDIATE":
      return 1.0;
    case "ADVANCED":
      return 0.8;
    default:
      return 1.0;
  }
}

export function recencyFactor(
  occurredAt: Date,
  now: Date,
  halfLifeDays: number,
  floor: number
): number {
  const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / MS_PER_DAY);
  const decayed = 0.5 ** (ageDays / Math.max(1, halfLifeDays));
  return Math.max(floor, Math.min(1, decayed));
}

function baseWeight(kind: EvidenceKind, weights: MasteryWeights): number {
  switch (kind) {
    case "QUIZ":
      return weights.quiz;
    case "OPEN_ENDED_ASSESSMENT":
      return weights.openEnded;
    case "LEARNING_ACTIVITY":
      return weights.activity;
    case "TUTOR_INTERACTION":
      return weights.tutor;
  }
}

export function effectiveWeight(item: EvidenceItem, weights: MasteryWeights, now: Date): number {
  const raw =
    baseWeight(item.kind, weights) *
    difficultyFactor(item.difficulty, item.correct) *
    clamp01(item.quality) *
    recencyFactor(item.occurredAt, now, weights.recencyHalfLifeDays, weights.recencyFloor);
  return Math.min(weights.maxSingleWeight, Math.max(0, raw));
}

/** Count-based confidence: more evidence → surer estimate, capped. */
export function confidenceFor(totalEvidenceCount: number): number {
  if (totalEvidenceCount <= 0) return 0;
  return Math.min(0.95, 1 - 1 / (1 + totalEvidenceCount * 0.5));
}

export function statusForScore(score: number, bands: MasteryBands): MasteryStatus {
  const clamped = clamp01(score);
  if (clamped < bands.attentionBelow) return "NEEDS_ATTENTION";
  if (clamped < bands.developingBelow) return "DEVELOPING";
  if (clamped < bands.strongAt) return "STABLE";
  return "STRONG";
}

/**
 * Fold one concept's new evidence into its mastery row. Returns null when
 * there is nothing to fold (caller writes no event). Pure — all
 * persistence lives in masteryService.
 */
export function applyEvidence(input: CalculatorInput): CalculatorOutput | null {
  if (input.evidence.length === 0) return null;
  const ordered = [...input.evidence].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );
  let mastery = clamp01(input.oldMastery);
  let appliedWeight = 0;
  let scoreSum = 0;
  for (const item of ordered) {
    const w = effectiveWeight(item, input.weights, input.now);
    mastery = clamp01(mastery * (1 - w) + clamp01(item.score) * w);
    appliedWeight += w;
    scoreSum += clamp01(item.score);
  }
  const evidenceCount = input.oldEvidenceCount + ordered.length;
  const avgScore = scoreSum / ordered.length;
  const kindWord = ordered.length === 1 ? kindLabel(ordered[0]?.kind) : "mixed evidence";
  return {
    newMastery: mastery,
    delta: mastery - clamp01(input.oldMastery),
    evidenceWeight: appliedWeight,
    confidence: confidenceFor(evidenceCount),
    evidenceCount,
    reason:
      ordered.length === 1
        ? `${kindWord}, score ${avgScore.toFixed(2)}`
        : `${ordered.length} evidence items (${kindWord}), avg score ${avgScore.toFixed(2)}`,
  };
}

function kindLabel(kind: EvidenceKind | undefined): string {
  switch (kind) {
    case "QUIZ":
      return "quiz response";
    case "OPEN_ENDED_ASSESSMENT":
      return "open-ended assessment";
    case "TUTOR_INTERACTION":
      return "tutor interaction";
    case "LEARNING_ACTIVITY":
      return "learning activity";
    default:
      return "evidence";
  }
}
