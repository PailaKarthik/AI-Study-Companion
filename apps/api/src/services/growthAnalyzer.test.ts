import { describe, expect, it } from "vitest";
import { analyzeGrowth, type TrendEvent } from "./growthAnalyzer.js";

const DAY = 86_400_000;
const T0 = new Date("2026-09-01T00:00:00Z").getTime();

function events(scores: number[]): TrendEvent[] {
  return scores.map((newScore, i) => ({ newScore, createdAt: new Date(T0 + i * DAY) }));
}

const BASE = {
  recentAccuracy: null as number | null,
  recentIncorrect: 0,
  minEvents: 3,
  trendDelta: 0.05,
  weakBelow: 0.4,
  maxEvents: 20,
};

describe("analyzeGrowth", () => {
  it("returns INSUFFICIENT_DATA below the event minimum", () => {
    const out = analyzeGrowth({ ...BASE, events: events([0.2, 0.1]) });
    expect(out.trend).toBe("INSUFFICIENT_DATA");
    expect(out.trendStrength).toBe(0);
    expect(out.confidence).toBe(0);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("returns INSUFFICIENT_DATA for a single data point", () => {
    expect(analyzeGrowth({ ...BASE, events: events([0.9]) }).trend).toBe("INSUFFICIENT_DATA");
  });

  it("detects a meaningful positive trend", () => {
    const out = analyzeGrowth({ ...BASE, events: events([0.42, 0.48, 0.56, 0.63]) });
    expect(out.trend).toBe("IMPROVING");
    expect(out.trendStrength).toBeGreaterThan(0);
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.reasons.join(" ")).toContain("0.45");
  });

  it("detects stability in flat histories", () => {
    const out = analyzeGrowth({ ...BASE, events: events([0.7, 0.72, 0.71, 0.73]) });
    expect(out.trend).toBe("STABLE");
  });

  it("flags decline as needing attention", () => {
    const out = analyzeGrowth({ ...BASE, events: events([0.8, 0.72, 0.6, 0.5]) });
    expect(out.trend).toBe("NEEDS_ATTENTION");
  });

  it("does not label weak on one wrong answer alone", () => {
    // Low but flat history, no mistakes, decent accuracy: stable, not weak.
    const out = analyzeGrowth({
      ...BASE,
      events: events([0.35, 0.36, 0.35]),
      recentAccuracy: 0.6,
    });
    expect(out.trend).toBe("STABLE");
  });

  it("corroborates weakness with repeated mistakes", () => {
    const out = analyzeGrowth({
      ...BASE,
      events: events([0.38, 0.37, 0.36]),
      recentIncorrect: 3,
      recentAccuracy: 0.25,
    });
    expect(out.trend).toBe("NEEDS_ATTENTION");
    expect(out.reasons.join(" ")).toContain("3 recent incorrect");
  });

  it("bounds sparse-history confidence below deep histories", () => {
    const sparse = analyzeGrowth({ ...BASE, events: events([0.4, 0.5, 0.6]) });
    const deep = analyzeGrowth({
      ...BASE,
      events: events([0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]),
    });
    expect(sparse.trend).toBe("IMPROVING");
    expect(deep.confidence).toBeGreaterThan(sparse.confidence);
    expect(deep.confidence).toBeLessThanOrEqual(0.9);
  });

  it("clamps strength and confidence into [0, 1]", () => {
    const out = analyzeGrowth({ ...BASE, events: events([0, 0, 1, 1, 1]) });
    expect(out.trendStrength).toBeLessThanOrEqual(1);
    expect(out.confidence).toBeLessThanOrEqual(0.9);
  });
});
