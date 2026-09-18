import { describe, expect, it } from "vitest";
import { NodePdfTextExtractor } from "./pdfExtractor.js";
import { buildImageOnlyPdf, buildTextPdf } from "./test-fixtures.js";

describe("NodePdfTextExtractor (pdfjs-dist headless)", () => {
  it("extracts text pages with page numbers and char counts", async () => {
    const pdf = buildTextPdf(["Hello Zephyr Calibration\nSecond line"]);
    const result = await new NodePdfTextExtractor().extractText(new Uint8Array(pdf));
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[0]?.text).toContain("Hello Zephyr Calibration");
    expect(result.pages[0]?.text).toContain("Second line");
    expect(result.pages[0]?.charCount).toBe(result.pages[0]?.text.length);
  });

  it("handles multi-page documents in order", async () => {
    const pdf = buildTextPdf(["Page one alpha", "Page two beta", "Page three gamma"]);
    const result = await new NodePdfTextExtractor().extractText(new Uint8Array(pdf));
    expect(result.pageCount).toBe(3);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(result.pages[1]?.text).toContain("Page two beta");
  });

  it("returns empty text (not failure) for image-only pages", async () => {
    const pdf = buildImageOnlyPdf();
    const result = await new NodePdfTextExtractor().extractText(new Uint8Array(pdf));
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]?.text).toBe("");
  });

  it("detects headings by pattern without inventing structure", async () => {
    const pdf = buildTextPdf(["Chapter 3 Photosynthesis\nSome body text here"]);
    const result = await new NodePdfTextExtractor().extractText(new Uint8Array(pdf));
    expect(result.pages[0]?.headings).toContain("Chapter 3 Photosynthesis");
    expect(result.pages[0]?.headings).not.toContain("Some body text here");
  });

  it("rejects garbage bytes as INVALID, not as empty pages", async () => {
    const extractor = new NodePdfTextExtractor();
    await expect(
      extractor.extractText(new Uint8Array(Buffer.from("not a pdf at all")))
    ).rejects.toMatchObject({ name: "PdfExtractError" });
  });
});
