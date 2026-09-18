import type { ConceptDifficulty } from "@ai-study-companion/shared";

/**
 * Adaptive question-target selector (pure + deterministic).
 *
 * This is deliberately NOT "correct → harder / wrong → easier". Each
 * candidate concept is scored on five independent signals, and difficulty
 * is fit from aggregate evidence (mastery, else response accuracy, else a
 * stated neutral default) — never from the single previous answer.
 *
 * Weights are fixed constants so rankings are reproducible and explainable:
 * the same signals always produce the same targets (tie-break: conceptId).
 */

export const SELECTOR_WEIGHTS = {
  /** Unmet need: 1 − mastery, else 1 − accuracy, else a neutral prior. */
  need: 0.35,
  /** Recent mistakes: repeated errors demand deliberate re-exposure. */
  mistake: 0.25,
  /** Freshness: unseen concepts and stale exposures rank higher. */
  freshness: 0.15,
  /** Prerequisite support: foundations of weak concepts come first. */
  support: 0.15,
  /** Recent form: struggling lately outranks coasting. */
  form: 0.1,
} as const;

/** Neutral prior for concepts with no mastery and no answers — NOT mastery. */
export const UNKNOWN_NEED_PRIOR = 0.55;

const RECENT_WINDOW = 5;
const FRESHNESS_FULL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConceptSignalInput {
  conceptId: string;
  name: string;
  /** 0..1 from ConceptMastery; null when no mastery row exists. */
  masteryScore: number | null;
  /** 0..1 lifetime accuracy from QuizResponses; null when never answered. */
  accuracy: number | null;
  /** Incorrect responses inside the recent window. */
  recentIncorrect: number;
  /** Correct responses inside the recent window. */
  recentCorrect: number;
  /** True when the concept never appeared in an answered question. */
  isNew: boolean;
  /** True when this concept is a prerequisite of a currently weak concept. */
  supportsWeakConcept: boolean;
  /** Ms since last answered exposure; null when never answered. */
  msSinceLastAnswered: number | null;
}

export interface SelectionRequest {
  concepts: ConceptSignalInput[];
  count: number;
  typePreference?: "MCQ" | "OPEN_ENDED";
  /** Explicit practice level; otherwise fit from aggregate evidence. */
  difficulty?: ConceptDifficulty | null;
  /** CONCEPT_FOCUS allowlist; other concepts are excluded. */
  conceptIds?: string[];
}

export interface SelectionTarget {
  conceptId: string;
  conceptName: string;
  difficulty: ConceptDifficulty;
  type: "MCQ" | "OPEN_ENDED";
  /** Human-readable drivers, e.g. "weakness: accuracy 0.25". */
  reasons: string[];
}

interface Scored {
  signal: ConceptSignalInput;
  score: number;
  need: number;
  difficulty: ConceptDifficulty;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Difficulty from aggregate evidence only. A single recent answer never
 * moves this — that is exactly the naive behavior this selector avoids.
 */
export function fitDifficulty(signal: Pick<ConceptSignalInput, "masteryScore" | "accuracy">): {
  difficulty: ConceptDifficulty;
  reason: string;
} {
  const evidence = signal.masteryScore ?? signal.accuracy ?? null;
  if (evidence === null) {
    return { difficulty: "INTERMEDIATE", reason: "unmeasured: neutral default" };
  }
  if (evidence < 0.4) {
    return { difficulty: "BEGINNER", reason: `weakness: evidence ${evidence.toFixed(2)}` };
  }
  if (evidence < 0.7) {
    return { difficulty: "INTERMEDIATE", reason: `developing: evidence ${evidence.toFixed(2)}` };
  }
  return { difficulty: "ADVANCED", reason: `strong: evidence ${evidence.toFixed(2)}` };
}

function scoreConcept(signal: ConceptSignalInput): Omit<Scored, "signal" | "difficulty"> {
  const reasons: string[] = [];

  const needBase =
    signal.masteryScore ?? signal.accuracy ?? UNKNOWN_NEED_PRIOR;
  const need = clamp01(1 - needBase);
  reasons.push(
    signal.masteryScore !== null
      ? `mastery ${(1 - signal.masteryScore).toFixed(2)}`
      : signal.accuracy !== null
        ? `accuracy-gap ${(1 - signal.accuracy).toFixed(2)}`
        : `unmeasured-prior ${need.toFixed(2)}`
  );

  const mistake = clamp01(signal.recentIncorrect / RECENT_WINDOW);
  if (signal.recentIncorrect > 0) {
    reasons.push(`recent-mistakes ${signal.recentIncorrect}`);
  }

  const freshness = signal.isNew
    ? 1
    : clamp01((signal.msSinceLastAnswered ?? FRESHNESS_FULL_MS) / FRESHNESS_FULL_MS);
  if (signal.isNew) reasons.push("unseen");

  const support = signal.supportsWeakConcept ? 1 : 0;
  if (signal.supportsWeakConcept) reasons.push("prerequisite-of-weak");

  const recentTotal = signal.recentCorrect + signal.recentIncorrect;
  const recentAccuracy = recentTotal > 0 ? signal.recentCorrect / recentTotal : 0.5;
  const form = clamp01(1 - recentAccuracy);
  if (recentTotal > 0 && recentAccuracy < 0.5) {
    reasons.push(`recent-form ${recentAccuracy.toFixed(2)}`);
  }

  const w = SELECTOR_WEIGHTS;
  const score = w.need * need + w.mistake * mistake + w.freshness * freshness + w.support * support + w.form * form;
  return { score, need, reasons };
}

/**
 * Rank concepts by adaptive score and deal targets round-robin for
 * diversity: every selected concept appears once before any concept gets
 * a second (deliberate repeated-exposure) slot. Dealing continues until
 * exactly `request.count` targets exist — the per-concept repetition is
 * unbounded by design so a small concept pool can still satisfy a large
 * request (e.g. 10 questions from 2 concepts). Occurrences beyond the
 * first carry a "repeated-exposure" reason. Question types alternate
 * around the preference so a quiz mixes MCQ and open-ended unless the
 * caller explicitly narrowed it.
 */
export function selectTargets(request: SelectionRequest): SelectionTarget[] {
  const pool = (
    request.conceptIds && request.conceptIds.length > 0
      ? request.concepts.filter((c) => request.conceptIds?.includes(c.conceptId))
      : [...request.concepts]
  );
  if (pool.length === 0 || request.count <= 0) return [];

  const scored: Scored[] = pool.map((signal) => {    const { score, need, reasons } = scoreConcept(signal);
    const fitted = request.difficulty ?? fitDifficulty(signal).difficulty;
    const fitReason = request.difficulty
      ? "explicit-practice-level"
      : fitDifficulty(signal).reason;
    return { signal, score, need, difficulty: fitted, reasons: [...reasons, fitReason] };
  });
  scored.sort((a, b) => b.score - a.score || (a.signal.conceptId < b.signal.conceptId ? -1 : 1));

  const counts = new Map<string, number>();
  const picks: Scored[] = [];
  // Round-robin passes: fairness first, deliberate repetition after.
  // No per-concept cap: passes continue until the requested count is met
  // so the caller always gets exactly `request.count` targets whenever at
  // least one concept is in scope (silently returning fewer is what made
  // "request 10, receive 6" possible with small concept pools).
  for (let pass = 0; picks.length < request.count; pass += 1) {
    for (const entry of scored) {
      if (picks.length >= request.count) break;
      if ((counts.get(entry.signal.conceptId) ?? 0) > pass) continue;
      counts.set(entry.signal.conceptId, (counts.get(entry.signal.conceptId) ?? 0) + 1);
      picks.push(entry);
    }
  }

  const seen = new Map<string, number>();
  return picks.map((entry, index) => {
    const occurrence = (seen.get(entry.signal.conceptId) ?? 0) + 1;
    seen.set(entry.signal.conceptId, occurrence);
    const reasons =
      occurrence > 1 ? [...entry.reasons, "repeated-exposure"] : entry.reasons;
    return {
      conceptId: entry.signal.conceptId,
      conceptName: entry.signal.name,
      difficulty: entry.difficulty,
      type: pickType(index, picks.length, request.typePreference),
      reasons,
    };
  });
}

function pickType(
  index: number,
  _total: number,
  preference?: "MCQ" | "OPEN_ENDED"
): "MCQ" | "OPEN_ENDED" {
  // An explicit preference wins outright — it is a deliberate learner
  // choice, not a suggestion. Without one, types alternate so quizzes mix.
  if (preference) return preference;
  return index % 2 === 0 ? "MCQ" : "OPEN_ENDED";
}
