import { describe, expect, it } from "vitest";
import { estimateCostUsd, priceForModel, pricingAsOf } from "./pricing.js";

describe("priceForModel", () => {
  it("prices known models case-insensitively", () => {
    expect(priceForModel("llama-3.3-70b-versatile")).toMatchObject({
      inputPerMillionUsd: expect.any(Number),
      outputPerMillionUsd: expect.any(Number),
    });
    expect(priceForModel("LLAMA-3.3-70B-VERSATILE")).toEqual(
      priceForModel("llama-3.3-70b-versatile")
    );
    expect(priceForModel("gemini-embedding-001")).not.toBeNull();
  });

  it("returns null for unknown models (cost unavailable, never invented)", () => {
    expect(priceForModel("gpt-99-ultra")).toBeNull();
    expect(priceForModel("")).toBeNull();
    expect(priceForModel("mock-quiz-v1")).toBeNull();
  });

  it("publishes a review date", () => {
    expect(pricingAsOf()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("estimateCostUsd", () => {
  it("computes token-proportional cost rounded to microdollars", () => {
    const one = estimateCostUsd("llama-3.3-70b-versatile", 1_000_000, 1_000_000);
    const price = priceForModel("llama-3.3-70b-versatile");
    expect(one).toBeCloseTo(
      (price?.inputPerMillionUsd ?? 0) + (price?.outputPerMillionUsd ?? 0),
      6
    );
    const half = estimateCostUsd("llama-3.3-70b-versatile", 500_000, 500_000);
    expect(half).toBeCloseTo((one ?? 0) / 2, 6);
  });

  it("handles embeddings (output-free) and zero-token calls", () => {
    const price = priceForModel("gemini-embedding-001");
    expect(estimateCostUsd("gemini-embedding-001", 1_000_000, 0)).toBeCloseTo(
      price?.inputPerMillionUsd ?? 0,
      6
    );
    expect(estimateCostUsd("llama-3.3-70b-versatile", 0, 0)).toBe(0);
  });

  it("returns null for unknown models and missing tokens", () => {
    expect(estimateCostUsd("unknown-model", 1000, 500)).toBeNull();
    expect(estimateCostUsd("llama-3.3-70b-versatile", null, null)).toBe(0);
    expect(estimateCostUsd("llama-3.3-70b-versatile", undefined, undefined)).toBe(0);
    expect(estimateCostUsd("llama-3.3-70b-versatile", -5, 10)).toBeNull();
  });
});
