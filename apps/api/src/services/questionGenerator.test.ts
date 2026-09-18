import { describe, expect, it } from "vitest";
import { fitDraftsToCount, normalizePrompt } from "./questionGenerator.js";

describe("fitDraftsToCount", () => {
  it.each([5, 10, 15])("keeps exactly %i drafts when generation matches", (n) => {
    const drafts = Array.from({ length: n }, (_, i) => ({ prompt: `Q${i + 1}` }));
    expect(fitDraftsToCount(drafts, n)).toHaveLength(n);
  });

  it.each([
    { made: 7, asked: 5 },
    { made: 12, asked: 10 },
    { made: 20, asked: 15 },
  ])("trims $made drafts down to $asked, preserving order", ({ made, asked }) => {
    const drafts = Array.from({ length: made }, (_, i) => ({ prompt: `Q${i + 1}` }));
    const fitted = fitDraftsToCount(drafts, asked);
    expect(fitted).toHaveLength(asked);
    expect(fitted[0]).toMatchObject({ prompt: "Q1" });
    expect(fitted[asked - 1]).toMatchObject({ prompt: `Q${asked}` });
  });

  it("keeps honest shortfalls as-is instead of fabricating", () => {
    const drafts = [{ prompt: "Q1" }, { prompt: "Q2" }];
    expect(fitDraftsToCount(drafts, 5)).toEqual(drafts);
    expect(fitDraftsToCount([], 5)).toEqual([]);
  });

  it("returns [] for non-positive requests", () => {
    expect(fitDraftsToCount([{ prompt: "Q1" }], 0)).toEqual([]);
    expect(fitDraftsToCount([{ prompt: "Q1" }], -2)).toEqual([]);
  });
});

describe("normalizePrompt", () => {
  it("collapses case, punctuation, and whitespace for dedup", () => {
    expect(normalizePrompt("  What IS Photosynthesis?! ")).toBe("what is photosynthesis");
  });
});
