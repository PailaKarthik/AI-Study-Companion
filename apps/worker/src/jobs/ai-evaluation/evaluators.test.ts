import { describe, expect, it } from "vitest";
import {
  citedMarkers,
  evaluateAttempt,
  evaluateQuiz,
  evaluateRecommendation,
  evaluateTutorMessage,
} from "./evaluators.js";

describe("citedMarkers", () => {
  it("extracts unique markers in order", () => {
    expect(citedMarkers("See [2] and [1], also [2] and [1000].")).toEqual([1, 2]);
    expect(citedMarkers("no citations here")).toEqual([]);
  });
});

describe("evaluateTutorMessage", () => {
  it("scores a fully-cited grounded answer at 1", () => {
    const out = evaluateTutorMessage({
      content: "Mitosis has phases [1] and checkpoints [2].",
      evidence: [{ relevanceScore: 0.9 }, { relevanceScore: 0.7 }],
    });
    expect(out).toMatchObject({
      groundedness: 1,
      citationValidity: 1,
      citationCoverage: 1,
      retrievalRelevance: 0.8,
      unsupportedAnswerHandling: null,
    });
  });

  it("penalizes dangling markers and partial coverage", () => {
    const out = evaluateTutorMessage({
      content: "Claim one [1] and claim two [5].",
      evidence: [{ relevanceScore: 0.6 }, { relevanceScore: null }],
    });
    expect(out.citationValidity).toBe(0.5);
    expect(out.citationCoverage).toBe(0.5);
    expect(out.groundedness).toBe(1);
    expect(out.retrievalRelevance).toBe(0.6);
  });

  it("rewards honest unsupported answers, fails silent ones", () => {
    const honest = evaluateTutorMessage({
      content: "I couldn't find relevant material on this topic.",
      evidence: [],
    });
    expect(honest).toMatchObject({
      groundedness: 1,
      citationValidity: null,
      citationCoverage: null,
      retrievalRelevance: null,
      unsupportedAnswerHandling: 1,
    });
    const silent = evaluateTutorMessage({
      content: "Mitosis definitely has eleven phases.",
      evidence: [],
    });
    expect(silent).toMatchObject({ groundedness: 0, unsupportedAnswerHandling: 0 });
  });
});

describe("evaluateAttempt", () => {
  it("mirrors stored correctness and coverage", () => {
    const out = evaluateAttempt({
      responses: [
        { isCorrect: true, conceptId: "c1" },
        { isCorrect: false, conceptId: "c1" },
        { isCorrect: null, conceptId: null },
      ],
      assessments: [
        { score: 1, relevance: 0.9, reasoningQuality: 1, confidence: 0.8 },
        { score: 0, relevance: 0.4, reasoningQuality: 0, confidence: 0.9 },
      ],
    });
    expect(out.correctness).toBe(0.5);
    expect(out.relevance).toBeCloseTo(0.65, 5);
    expect(out.conceptCoverage).toBeCloseTo(2 / 3, 5);
    expect(out.reasoningQuality).toBe(0.5);
    expect(out.evaluatorConfidence).toBeCloseTo(0.85, 5);
  });

  it("returns nulls (unavailable) on empty input", () => {
    expect(evaluateAttempt({ responses: [], assessments: [] })).toMatchObject({
      correctness: null,
      relevance: null,
      conceptCoverage: null,
      reasoningQuality: null,
      evaluatorConfidence: null,
    });
  });
});

describe("evaluateQuiz", () => {
  it("scores a well-formed mixed quiz", () => {
    const out = evaluateQuiz({
      mode: "ADAPTIVE",
      questions: [
        { conceptId: "c1", difficulty: "BEGINNER", type: "MCQ" },
        { conceptId: "c2", difficulty: "INTERMEDIATE", type: "OPEN_ENDED" },
        { conceptId: "c1", difficulty: "ADVANCED", type: "MCQ" },
      ],
    });
    expect(out).toMatchObject({
      conceptAlignment: 1,
      difficultyCoverage: 1,
      adaptivitySignals: 1,
    });
    expect(out.conceptDiversity).toBeCloseTo(2 / 3, 5);
    expect(out.typeBalance).toBeCloseTo(1 / 2, 5);
  });

  it("reports single-type quizzes as unavailable balance, not zero", () => {
    const out = evaluateQuiz({
      mode: "CONCEPT_FOCUS",
      questions: [{ conceptId: "c1", difficulty: null, type: "MCQ" }],
    });
    expect(out.typeBalance).toBeNull();
    expect(out.difficultyCoverage).toBe(0);
  });

  it("returns nulls for an empty quiz", () => {
    expect(evaluateQuiz({ mode: null, questions: [] })).toMatchObject({
      conceptAlignment: null,
      adaptivitySignals: 0,
    });
  });
});

describe("evaluateRecommendation", () => {
  it("rates needed, actionable recommendations at 1", () => {
    const out = evaluateRecommendation({
      type: "REVIEW",
      reason: "Mastery is low with recent mistakes.",
      actionKind: "PRACTICE_CONCEPT",
      actionTargetExists: true,
      conceptExists: true,
      conceptMastery: 0.3,
      recentMistakes: 3,
    });
    expect(out).toMatchObject({ relevance: 1, actionability: 1, alignment: 1 });
  });

  it("flags dead targets and missing concepts", () => {
    const out = evaluateRecommendation({
      type: "REVIEW",
      reason: "Stale row.",
      actionKind: "REVIEW_MATERIAL",
      actionTargetExists: false,
      conceptExists: false,
      conceptMastery: null,
      recentMistakes: 0,
    });
    expect(out).toMatchObject({ relevance: null, actionability: 0 });
  });

  it("rewards explore-on-strong and penalizes missing reasons", () => {
    const explore = evaluateRecommendation({
      type: "EXPLORE",
      reason: "Solid base.",
      actionKind: "PRACTICE_CONCEPT",
      actionTargetExists: true,
      conceptExists: true,
      conceptMastery: 0.9,
      recentMistakes: 0,
    });
    expect(explore.relevance).toBe(1);
    const silent = evaluateRecommendation({
      type: "PRACTICE",
      reason: null,
      actionKind: null,
      actionTargetExists: null,
      conceptExists: true,
      conceptMastery: 0.5,
      recentMistakes: 0,
    });
    expect(silent).toMatchObject({ alignment: 0, actionability: null });
  });
});
