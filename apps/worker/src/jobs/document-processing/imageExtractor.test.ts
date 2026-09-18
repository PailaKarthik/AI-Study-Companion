import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { NodePdfImageExtractor } from "./imageExtractor.js";
import { buildImageOnlyPdf, buildJpegImagePdf, buildTextPdf } from "./test-fixtures.js";

describe("NodePdfImageExtractor (pdfjs + sharp, headless)", () => {
  it("extracts embedded images with page association and PNG bytes", async () => {
    const pdf = buildImageOnlyPdf();
    const result = await new NodePdfImageExtractor().extractImages(new Uint8Array(pdf));
    expect(result.examined).toBe(1);
    expect(result.images).toHaveLength(1);
    const image = result.images[0];
    expect(image?.pageNumber).toBe(1);
    expect(image?.width).toBe(3);
    expect(image?.height).toBe(2);
    // PNG magic — converted by sharp, never raw pixel dumps.
    expect(Array.from(image?.png.subarray(0, 4) ?? [])).toEqual([137, 80, 78, 71]);
    expect(image?.sizeBytes).toBe(image?.png.length);
  });

  it("finds no images in text-only PDFs", async () => {
    const pdf = buildTextPdf(["Just words here"]);
    const result = await new NodePdfImageExtractor().extractImages(new Uint8Array(pdf));
    expect(result.images).toHaveLength(0);
    expect(result.examined).toBe(0);
  });

  it("caps images per material and reports skipped honestly", async () => {
    const pdf = buildImageOnlyPdf();
    const result = await new NodePdfImageExtractor().extractImages(new Uint8Array(pdf), {
      maxImages: 0,
    });
    expect(result.images).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("extracts JPEG (DCTDecode) images via native decode, not raw layout", async () => {
    // Scanned-PDF shape: pdfjs hands JPEG streams through still-encoded,
    // so byte length never matches width*height*channels — a raw-only
    // extractor reports "unknown layout" and OCR starves.
    const jpeg = await sharp({
      create: { width: 16, height: 12, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const pdf = buildJpegImagePdf(jpeg, 16, 12);
    const result = await new NodePdfImageExtractor().extractImages(new Uint8Array(pdf));
    expect(result.examined).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.images).toHaveLength(1);
    const image = result.images[0];
    expect(image?.pageNumber).toBe(1);
    expect(image?.width).toBe(16);
    expect(image?.height).toBe(12);
    expect(Array.from(image?.png.subarray(0, 4) ?? [])).toEqual([137, 80, 78, 71]);
  });
});
