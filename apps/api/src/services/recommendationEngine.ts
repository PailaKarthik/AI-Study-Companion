import type {
  GrowthTrend,
  RecommendationAction,
  RecommendationPriority,
} from "@ai-study-companion/shared";
import type { RecommendationType } from "@ai-study-companion/shared";

/**
 * Deterministic recommendation engine (Prompt 10). No LLM decides WHAT to
 * recommend — candidates, ranking, and explanations all derive from
 * persisted mastery, growth, mistakes, and concept relations.
 *
 * Type mapping onto the existing RecommendationType enum:
 * - REVISIT  → retry a missed/struggling concept (targeted practice)
 * - REVIEW   → review a weak concept (material when known, else practice)
 * - PRACTICE → practice a developing/improving concept
 * - EXPLORE  → move beyond a strong concept into related material
 * - NEXT_STEP → project-level next action (take a quiz)
 *
 * Every candidate carries a factual `reason` built from actual numbers.
 * Generic motivational filler is a bug, not a fallback.
 */

export interface RecommendationSignal {
  conceptId: string;
  conceptName: string;
  masteryScore: number | null;
  evidenceCount: number;
  trend: GrowthTrend;
  trendStrength: number;
  recentIncorrect: number;
  recentAccuracy: number | null;
  /** True when this concept is a prerequisite of a currently weak concept. */
  supportsWeakConcept: boolean;
  supportsConceptName: string | null;
  /** This concept's own weak prerequisite, if any. */
  blockedByPrereqName: string | null;
  /** A material containing this concept's chunks, for review targets. */
  materialId: string | null;
  materialName: string | null;
  /** Related concepts worth exploring once this one is strong. */
  relatedConcepts: { id: string; name: string }[];
}

export interface RecommendationCandidate {
  conceptId: string | null;
  conceptName: string | null;
  type: RecommendationType;
  title: string;
  description: string;
  reason: string;
  priority: RecommendationPriority;
  action: RecommendationAction;
  /** Internal rank score (higher = more urgent). Not persisted. */
  rankScore: number;
}

export interface EngineOptions {
  strongAt: number;
  attentionBelow: number;
  developingBelow: number;
}

const PRIORITY_RANK: Record<RecommendationPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function fmtScore(score: number | null): string {
  return score === null ? "unmeasured" : Math.round(score * 100).toString();
}

function practiceAction(conceptId: string): RecommendationAction {
  return { kind: "PRACTICE_CONCEPT", targetId: conceptId, label: "Practice now" };
}

function reviewAction(
  conceptId: string,
  materialId: string | null
): RecommendationAction {
  return materialId
    ? { kind: "REVIEW_MATERIAL", targetId: materialId, label: "Review material" }
    : { kind: "PRACTICE_CONCEPT", targetId: conceptId, label: "Practice now" };
}

function rankScore(
  priority: RecommendationPriority,
  masteryScore: number | null,
  recentIncorrect: number,
  prereqBoost: boolean
): number {
  const needGap = masteryScore === null ? 0.5 : 1 - masteryScore;
  return (
    PRIORITY_RANK[priority] * 10 +
    needGap * 5 +
    Math.min(2, recentIncorrect) +
    (prereqBoost ? 1.5 : 0)
  );
}

/**
 * Build ranked candidates for one project's concept signals. Pure:
 * same signals → same candidates in the same order.
 */
export function buildCandidates(
  signals: RecommendationSignal[],
  opts: EngineOptions
): RecommendationCandidate[] {
  const candidates: RecommendationCandidate[] = [];

  for (const s of signals) {
    // Unassessed concepts carry no signal — the project-level NEXT_STEP
    // fallback (below) covers "take your first quiz".
    if (s.masteryScore === null || s.evidenceCount === 0) continue;

    const score = s.masteryScore;

    if (s.trend === "NEEDS_ATTENTION" && s.recentIncorrect >= 2) {
      const priority: RecommendationPriority = "URGENT";
      candidates.push({
        conceptId: s.conceptId,
        conceptName: s.conceptName,
        type: "REVISIT",
        title: `Retry ${s.conceptName}`,
        description: `Targeted practice on ${s.conceptName} — the exact area recent answers missed.`,
        reason:
          `You've missed ${s.recentIncorrect} recent ${s.conceptName} questions ` +
          `and mastery sits at ${fmtScore(score)}. Retrying focused questions ` +
          `reinforces the concept before moving on.` +
          (s.blockedByPrereqName
            ? ` Note: ${s.blockedByPrereqName} is also weak and may be blocking this.`
            : ""),
        priority,
        action: practiceAction(s.conceptId),
        rankScore: rankScore(priority, score, s.recentIncorrect, s.supportsWeakConcept),
      });
      continue;
    }

    if (score < opts.attentionBelow || s.trend === "NEEDS_ATTENTION") {
      const priority: RecommendationPriority = "HIGH";
      const prereqNote = s.supportsWeakConcept && s.supportsConceptName
        ? ` Strengthening it also unlocks ${s.supportsConceptName}, which needs it as a foundation.`
        : "";
      candidates.push({
        conceptId: s.conceptId,
        conceptName: s.conceptName,
        type: "REVIEW",
        title: `Review ${s.conceptName}`,
        description:
          s.materialId && s.materialName
            ? `Revisit ${s.materialName} where ${s.conceptName} is covered.`
            : `Revisit ${s.conceptName} before attempting harder questions.`,
        reason:
          `${s.conceptName} mastery is ${fmtScore(score)}` +
          (s.recentAccuracy !== null
            ? ` with recent accuracy ${fmtScore(s.recentAccuracy)}`
            : " with no recent correct answers") +
          `.${prereqNote}`,
        priority,
        action: reviewAction(s.conceptId, s.materialId),
        rankScore: rankScore(priority, score, s.recentIncorrect, s.supportsWeakConcept),
      });
      continue;
    }

    if (s.supportsWeakConcept && s.supportsConceptName && score < opts.strongAt) {
      const priority: RecommendationPriority = "HIGH";
      candidates.push({
        conceptId: s.conceptId,
        conceptName: s.conceptName,
        type: "REVIEW",
        title: `Strengthen ${s.conceptName}`,
        description: `${s.supportsConceptName} builds on ${s.conceptName} — shore up the foundation first.`,
        reason:
          `${s.supportsConceptName} needs attention and lists ${s.conceptName} as a ` +
          `prerequisite (mastery ${fmtScore(score)}). Fixing the foundation first ` +
          `is the fastest path forward.`,
        priority,
        action: reviewAction(s.conceptId, s.materialId),
        rankScore: rankScore(priority, score, s.recentIncorrect, true),
      });
      continue;
    }

    if (s.trend === "IMPROVING") {
      const priority: RecommendationPriority = "LOW";
      candidates.push({
        conceptId: s.conceptId,
        conceptName: s.conceptName,
        type: "PRACTICE",
        title: `Keep practicing ${s.conceptName}`,
        description: `Mastery is climbing — continued practice cements it.`,
        reason:
          `${s.conceptName} is improving (mastery ${fmtScore(score)} and rising). ` +
          `No remediation needed; steady practice locks in the gain.`,
        priority,
        action: practiceAction(s.conceptId),
        rankScore: rankScore(priority, score, s.recentIncorrect, false),
      });
      continue;
    }

    if (score < opts.developingBelow) {
      const priority: RecommendationPriority = "MEDIUM";
      candidates.push({
        conceptId: s.conceptId,
        conceptName: s.conceptName,
        type: "PRACTICE",
        title: `Practice ${s.conceptName}`,
        description: `Mixed questions on ${s.conceptName} at your current level.`,
        reason:
          `${s.conceptName} is developing at ${fmtScore(score)}. ` +
          `Regular practice at this level builds toward stable mastery.`,
        priority,
        action: practiceAction(s.conceptId),
        rankScore: rankScore(priority, score, s.recentIncorrect, false),
      });
      continue;
    }

    if (score >= opts.strongAt && s.relatedConcepts.length > 0) {
      const next = s.relatedConcepts[0] as { id: string; name: string };
      const priority: RecommendationPriority = "LOW";
      candidates.push({
        conceptId: next.id,
        conceptName: next.name,
        type: "EXPLORE",
        title: `Explore ${next.name}`,
        description: `${s.conceptName} is solid — stretch into related ${next.name}.`,
        reason:
          `${s.conceptName} mastery is ${fmtScore(score)} with consistent ` +
          `performance. Progress now comes from adjacent concepts, starting ` +
          `with ${next.name}.`,
        priority,
        action: practiceAction(next.id),
        rankScore: rankScore(priority, score, 0, false),
      });
    }
    // Strong with nowhere to go, or stable mid-range: no candidate. The
    // engine stays silent rather than inventing busywork.
  }

  candidates.sort(
    (a, b) => b.rankScore - a.rankScore || (a.conceptId ?? "").localeCompare(b.conceptId ?? "")
  );
  return candidates;
}

/** Project-level fallback when nothing else fires (concepts exist, none assessed). */
export function fallbackCandidate(hasConcepts: boolean): RecommendationCandidate | null {
  if (!hasConcepts) return null;
  return {
    conceptId: null,
    conceptName: null,
    type: "NEXT_STEP",
    title: "Take a quiz to start building your profile",
    description: "Answer a few questions so mastery can be measured from real evidence.",
    reason:
      "This project has concepts but no assessed evidence yet. " +
      "A short quiz produces the first real mastery signal.",
    priority: "LOW",
    action: { kind: "TAKE_QUIZ", targetId: null, label: "Take a quiz" },
    rankScore: 5,
  };
}

/**
 * Drop candidates that duplicate an already-pending recommendation
 * (same concept + type). Pure — the service owns persistence.
 */
export function dedupeCandidates(
  candidates: RecommendationCandidate[],
  pending: { conceptId: string | null; type: RecommendationType }[]
): RecommendationCandidate[] {
  const seen = new Set(pending.map((p) => `${p.type}::${p.conceptId ?? ""}`));
  return candidates.filter((c) => {
    const key = `${c.type}::${c.conceptId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
