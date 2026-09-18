import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { logger } from "../../lib/logger.js";
import { standardFontDataUrl } from "./pdfjsConfig.js";

/**
 * PDF text + structure extraction (pdfjs-dist, headless — no canvas).
 *
 * Source fidelity first: page text is assembled from pdfjs text items
 * with newline preservation (`hasEOL`) only. Structure signals are
 * pattern-detected and stored as metadata — never invented:
 * - `headings`: short lines matching outline patterns (numeric
 *   outlines, `Chapter/Section/Part/Appendix`, ALL-CAPS titles);
 * - `possibleTable`: conservative layout heuristic (see below).
 * Tables keep their text layout; no structure is fabricated.
 */

export interface PdfPageText {
  pageNumber: number;
  /** Assembled page text (newlines preserved, whitespace collapsed). */
  text: string;
  charCount: number;
  /** Pattern-detected headings, in page order. Never invented. */
  headings: string[];
  /**
   * True when ≥2 lines contain ≥3 text runs separated by wide x-gaps —
   * a hint that the page may hold a table. Consumers must treat it as
   * a hint, not parsed structure.
   */
  possibleTable: boolean;
}

export interface PdfTextExtraction {
  pageCount: number;
  pages: PdfPageText[];
  warnings: string[];
}

export interface PdfTextExtractor {
  readonly name: string;
  extractText(pdfBytes: Uint8Array): Promise<PdfTextExtraction>;
}

export class PdfExtractError extends Error {
  readonly code: "ENCRYPTED" | "INVALID" | "ABORTED";
  constructor(code: PdfExtractError["code"], message: string) {
    super(message);
    this.name = "PdfExtractError";
    this.code = code;
  }
}

interface TextRun {
  str: string;
  x: number;
  eol: boolean;
}

const HEADING_PATTERNS = [
  /^(chapter|section|part|appendix)\b/i,
  /^\d+(\.\d+)*\s+\S/,
  /^[A-Z][A-Z0-9\s\-–—:;,'"()&]{3,}$/,
];

/** x-gap (text-space units) that suggests column separation, not a word gap. */
const TABLE_GAP_UNITS = 48;

function detectHeading(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  if (trimmed.split(/\s+/).length > 14) return null;
  return HEADING_PATTERNS.some((pattern) => pattern.test(trimmed)) ? trimmed : null;
}

function lineHasWideGaps(runs: TextRun[]): boolean {
  if (runs.length < 3) return false;
  let wide = 0;
  for (let i = 1; i < runs.length; i += 1) {
    const prev = runs[i - 1];
    const current = runs[i];
    if (!prev || !current) continue;
    if (current.x - prev.x > TABLE_GAP_UNITS) wide += 1;
    if (wide >= 2) return true;
  }
  return false;
}

function assemblePage(pageNumber: number, runs: TextRun[]): PdfPageText {
  const lines: string[][] = [[]];
  const lineRuns: TextRun[][] = [[]];
  for (const run of runs) {
    lines[lines.length - 1]?.push(run.str);
    lineRuns[lineRuns.length - 1]?.push(run);
    if (run.eol) {
      lines.push([]);
      lineRuns.push([]);
    }
  }
  const textLines = lines
    .map((parts) =>
      parts
        .join("")
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter((line, index, all) => line.length > 0 || (index > 0 && index < all.length - 1));
  const text = textLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const headings: string[] = [];
  for (const line of textLines) {
    const heading = detectHeading(line);
    if (heading && !headings.includes(heading)) headings.push(heading);
  }
  const tabularLines = lineRuns.filter((line) => line.length >= 3 && lineHasWideGaps(line)).length;
  return {
    pageNumber,
    text,
    charCount: text.length,
    headings,
    possibleTable: tabularLines >= 2,
  };
}

/** Headless pdfjs-dist text extraction (no page rendering, no canvas). */
export class NodePdfTextExtractor implements PdfTextExtractor {
  readonly name = "pdfjs-dist";

  async extractText(pdfBytes: Uint8Array): Promise<PdfTextExtraction> {
    let document: {
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>;
        cleanup: () => void;
      }>;
      cleanup: () => void;
    };
    try {
      const loading = pdfjsLib.getDocument({
        data: pdfBytes,
        standardFontDataUrl: standardFontDataUrl(),
      });
      document = (await loading.promise) as typeof document;
    } catch (error) {
      throw toExtractError(error);
    }
    const warnings: string[] = [];
    const pages: PdfPageText[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        let runs: TextRun[] = [];
        try {
          const page = await document.getPage(pageNumber);
          try {
            const content = await page.getTextContent();
            runs = content.items
              .filter(
                (item): item is { str: string; hasEOL?: boolean; transform?: number[] } =>
                  typeof item === "object" &&
                  item !== null &&
                  "str" in item &&
                  typeof (item as { str: unknown }).str === "string"
              )
              .map((item) => ({
                str: item.str,
                x:
                  Array.isArray(item.transform) && typeof item.transform[4] === "number"
                    ? (item.transform[4] as number)
                    : 0,
                eol: item.hasEOL === true,
              }))
              .filter((run) => run.str.length > 0);
          } finally {
            page.cleanup();
          }
        } catch (error) {
          // One corrupt page must not kill the other N-1: record it
          // honestly as empty and keep going.
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Page ${pageNumber} text failed (${message}); treated as empty.`);
          logger.warn({ pageNumber, error: message }, "PDF page text extraction failed");
        }
        pages.push(assemblePage(pageNumber, runs));
      }
    } finally {
      document.cleanup();
    }
    return { pageCount: document.numPages, pages, warnings };
  }
}

function toExtractError(error: unknown): PdfExtractError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException" || /password|encrypted/i.test(message)) {
    return new PdfExtractError(
      "ENCRYPTED",
      "PDF is encrypted or password-protected; cannot extract text."
    );
  }
  return new PdfExtractError("INVALID", `PDF parsing failed: ${message}`);
}
