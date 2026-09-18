import { createHash } from "node:crypto";

/**
 * Deterministic, page-scoped semantic chunking for extracted PDF text.
 *
 * Pipeline per page: normalize → drop headers/footers → split paragraphs
 * → detect headings (never invented) → greedily pack to a token target
 * with a small overlap. Output is fully deterministic: same pages +
 * same options ⇒ byte-identical chunks, which is what makes
 * content-hash idempotency sound.
 *
 * Tokens are approximated as chars/4 (documented, no tokenizer dep in
 * the worker). Chunks never span page boundaries so every chunk cites
 * exactly one page.
 */

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function hashContent(normalizedText: string): string {
  return createHash("sha256").update(normalizedText, "utf8").digest("hex");
}

export interface ChunkerOptions {
  targetTokens: number;
  overlapTokens: number;
}

export interface PageInput {
  pageId: string;
  pageNumber: number;
  /** Raw DocumentPage.extractedText — never mutated here. */
  text: string;
}

export interface ChunkPlanItem {
  chunkIndex: number;
  pageId: string;
  pageNumber: number;
  content: string;
  tokenCount: number;
  contentHash: string;
  metadata: {
    pageNumber: number;
    chunkIndex: number;
    sectionTitle?: string;
    sourceType: "pdf";
  };
}

export interface ChunkPlan {
  chunks: ChunkPlanItem[];
  /** Pages that normalized to nothing (blank/scanned-empty). Skipped, counted. */
  skippedEmptyPages: number[];
}

/** Collapse whitespace runs, fix hyphenated line breaks, trim. */
export function normalizeWhitespace(text: string): string {
  return (
    text
      // De-hyphenate words broken across lines: "exam-\nple" → "example".
      .replace(/([A-Za-z])-\r?\n([A-Za-z])/g, "$1$2")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v\u00a0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim()
  );
}

/**
 * Candidate repeated header/footer line: short, non-empty, identical text
 * on at least 3 pages AND at least half of all pages. Conservative by
 * design — content lines rarely repeat verbatim that often.
 */
export function detectRepeatedLines(normalizedPages: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of normalizedPages) {
    const seen = new Set<string>();
    for (const line of page.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length >= 8 && trimmed.length <= 120) seen.add(trimmed);
    }
    for (const line of seen) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(normalizedPages.length / 2));
  const repeated = new Set<string>();
  for (const [line, count] of counts) {
    if (count >= threshold) repeated.add(line);
  }
  return repeated;
}

export function stripRepeatedLines(normalizedPage: string, repeated: Set<string>): string {
  if (repeated.size === 0) return normalizedPage;
  return normalizedPage
    .split("\n")
    .filter((line) => !repeated.has(line.trim()))
    .join("\n")
    .trim();
}

/** Full page normalization: whitespace + repeated header/footer removal. */
export function normalizePageText(text: string, repeated: Set<string>): string {
  return stripRepeatedLines(normalizeWhitespace(text), repeated);
}

const NUMBERED_HEADING = /^(chapter|section|part|unit|lesson|module)\s+\d+[\d.]*\b.{0,80}$/i;
const NUMERIC_HEADING = /^\d+(\.\d+)*\.?\s+\S.{0,80}$/;

/**
 * Heading detection — patterns only, never invented:
 * - "Chapter 3 …", "Section 2.1 …" style labels
 * - Numeric outlines: "1. …", "2.3.1 …"
 * - ALL-CAPS single lines (≥4 letters)
 * Everything else yields no section title.
 */
export function detectHeading(paragraph: string): string | undefined {
  const singleLine = paragraph.includes("\n") ? undefined : paragraph.trim();
  if (!singleLine || singleLine.length === 0 || singleLine.length > 100) return undefined;
  if (NUMBERED_HEADING.test(singleLine) || NUMERIC_HEADING.test(singleLine)) {
    return singleLine;
  }
  const letters = singleLine.replace(/[^A-Za-z]/g, "");
  if (
    letters.length >= 4 &&
    singleLine === singleLine.toUpperCase() &&
    singleLine !== singleLine.toLowerCase()
  ) {
    return singleLine;
  }
  return undefined;
}

export function splitParagraphs(normalizedPage: string): string[] {
  return normalizedPage
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").replace(/ +/g, " ").trim())
    .filter((p) => p.length > 0);
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Hard-split an oversized unit at word boundaries (chars as last resort). */
function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** Trailing slice at a word boundary for overlap windows. */
function overlapPrefix(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length === 0) return "";
  const tail = text.slice(-maxChars);
  const firstSpace = tail.search(/\s/);
  const trimmed = firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
  return trimmed.trim();
}

/**
 * Pack one page's paragraphs into chunks. Pure + deterministic.
 * `startIndex` is the running chunk counter; sections propagate the most
 * recent detected heading within the page.
 */
export function planPageChunks(
  paragraphs: string[],
  page: { pageId: string; pageNumber: number },
  startIndex: number,
  options: ChunkerOptions
): ChunkPlanItem[] {
  const maxChars = Math.max(1, options.targetTokens * CHARS_PER_TOKEN);
  const overlapChars = Math.max(0, options.overlapTokens * CHARS_PER_TOKEN);
  const chunks: ChunkPlanItem[] = [];
  let index = startIndex;
  let current: string[] = [];
  let currentChars = 0;
  let sectionTitle: string | undefined;

  // Overlap from the previously flushed chunk, prepended to the next one.
  let carry = "";

  const flush = () => {
    const body = current.join("\n\n").trim();
    current = [];
    currentChars = 0;
    if (body.length === 0) {
      carry = "";
      return;
    }
    const content = carry ? `${carry}\n\n${body}` : body;
    carry = "";
    const tokenCount = estimateTokens(content);
    chunks.push({
      chunkIndex: index,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      content,
      tokenCount,
      contentHash: hashContent(content),
      metadata: {
        pageNumber: page.pageNumber,
        chunkIndex: index,
        ...(sectionTitle ? { sectionTitle } : {}),
        sourceType: "pdf" as const,
      },
    });
    index += 1;
    carry = overlapPrefix(content, overlapChars);
  };

  for (const paragraph of paragraphs) {
    const heading = detectHeading(paragraph);
    if (heading) {
      sectionTitle = heading;
      if (currentChars + paragraph.length + 2 > maxChars && current.length > 0) flush();
      current.push(paragraph);
      currentChars += paragraph.length + 2;
      continue;
    }
    const units =
      estimateTokens(paragraph) > options.targetTokens
        ? splitSentences(paragraph).flatMap((s) =>
            estimateTokens(s) > options.targetTokens ? hardSplit(s, maxChars) : [s]
          )
        : [paragraph];
    for (const unit of units) {
      if (currentChars + unit.length + 2 > maxChars && current.length > 0) flush();
      current.push(unit);
      currentChars += unit.length + 2;
    }
  }
  flush();
  return chunks;
}

/** Plan chunks for all pages of a material, in pageNumber order. */
export function planChunks(pages: PageInput[], options: ChunkerOptions): ChunkPlan {
  const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const normalized = ordered.map((p) => normalizeWhitespace(p.text));
  const repeated = detectRepeatedLines(normalized.filter((t) => t.length > 0));
  const chunks: ChunkPlanItem[] = [];
  const skippedEmptyPages: number[] = [];
  let index = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const page = ordered[i] as PageInput;
    const cleaned = stripRepeatedLines(normalized[i] as string, repeated);
    if (cleaned.length === 0) {
      skippedEmptyPages.push(page.pageNumber);
      continue;
    }
    const pageChunks = planPageChunks(splitParagraphs(cleaned), page, index, options);
    chunks.push(...pageChunks);
    index += pageChunks.length;
  }
  return { chunks, skippedEmptyPages };
}
