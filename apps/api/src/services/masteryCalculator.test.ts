import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  confidenceFor,
  difficultyFactor,
  effectiveWeight,
  recencyFactor,
  statusForScore,
  type EvidenceItem,
  type MasteryWeights,
} from "./masteryCalculator.js";

const WEIGHTS: MasteryWeights = {
  quiz: 0.45,
  openEnded: 0.35,
  activity: 0.1,
  tutor: 0.1,
  maxSingleWeight: 0.6,
  recencyHalfLifeDays: 30,
  recencyFloor: 0.4,
};

const BANDS = { attentionBelow: 0.4, developingBelow: 0.65, strongAt: 0.8 };
const NOW = new Date("2026-09-17T00:00:00Z");

function item(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    kind: "QUIZ",
    score: 1,
    quality: 1,
    difficulty: "INTERMEDIATE",
    correct: true,
    occurredAt: NOW,
    ...overrides,
  };
}

describe("applyEvidence", () => {
  it("returns null for empty evidence (no event, no write)", () => {
    expect(
      applyEvidence({ oldMastery: 0.5, oldEvidenceCount: 3, evidence: [], weights: WEIGHTS, now: NOW })
    ).toBeNull();
  });

  it("moves first evidence from the zero prior without fake priors", () => {
    const out = applyEvidence({
      oldMastery: 0,
      oldEvidenceCount: 0,
      evidence: [item({ score: 1 })],
      weights: WEIGHTS,
      now: NOW,
    });
    expect(out).not.toBeNull();
    // w = 0.45 × 1.0 × 1 × 1 = 0.45 → 0 × 0.55 + 1 × 0.45
    expect(out?.newMastery).toBeCloseTo(0.45, 5);
    expect(out?.evidenceCount).toBe(1);
  });

  it("applies negative evidence downward", () => {
    const out = applyEvidence({
      oldMastery: 0.6,
      oldEvidenceCount: 4,
      evidence: [item({ score: 0, correct: false })],
      weights: WEIGHTS,
      now: NOW,
    });
    // w = 0.45 → 0.6 × 0.55 + 0 × 0.45 = 0.33
    expect(out?.newMastery).toBeCloseTo(0.33, 5);
    expect(out?.delta).toBeLessThan(0);
  });

  it("weights hard-correct above easy-correct", () => {
    const hard = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ difficulty: "ADVANCED" })], weights: WEIGHTS, now: NOW,
    });
    const easy = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ difficulty: "BEGINNER" })], weights: WEIGHTS, now: NOW,
    });
    expect(hard?.newMastery).toBeGreaterThan(easy?.newMastery ?? 0);
  });

  it("treats easy-wrong as a stronger gap than hard-wrong", () => {
    const easyWrong = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ score: 0, correct: false, difficulty: "BEGINNER" })],
      weights: WEIGHTS, now: NOW,
    });
    const hardWrong = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ score: 0, correct: false, difficulty: "ADVANCED" })],
      weights: WEIGHTS, now: NOW,
    });
    expect(easyWrong?.newMastery).toBeLessThan(hardWrong?.newMastery ?? 1);
  });

  it("discounts uncertain open-ended evidence by evaluator confidence", () => {
    const sure = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ kind: "OPEN_ENDED_ASSESSMENT", score: 0.8, quality: 0.9 })],
      weights: WEIGHTS, now: NOW,
    });
    const unsure = applyEvidence({
      oldMastery: 0.5, oldEvidenceCount: 2,
      evidence: [item({ kind: "OPEN_ENDED_ASSESSMENT", score: 0.8, quality: 0.2 })],
      weights: WEIGHTS, now: NOW,
    });
    expect(sure?.newMastery).toBeGreaterThan(unsure?.newMastery ?? 0);
  });

  it("caps a single item so one question cannot radicalize mastery", () => {
    const out = applyEvidence({
      oldMastery: 0,
      oldEvidenceCount: 0,
      evidence: [item({ kind: "QUIZ", difficulty: "ADVANCED" })],
      weights: { ...WEIGHTS, maxSingleWeight: 0.6 },
      now: NOW,
    });
    // raw w would be 0.45 × 1.25 = 0.5625 < 0.6 → applies fully here…
    expect(out?.newMastery).toBeCloseTo(0.5625, 4);
    const capped = effectiveWeight(
      item({ kind: "QUIZ", difficulty: "ADVANCED" }),
      { ...WEIGHTS, maxSingleWeight: 0.1 },
      NOW
    );
    expect(capped).toBeLessThanOrEqual(0.1);
  });

  it("bounds repeated mistakes without runaway negatives", () => {
    let mastery = 0.5;
    let count = 2;
    for (let i = 0; i < 10; i += 1) {
      const out = applyEvidence({
        oldMastery: mastery, oldEvidenceCount: count,
        evidence: [item({ score: 0, correct: false, difficulty: "INTERMEDIATE" })],
        weights: WEIGHTS, now: NOW,
      });
      mastery = out?.newMastery ?? mastery;
      count = out?.evidenceCount ?? count;
    }
    expect(mastery).toBeGreaterThanOrEqual(0);
    expect(mastery).toBeLessThan(0.2);
  });

  it("shows diminishing returns on repeated trivial success", () => {
    let mastery = 0;
    let count = 0;
    for (let i = 0; i < 6; i += 1) {
      const out = applyEvidence({
        oldMastery: mastery, oldEvidenceCount: count,
        evidence: [item({ score: 1, difficulty: "BEGINNER" })],
        weights: WEIGHTS, now: NOW,
      });
      mastery = out?.newMastery ?? mastery;
      count = out?.evidenceCount ?? count;
    }
    // Six easy-corrects converge toward — but never instantly hit — 1.
    expect(mastery).toBeGreaterThan(0.8);
    expect(mastery).toBeLessThan(1);
  });

  it("clamps scores into [0, 1] always", () => {
    const out = applyEvidence({
      oldMastery: 0.99, oldEvidenceCount: 9,
      evidence: [item({ score: 2 }), item({ score: -5, correct: false })],
      weights: WEIGHTS, now: NOW,
    });
    expect(out?.newMastery).toBeGreaterThanOrEqual(0);
    expect(out?.newMastery).toBeLessThanOrEqual(1);
  });
});

describe("recencyFactor", () => {
  it("is 1 for fresh evidence and decays toward the floor", () => {
    expect(recencyFactor(NOW, NOW, 30, 0.4)).toBe(1);
    const old = new Date(NOW.getTime() - 365 * 86_400_000);
    expect(recencyFactor(old, NOW, 30, 0.4)).toBe(0.4);
    const mid = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(recencyFactor(mid, NOW, 30, 0.4)).toBeCloseTo(0.5, 5);
  });
});

describe("difficultyFactor", () => {
  it("is asymmetric by design", () => {
    expect(difficultyFactor("ADVANCED", true)).toBeGreaterThan(difficultyFactor("BEGINNER", true));
    expect(difficultyFactor("BEGINNER", false)).toBeGreaterThan(difficultyFactor("ADVANCED", false));
    expect(difficultyFactor(null, true)).toBe(1);
  });
});

describe("confidenceFor", () => {
  it("grows with evidence and caps", () => {
    expect(confidenceFor(0)).toBe(0);
    expect(confidenceFor(1)).toBeCloseTo(1 / 3, 5);
    expect(confidenceFor(4)).toBeGreaterThan(confidenceFor(1));
    expect(confidenceFor(10_000)).toBe(0.95);
  });
});

describe("statusForScore", () => {
  it("bands scores deterministically", () => {
    expect(statusForScore(0.2, BANDS)).toBe("NEEDS_ATTENTION");
    expect(statusForScore(0.5, BANDS)).toBe("DEVELOPING");
    expect(statusForScore(0.7, BANDS)).toBe("STABLE");
    expect(statusForScore(0.9, BANDS)).toBe("STRONG");
  });
});
