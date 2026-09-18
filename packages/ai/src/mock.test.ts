import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import { MockEmbeddingProvider, mockVector } from "./mock.js";
import { approximateInputTokens } from "./types.js";

describe("MockEmbeddingProvider", () => {
  it("is deterministic across instances and calls", async () => {
    const a = new MockEmbeddingProvider();
    const b = new MockEmbeddingProvider();
    const first = await a.embedBatch({ texts: ["hello world"], taskType: "RETRIEVAL_DOCUMENT" });
    const second = await b.embedBatch({ texts: ["hello world"], taskType: "RETRIEVAL_DOCUMENT" });
    expect(first.vectors[0]).toEqual(second.vectors[0]);
    expect(first.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("produces distinct unit-normed vectors per text", () => {
    const v1 = mockVector("alpha", EMBEDDING_DIMENSIONS);
    const v2 = mockVector("beta", EMBEDDING_DIMENSIONS);
    expect(v1).not.toEqual(v2);
    for (const v of [v1, v2]) {
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      expect(norm).toBeCloseTo(1, 10);
    }
  });

  it("counts calls so tests can assert no redundant work", async () => {
    const provider = new MockEmbeddingProvider();
    await provider.embedBatch({ texts: ["a"], taskType: "RETRIEVAL_DOCUMENT" });
    await provider.embedBatch({ texts: ["b", "c"], taskType: "RETRIEVAL_QUERY" });
    expect(provider.calls).toBe(2);
  });
});

describe("approximateInputTokens", () => {
  it("estimates chars/4 rounded up with a floor of 1", () => {
    expect(approximateInputTokens("")).toBe(1);
    expect(approximateInputTokens("abcd")).toBe(1);
    expect(approximateInputTokens("abcde")).toBe(2);
  });
});
