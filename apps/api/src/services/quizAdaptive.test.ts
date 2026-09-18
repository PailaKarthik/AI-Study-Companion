import { describe, expect, it } from "vitest";
import {
  fitDifficulty,
  selectTargets,
  type ConceptSignalInput,
} from "./quizAdaptive.js";

function signal(overrides: Partial<ConceptSignalInput> & { conceptId: string }): ConceptSignalInput {
  return {
    name: overrides.conceptId,
    masteryScore: null,
    accuracy: null,
    recentIncorrect: 0,
    recentCorrect: 0,
    isNew: true,
    supportsWeakConcept: false,
    msSinceLastAnswered: null,
    ...overrides,
  };
}

describe("fitDifficulty", () => {
  it("fits from aggregate evidence, never a single answer", () => {
    expect(fitDifficulty({ masteryScore: 0.2, accuracy: 0.9 }).difficulty).toBe("BEGINNER");
    expect(fitDifficulty({ masteryScore: 0.9, accuracy: 0.1 }).difficulty).toBe("ADVANCED");
    expect(fitDifficulty({ masteryScore: null, accuracy: 0.5 }).difficulty).toBe(
      "INTERMEDIATE"
    );
  });

  it("uses a stated neutral default instead of fake mastery", () => {
    const fitted = fitDifficulty({ masteryScore: null, accuracy: null });
    expect(fitted.difficulty).toBe("INTERMEDIATE");
    expect(fitted.reason).toMatch(/unmeasured/);
  });
});

describe("selectTargets", () => {
  it("prioritizes concept weakness over strength", () => {
    const targets = selectTargets({
      concepts: [
        signal({ conceptId: "strong", accuracy: 0.95, recentCorrect: 5, isNew: false, msSinceLastAnswered: 1000 }),
        signal({ conceptId: "weak", accuracy: 0.2, recentIncorrect: 3, isNew: false, msSinceLastAnswered: 1000 }),
      ],
      count: 1,
    });
    expect(targets[0]?.conceptId).toBe("weak");
    expect(targets[0]?.reasons.join(" ")).toMatch(/weakness|recent-mistakes/);
  });

  it("a correct answer alone does not force harder difficulty elsewhere", () => {
    // All concepts recently correct: selection must NOT escalate everything
    // to ADVANCED — difficulty comes from aggregate evidence per concept.
    const targets = selectTargets({
      concepts: [
        signal({ conceptId: "a", accuracy: 1, recentCorrect: 5, isNew: false, msSinceLastAnswered: 1000 }),
        signal({ conceptId: "b", accuracy: 0.6, recentCorrect: 3, recentIncorrect: 2, isNew: false, msSinceLastAnswered: 1000 }),
      ],
      count: 2,
    });
    const byId = new Map(targets.map((t) => [t.conceptId, t]));
    expect(byId.get("a")?.difficulty).toBe("ADVANCED"); // aggregate 1.0 earns it
    expect(byId.get("b")?.difficulty).toBe("INTERMEDIATE"); // aggregate 0.6, not forced down/up by one answer
  });

  it("one wrong answer does not force the easiest level everywhere", () => {
    const targets = selectTargets({
      concepts: [
        signal({ conceptId: "slip", accuracy: 0.9, recentCorrect: 4, recentIncorrect: 1, isNew: false, msSinceLastAnswered: 1000 }),
        signal({ conceptId: "new", isNew: true }),
      ],
      count: 2,
    });
    const byId = new Map(targets.map((t) => [t.conceptId, t]));
    expect(byId.get("slip")?.difficulty).toBe("ADVANCED");
    expect(byId.get("new")?.difficulty).toBe("INTERMEDIATE");
  });

  it("boosts prerequisites of weak concepts", () => {
    const targets = selectTargets({
      concepts: [
        signal({ conceptId: "foundation", accuracy: 0.8, isNew: false, msSinceLastAnswered: 1000, supportsWeakConcept: true }),
        signal({ conceptId: "neutral", accuracy: 0.8, isNew: false, msSinceLastAnswered: 1000 }),
      ],
      count: 1,
    });
    expect(targets[0]?.conceptId).toBe("foundation");
    expect(targets[0]?.reasons).toContain("prerequisite-of-weak");
  });

  it("prefers unseen concepts over recently drilled ones", () => {
    const targets = selectTargets({
      concepts: [
        signal({ conceptId: "drilled", accuracy: 0.7, recentCorrect: 2, isNew: false, msSinceLastAnswered: 60_000 }),
        signal({ conceptId: "unseen", accuracy: null }),
      ],
      count: 1,
    });
    expect(targets[0]?.conceptId).toBe("unseen");
  });

  it("deals round-robin for diversity before repeating concepts", () => {
    const targets = selectTargets({
      concepts: [signal({ conceptId: "a" }), signal({ conceptId: "b" }), signal({ conceptId: "c" })],
      count: 3,
    });
    expect(new Set(targets.map((t) => t.conceptId)).size).toBe(3);
    expect(targets.some((t) => (t.reasons ?? []).includes("repeated-exposure"))).toBe(false);
  });

  it("repeats weak concepts deliberately when slots exceed concepts", () => {
    const targets = selectTargets({
      concepts: [signal({ conceptId: "only", accuracy: 0.1, recentIncorrect: 4, isNew: false, msSinceLastAnswered: 1000 })],
      count: 3,
    });
    expect(targets).toHaveLength(3);
    expect(targets[1]?.reasons).toContain("repeated-exposure");
  });

  it("mixes question types by default and honors an explicit preference", () => {
    const concepts = ["a", "b", "c", "d"].map((conceptId) => signal({ conceptId }));
    const mixed = selectTargets({ concepts, count: 4 });
    expect(new Set(mixed.map((t) => t.type)).size).toBe(2);

    const biased = selectTargets({ concepts, count: 4, typePreference: "OPEN_ENDED" });
    expect(biased.every((t) => t.type === "OPEN_ENDED")).toBe(true);
  });

  it("is deterministic: same signals, same order", () => {
    const concepts = ["x", "y", "z"].map((conceptId) => signal({ conceptId }));
    const first = selectTargets({ concepts, count: 3 });
    const second = selectTargets({ concepts: [...concepts].reverse(), count: 3 });
    expect(second).toEqual(first);
  });

  it("respects CONCEPT_FOCUS allowlists and explicit difficulty", () => {
    const targets = selectTargets({
      concepts: [signal({ conceptId: "a" }), signal({ conceptId: "b" })],
      count: 2,
      conceptIds: ["b"],
      difficulty: "BEGINNER",
    });
    expect(targets.map((t) => t.conceptId)).toEqual(["b", "b"]);
    expect(targets.every((t) => t.difficulty === "BEGINNER")).toBe(true);
  });

  it("returns [] without inventing targets for empty input", () => {
    expect(selectTargets({ concepts: [], count: 5 })).toEqual([]);
    expect(selectTargets({ concepts: [signal({ conceptId: "a" })], count: 0 })).toEqual([]);
  });

  it.each([5, 10, 15])("deals exactly %i targets from a small pool", (count) => {
    const targets = selectTargets({
      concepts: [signal({ conceptId: "a" }), signal({ conceptId: "b" })],
      count,
    });
    expect(targets).toHaveLength(count);
    // Diversity first: both concepts appear before any repetition.
    expect(new Set(targets.slice(0, 2).map((t) => t.conceptId)).size).toBe(2);
  });

  it("fills 10 targets from a single concept with repetition reasons", () => {
    const targets = selectTargets({ concepts: [signal({ conceptId: "only" })], count: 10 });
    expect(targets).toHaveLength(10);
    expect(targets.every((t) => t.conceptId === "only")).toBe(true);
    expect(targets.slice(1).every((t) => t.reasons.includes("repeated-exposure"))).toBe(true);
  });
});
