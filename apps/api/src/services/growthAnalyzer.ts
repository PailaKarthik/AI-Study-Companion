import type { GrowthTrend } from "@ai-study-companion/shared";

/**
 * Deterministic growth analysis over MasteryEvent history (Prompt 10).
 *
 * Method: split the (bounded, time-ordered) event window into an older
 * half and a recent half; the gap between half-means is the trend signal.
 * A single score is never a trend — fewer than `minEvents` events yields
 * INSUFFICIENT_DATA, and a lone wrong answer cannot flag a concept.
 *
 * NEEDS_ATTENTION requires corroboration: a real decline, or a weak
 * recent level PLUS poor form (low recent accuracy or repeated recent
 * mistakes). Confidence scales with history depth and signal size; it is
 * an internal product signal, not statistical certainty.
 */

export interface TrendEvent {
  newScore: number;
  createdAt: Date;
}

export interface GrowthInput {
  /** Ascending by createdAt. The analyzer bounds the window itself. */
  events: TrendEvent[];
  /** Recent response accuracy for the concept, null when never answered. */
  recentAccuracy: number | null;
  /** Incorrect responses in the recent window. */
  recentIncorrect: number;
  minEvents: number;
  trendDelta: number;
  weakBelow: number;
  maxEvents: number;
}

export interface GrowthOutput {
  trend: GrowthTrend;
  /** |recent − older| scaled to [0, 1]; 0 when INSUFFICIENT_DATA. */
  trendStrength: number;
  confidence: number;
  /** Factual, learner-safe drivers. */
  reasons: string[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function analyzeGrowth(input: GrowthInput): GrowthOutput {
  const window = input.events.slice(-Math.max(1, input.maxEvents));
  if (window.length < input.minEvents) {
    return {
      trend: "INSUFFICIENT_DATA",
      trendStrength: 0,
      confidence: 0,
      reasons: ["Not enough assessed evidence yet"],
    };
  }

  const recentCount = Math.max(1, Math.ceil(window.length / 2));
  const recent = window.slice(-recentCount).map((e) => clamp01(e.newScore));
  const older = window.slice(0, window.length - recentCount).map((e) => clamp01(e.newScore));
  const recentMean = mean(recent);
  const olderMean = older.length > 0 ? mean(older) : recentMean;
  const delta = recentMean - olderMean;
  const trendStrength = clamp01(Math.abs(delta) / 0.3);

  const reasons: string[] = [
    `Mastery moved ${olderMean.toFixed(2)} → ${recentMean.toFixed(2)} over ${window.length} assessments`,
  ];
  if (input.recentIncorrect > 0) {
    reasons.push(
      `${input.recentIncorrect} recent incorrect answer${input.recentIncorrect === 1 ? "" : "s"}`
    );
  }
  if (input.recentAccuracy !== null) {
    reasons.push(`Recent accuracy ${(input.recentAccuracy * 100).toFixed(0)}%`);
  }

  const weakLevel = recentMean < input.weakBelow;
  const poorForm =
    delta < 0 ||
    (input.recentAccuracy !== null && input.recentAccuracy < 0.5) ||
    input.recentIncorrect >= 2;

  let trend: GrowthTrend;
  if (weakLevel && poorForm) {
    trend = "NEEDS_ATTENTION";
  } else if (delta >= input.trendDelta) {
    trend = "IMPROVING";
  } else if (delta <= -input.trendDelta) {
    trend = "NEEDS_ATTENTION";
  } else {
    trend = "STABLE";
  }

  const depthBonus = Math.min(0.3, 0.07 * (window.length - input.minEvents));
  const signalBonus = Math.abs(delta) >= 2 * input.trendDelta ? 0.1 : 0;
  const confidence = Math.min(0.9, 0.4 + depthBonus + signalBonus);

  return { trend, trendStrength, confidence, reasons };
}
