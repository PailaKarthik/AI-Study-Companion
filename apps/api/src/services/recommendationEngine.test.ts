import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  dedupeCandidates,
  fallbackCandidate,
  type RecommendationSignal,
} from "./recommendationEngine.js";

const OPTS = { strongAt: 0.8, attentionBelow: 0.4, developingBelow: 0.65 };

function signal(overrides: Partial<RecommendationSignal> & { conceptId: string }): RecommendationSignal {
  return {
    conceptName: overrides.conceptId,
    masteryScore: 0.5,
    evidenceCount: 3,
    trend: "STABLE",
    trendStrength: 0,
    recentIncorrect: 0,
    recentAccuracy: 0.5,
    supportsWeakConcept: false,
    supportsConceptName: null,
    blockedByPrereqName: null,
    materialId: null,
    materialName: null,
    relatedConcepts: [],
    ...overrides,
  };
}

describe("buildCandidates", () => {
  it("recommends review for low mastery with factual reasons", () => {
    const [rec] = buildCandidates(
      [signal({ conceptId: "c1", conceptName: "JOINs", masteryScore: 0.25, recentAccuracy: 0.2 })],
      OPTS
    );
    expect(rec?.type).toBe("REVIEW");
    expect(rec?.priority).toBe("HIGH");
    expect(rec?.title).toContain("JOINs");
    expect(rec?.reason).toContain("25");
    expect(rec?.action.kind).toBe("PRACTICE_CONCEPT");
  });

  it("prefers material review targets when a material is known", () => {
    const [rec] = buildCandidates(
      [
        signal({
          conceptId: "c1",
          masteryScore: 0.2,
          materialId: "m1",
          materialName: "SQL Notes",
        }),
      ],
      OPTS
    );
    expect(rec?.action).toMatchObject({ kind: "REVIEW_MATERIAL", targetId: "m1" });
  });

  it("escalates repeated mistakes to urgent targeted practice", () => {
    const [rec] = buildCandidates(
      [
        signal({
          conceptId: "c1",
          conceptName: "JOINs",
          masteryScore: 0.35,
          trend: "NEEDS_ATTENTION",
          recentIncorrect: 3,
        }),
      ],
      OPTS
    );
    expect(rec?.type).toBe("REVISIT");
    expect(rec?.priority).toBe("URGENT");
    expect(rec?.reason).toContain("3 recent");
  });

  it("routes prerequisite weakness to the foundation first", () => {
    const [rec] = buildCandidates(
      [
        signal({
          conceptId: "c1",
          conceptName: "Keys",
          masteryScore: 0.5,
          trend: "STABLE",
          supportsWeakConcept: true,
          supportsConceptName: "JOINs",
        }),
      ],
      OPTS
    );
    expect(rec?.type).toBe("REVIEW");
    expect(rec?.reason).toContain("JOINs");
    expect(rec?.reason).toContain("prerequisite");
  });

  it("suggests continued practice — not remediation — for improving concepts", () => {
    const [rec] = buildCandidates(
      [
        signal({
          conceptId: "c1",
          conceptName: "Views",
          masteryScore: 0.55,
          trend: "IMPROVING",
          trendStrength: 0.5,
        }),
      ],
      OPTS
    );
    expect(rec?.type).toBe("PRACTICE");
    expect(rec?.priority).toBe("LOW");
    expect(rec?.reason).toContain("improving");
  });

  it("progresses strong concepts into related material", () => {
    const [rec] = buildCandidates(
      [
        signal({
          conceptId: "c1",
          conceptName: "SELECT",
          masteryScore: 0.9,
          trend: "STABLE",
          relatedConcepts: [{ id: "c2", name: "Subqueries" }],
        }),
      ],
      OPTS
    );
    expect(rec?.type).toBe("EXPLORE");
    expect(rec?.conceptId).toBe("c2");
    expect(rec?.title).toContain("Subqueries");
  });

  it("stays silent for strong concepts with nowhere to go", () => {
    expect(
      buildCandidates([signal({ conceptId: "c1", masteryScore: 0.9, trend: "STABLE" })], OPTS)
    ).toEqual([]);
  });

  it("skips unassessed concepts (no signal, no recommendation)", () => {
    expect(
      buildCandidates([signal({ conceptId: "c1", masteryScore: null, evidenceCount: 0 })], OPTS)
    ).toEqual([]);
  });

  it("ranks urgent mistakes above low-mastery review", () => {
    const recs = buildCandidates(
      [
        signal({ conceptId: "low", masteryScore: 0.2, trend: "STABLE" }),
        signal({
          conceptId: "missed",
          masteryScore: 0.35,
          trend: "NEEDS_ATTENTION",
          recentIncorrect: 4,
        }),
      ],
      OPTS
    );
    expect(recs[0]?.conceptId).toBe("missed");
    expect(recs[1]?.conceptId).toBe("low");
  });

  it("is deterministic for tied signals", () => {
    const a = buildCandidates(
      [signal({ conceptId: "b" }), signal({ conceptId: "a" })],
      OPTS
    ).map((c) => c.conceptId);
    const b = buildCandidates(
      [signal({ conceptId: "a" }), signal({ conceptId: "b" })],
      OPTS
    ).map((c) => c.conceptId);
    expect(a).toEqual(b);
  });
});

describe("fallbackCandidate", () => {
  it("offers a first-quiz step when concepts exist but nothing is assessed", () => {
    const rec = fallbackCandidate(true);
    expect(rec?.type).toBe("NEXT_STEP");
    expect(rec?.conceptId).toBeNull();
    expect(rec?.action.kind).toBe("TAKE_QUIZ");
  });

  it("returns null with no concepts (honest empty state)", () => {
    expect(fallbackCandidate(false)).toBeNull();
  });
});

describe("dedupeCandidates", () => {
  it("drops candidates duplicating pending rows but keeps the rest", () => {
    const recs = buildCandidates(
      [
        signal({ conceptId: "a", masteryScore: 0.2 }),
        signal({ conceptId: "b", masteryScore: 0.25 }),
      ],
      OPTS
    );
    const pending = [{ conceptId: "a", type: "REVIEW" as const }];
    const out = dedupeCandidates(recs, pending);
    expect(out.map((c) => c.conceptId)).toEqual(["b"]);
  });

  it("dedupes within the batch itself", () => {
    const recs = buildCandidates([signal({ conceptId: "a", masteryScore: 0.2 })], OPTS);
    const out = dedupeCandidates([...recs, ...recs], []);
    expect(out).toHaveLength(1);
  });
});
