import { describe, expect, it } from "vitest";
import { normalizePrompt } from "./questionGenerator.js";
import { extractJsonPayload } from "./quizLlm.js";
import { structuredEvaluationSchema } from "./quizEvaluation.js";

describe("normalizePrompt", () => {
  it("collapses case, punctuation, and whitespace for duplicate detection", () => {
    expect(normalizePrompt("What is Mitosis?!")).toBe(normalizePrompt("  what   is mitosis "));
    expect(normalizePrompt("Photosynthesis")).not.toBe(normalizePrompt("Mitosis"));
  });
});

describe("extractJsonPayload", () => {
  it("strips markdown fences", () => {
    expect(extractJsonPayload('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it("passes bare JSON through", () => {
    expect(extractJsonPayload('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe("structuredEvaluationSchema", () => {
  const valid = {
    score: 0.78,
    correct: true,
    coveredConcepts: ["mitosis"],
    missingConcepts: ["meiosis"],
    misconceptions: [],
    reasoningQuality: "GOOD",
    feedback: "Solid explanation; contrast with meiosis next.",
    confidence: 0.84,
  };

  it("accepts a valid evaluation", () => {
    expect(structuredEvaluationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects out-of-range scores and confidence", () => {
    expect(structuredEvaluationSchema.safeParse({ ...valid, score: 1.5 }).success).toBe(false);
    expect(structuredEvaluationSchema.safeParse({ ...valid, score: -0.1 }).success).toBe(false);
    expect(structuredEvaluationSchema.safeParse({ ...valid, confidence: 2 }).success).toBe(false);
  });

  it("rejects unknown reasoning quality and oversized arrays", () => {
    expect(
      structuredEvaluationSchema.safeParse({ ...valid, reasoningQuality: "GREAT" }).success
    ).toBe(false);
    expect(
      structuredEvaluationSchema.safeParse({
        ...valid,
        coveredConcepts: Array.from({ length: 11 }, (_, i) => `c${i}`),
      }).success
    ).toBe(false);
  });

  it("rejects oversized feedback and empty required strings", () => {
    expect(
      structuredEvaluationSchema.safeParse({ ...valid, feedback: "x".repeat(2001) }).success
    ).toBe(false);
    expect(structuredEvaluationSchema.safeParse({ ...valid, feedback: "" }).success).toBe(false);
  });
});
