import { describe, expect, it } from "vitest";
import {
  detectHeading,
  detectRepeatedLines,
  estimateTokens,
  hashContent,
  normalizePageText,
  normalizeWhitespace,
  planChunks,
  splitParagraphs,
} from "./chunker.js";

const OPTS = { targetTokens: 100, overlapTokens: 20 };

function page(pageNumber: number, text: string, pageId = `page-${pageNumber}`) {
  return { pageId, pageNumber, text };
}

describe("normalizeWhitespace", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeWhitespace("  hello   \n\n\nworld  ")).toBe("hello\n\nworld");
  });

  it("de-hyphenates words broken across lines", () => {
    expect(normalizeWhitespace("exam-\nple text")).toBe("example text");
  });

  it("leaves intentional paragraph breaks alone", () => {
    expect(normalizeWhitespace("para one\n\npara two")).toBe("para one\n\npara two");
  });
});

describe("detectRepeatedLines", () => {
  it("finds headers repeated across most pages", () => {
    const pages = [
      "Course Notes\nReal content one",
      "Course Notes\nReal content two",
      "Course Notes\nReal content three",
    ];
    expect(detectRepeatedLines(pages)).toEqual(new Set(["Course Notes"]));
  });

  it("ignores one-off and very short lines", () => {
    const pages = [
      "Unique header here\nbody",
      "Other header here\nbody",
      "Third header here\nbody",
    ];
    expect(detectRepeatedLines(pages).size).toBe(0);
  });

  it("requires at least three pages of repetition", () => {
    const pages = ["Shared line here\nbody one", "Shared line here\nbody two"];
    expect(detectRepeatedLines(pages).size).toBe(0);
  });
});

describe("normalizePageText", () => {
  it("strips detected headers without touching source text elsewhere", () => {
    const repeated = new Set(["Course Notes"]);
    expect(normalizePageText("Course Notes\nActual content", repeated)).toBe("Actual content");
  });
});

describe("detectHeading", () => {
  it("detects numbered and labeled headings", () => {
    expect(detectHeading("Chapter 3: Memory")).toBe("Chapter 3: Memory");
    expect(detectHeading("2.3.1 Paging")).toBe("2.3.1 Paging");
  });

  it("detects ALL-CAPS headings", () => {
    expect(detectHeading("VIRTUAL MEMORY")).toBe("VIRTUAL MEMORY");
  });

  it("never invents headings for ordinary prose", () => {
    expect(detectHeading("Virtual memory lets processes use more RAM.")).toBeUndefined();
    expect(detectHeading("Introduction")).toBeUndefined();
    expect(detectHeading("line one\nline two")).toBeUndefined();
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and drops empties", () => {
    expect(splitParagraphs("a\n\n\nb\n\n")).toEqual(["a", "b"]);
  });
});

describe("planChunks", () => {
  it("is deterministic: same input twice yields identical output", () => {
    const pages = [
      page(1, "Chapter 1\n\nFirst paragraph about processes.\n\nSecond paragraph about memory."),
      page(2, "Chapter 2\n\nThird paragraph about scheduling."),
    ];
    const first = planChunks(pages, OPTS);
    const second = planChunks(pages, OPTS);
    expect(second).toEqual(first);
  });

  it("keeps short documents to a single chunk with metadata", () => {
    const plan = planChunks([page(3, "Tiny doc.")], OPTS);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]).toMatchObject({
      chunkIndex: 0,
      pageId: "page-3",
      pageNumber: 3,
      metadata: { pageNumber: 3, chunkIndex: 0, sourceType: "pdf" },
    });
    expect(plan.chunks[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.skippedEmptyPages).toEqual([]);
  });

  it("skips empty pages and records them", () => {
    const plan = planChunks([page(1, "   \n\n  "), page(2, "Real text here.")], OPTS);
    expect(plan.skippedEmptyPages).toEqual([1]);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]?.pageNumber).toBe(2);
  });

  it("splits long documents into bounded chunks with overlap", () => {
    const paragraph = `Sentence about operating systems. `.repeat(40);
    const plan = planChunks([page(1, paragraph)], { targetTokens: 50, overlapTokens: 10 });
    expect(plan.chunks.length).toBeGreaterThan(1);
    for (const chunk of plan.chunks) {
      // Overlap adds at most ~overlap; hard cap keeps retrieval sane.
      expect(chunk.tokenCount).toBeLessThanOrEqual(50 + 10 + 5);
    }
    // Adjacent chunks share trailing/leading text (overlap), not identical.
    const [first, second] = plan.chunks;
    expect(first?.content).not.toBe(second?.content);
    const tail = (first?.content ?? "").slice(-80);
    expect(second?.content.includes(tail.slice(0, 40)) ?? false).toBe(true);
  });

  it("never merges across page boundaries and preserves page identity", () => {
    const plan = planChunks([page(1, "Page one text here."), page(2, "Page two text here.")], OPTS);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks.map((c) => c.pageNumber)).toEqual([1, 2]);
    expect(plan.chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("propagates detected section titles without inventing any", () => {
    const plan = planChunks([page(1, "CHAPTER ONE\n\nBody text about kernels.")], OPTS);
    expect(plan.chunks[0]?.metadata.sectionTitle).toBe("CHAPTER ONE");
    const plain = planChunks([page(1, "Just a normal paragraph here.")], OPTS);
    expect(plain.chunks[0]?.metadata.sectionTitle).toBeUndefined();
  });

  it("hashes normalized content (hashContent is stable)", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });

  it("estimates tokens as chars/4 rounded up", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
