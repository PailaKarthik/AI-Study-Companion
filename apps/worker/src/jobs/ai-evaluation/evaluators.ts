/**
 * Deterministic AI quality evaluators (Prompt 11).
 *
 * Pure functions over already-persisted rows — no LLM calls, no database.
 * Every metric is a number in [0, 1] or null. Null means "unavailable for
 * this target" (rendered as unavailable, never fabricated). Anything the
 * formula cannot honestly compute stays null; formulas are documented in
 * docs/ANALYTICS.md alongside their limits.
 */

export const EVALUATOR_VERSION = "system-deterministic-v1";

export type EvalScores = Record<string, number | null>;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Unique [n] citation markers referenced in tutor content. */
export function citedMarkers(content: string): number[] {
  const found = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

const HONESTY_PATTERN =
  /couldn'?t find|no relevant|don't have|do not have|not in (your|the) materials|insufficient (evidence|context)/i;

export interface TutorEvalInput {
  content: string;
  /** Evidence rows in stored (rank) order — marker [n] addresses position n. */
  evidence: { relevanceScore: number | null }[];
}

export interface TutorScores extends EvalScores {
  groundedness: number | null;
  citationValidity: number | null;
  citationCoverage: number | null;
  retrievalRelevance: number | null;
  unsupportedAnswerHandling: number | null;
}

/**
 * Tutor response quality from content + persisted evidence:
 * - citationValidity: referenced markers resolving to evidence rows.
 * - citationCoverage: evidence rows actually cited (capped at 1).
 * - groundedness: cited evidence when supported; honest disclaimer when not.
 * - retrievalRelevance: mean persisted relevance score.
 * - unsupportedAnswerHandling: only meaningful without evidence — 1 when
 *   the model honestly declined, 0 when it answered unsupported anyway.
 */
export function evaluateTutorMessage(input: TutorEvalInput): TutorScores {
  const markers = citedMarkers(input.content);
  const valid = markers.filter((n) => n <= input.evidence.length).length;
  const hasEvidence = input.evidence.length > 0;
  const honest = HONESTY_PATTERN.test(input.content);
  const relevance = input.evidence
    .map((e) => e.relevanceScore)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  return {
    groundedness: hasEvidence ? (valid > 0 ? 1 : 0) : honest ? 1 : 0,
    citationValidity: markers.length > 0 ? valid / markers.length : null,
    citationCoverage: hasEvidence ? clamp01(valid / input.evidence.length) : null,
    retrievalRelevance: mean(relevance),
    unsupportedAnswerHandling: hasEvidence ? null : honest ? 1 : 0,
  };
}

export interface AttemptEvalInput {
  responses: { isCorrect: boolean | null; conceptId: string | null }[];
  assessments: {
    score: number | null;
    relevance: number | null;
    reasoningQuality: number | null;
    confidence: number | null;
  }[];
}

export interface AttemptScores extends EvalScores {
  correctness: number | null;
  relevance: number | null;
  conceptCoverage: number | null;
  reasoningQuality: number | null;
  evaluatorConfidence: number | null;
}

/** Attempt assessment quality mirrored from stored evaluation rows. */
export function evaluateAttempt(input: AttemptEvalInput): AttemptScores {
  const correctness = input.responses
    .map((r) => r.isCorrect)
    .filter((c): c is boolean => c !== null);
  return {
    correctness:
      correctness.length > 0 ? correctness.filter(Boolean).length / correctness.length : null,
    relevance: mean(
      input.assessments.map((a) => a.relevance).filter((v): v is number => v !== null)
    ),
    conceptCoverage:
      input.responses.length > 0
        ? input.responses.filter((r) => r.conceptId !== null).length / input.responses.length
        : null,
    reasoningQuality: mean(
      input.assessments.map((a) => a.reasoningQuality).filter((v): v is number => v !== null)
    ),
    evaluatorConfidence: mean(
      input.assessments.map((a) => a.confidence).filter((v): v is number => v !== null)
    ),
  };
}

export interface QuizEvalInput {
  mode: string | null;
  questions: {
    conceptId: string | null;
    difficulty: string | null;
    type: string;
  }[];
}

export interface QuizScores extends EvalScores {
  conceptAlignment: number | null;
  difficultyCoverage: number | null;
  conceptDiversity: number | null;
  typeBalance: number | null;
  adaptivitySignals: number | null;
}

/** Generated-quiz quality from stored question rows. */
export function evaluateQuiz(input: QuizEvalInput): QuizScores {
  const total = input.questions.length;
  if (total === 0) {
    return {
      conceptAlignment: null,
      difficultyCoverage: null,
      conceptDiversity: null,
      typeBalance: null,
      adaptivitySignals: input.mode ? 1 : 0,
    };
  }
  const types = new Set(input.questions.map((q) => q.type));
  const mcq = input.questions.filter((q) => q.type === "MCQ").length;
  return {
    conceptAlignment: input.questions.filter((q) => q.conceptId !== null).length / total,
    difficultyCoverage: input.questions.filter((q) => q.difficulty !== null).length / total,
    conceptDiversity:
      new Set(input.questions.map((q) => q.conceptId).filter((c): c is string => c !== null)).size /
      total,
    // Single-type quizzes are deliberate (typePreference), not a defect —
    // balance is reported only for mixed quizzes.
    typeBalance: types.size > 1 ? Math.min(mcq, total - mcq) / Math.max(mcq, total - mcq) : null,
    adaptivitySignals: input.mode ? 1 : 0,
  };
}

export interface RecommendationEvalInput {
  type: string;
  reason: string | null;
  actionKind: string | null;
  actionTargetExists: boolean | null;
  conceptExists: boolean;
  conceptMastery: number | null;
  recentMistakes: number;
}

export interface RecommendationScores extends EvalScores {
  relevance: number | null;
  actionability: number | null;
  alignment: number | null;
}

/** Recommendation quality from the persisted row + current mastery. */
export function evaluateRecommendation(input: RecommendationEvalInput): RecommendationScores {
  let relevance: number | null = null;
  if (input.conceptExists && input.conceptMastery !== null) {
    relevance =
      input.type === "EXPLORE"
        ? input.conceptMastery >= 0.8
          ? 1
          : 0.5
        : input.conceptMastery < 0.8
          ? 1
          : 0.3;
  }
  return {
    relevance,
    actionability:
      input.actionKind === null || input.actionTargetExists === null
        ? null
        : input.actionTargetExists
          ? 1
          : 0,
    alignment: !input.reason
      ? 0
      : input.type === "REVISIT"
        ? input.recentMistakes >= 2
          ? 1
          : 0.5
        : input.conceptMastery !== null || input.recentMistakes > 0
          ? 1
          : 0.5,
  };
}
