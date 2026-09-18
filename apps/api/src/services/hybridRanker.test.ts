import { describe, expect, it } from "vitest";
import { normalizeWeights, rankHybrid, semanticDistanceToSimilarity } from "./hybridRanker.js";

describe("semanticDistanceToSimilarity", () => {
  it("maps cosine distance [0,2] to similarity [1,0]", () => {
    expect(semanticDistanceToSimilarity(0)).toBe(1);
    expect(semanticDistanceToSimilarity(1)).toBe(0.5);
    expect(semanticDistanceToSimilarity(2)).toBe(0);
  });

  it("clamps out-of-range distances", () => {
    expect(semanticDistanceToSimilarity(-1)).toBe(1);
    expect(semanticDistanceToSimilarity(5)).toBe(0);
  });
});

describe("normalizeWeights", () => {
  it("scales weights to sum 1", () => {
    expect(normalizeWeights({ semanticWeight: 7, lexicalWeight: 3 })).toEqual({
      semanticWeight: 0.7,
      lexicalWeight: 0.3,
    });
  });

  it("rejects non-positive totals", () => {
    expect(() => normalizeWeights({ semanticWeight: 0, lexicalWeight: 0 })).toThrow();
  });
});

describe("rankHybrid", () => {
  const weights = { semanticWeight: 0.7, lexicalWeight: 0.3 };

  it("ranks best-of-both above single-path candidates", () => {
    const ranked = rankHybrid(
      [
        { key: "lex-only", semanticDistance: null, lexicalRank: 5, value: "l" },
        { key: "both", semanticDistance: 0.1, lexicalRank: 5, value: "b" },
        { key: "sem-only", semanticDistance: 0.1, lexicalRank: null, value: "s" },
      ],
      weights,
      10
    );
    expect(ranked.map((r) => r.key)).toEqual(["both", "sem-only", "lex-only"]);
    expect(ranked[0]).toMatchObject({
      semantic: expect.any(Number),
      lexical: expect.any(Number),
    });
    expect(ranked[2]?.semantic).toBeNull();
  });

  it("dedupes by key is the caller's job; equal scores break ties by key", () => {
    const ranked = rankHybrid(
      [
        { key: "b", semanticDistance: null, lexicalRank: 3, value: 1 },
        { key: "a", semanticDistance: null, lexicalRank: 3, value: 2 },
      ],
      weights,
      10
    );
    expect(ranked.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("caps at the limit", () => {
    const ranked = rankHybrid(
      [0, 1, 2, 3, 4].map((i) => ({
        key: `k${i}`,
        semanticDistance: i * 0.1,
        lexicalRank: null,
        value: i,
      })),
      weights,
      2
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.key).toBe("k0");
  });

  it("returns [] for no candidates (never fabricated)", () => {
    expect(rankHybrid([], weights, 8)).toEqual([]);
  });
});
