/**
 * Minimal safe markdown subset for AI-generated answers.
 *
 * The tutor model emits GitHub-flavored markdown (**, *, lists, code
 * fences, …) but the UI used to print it raw, leaking `*`/`**` symbols.
 * This module parses a small subset into an AST that the UI renders as
 * real elements — never via `dangerouslySetInnerHTML`, so model output
 * can never inject markup or scripts.
 *
 * Supported: headings (#–###), bold (** / __), italic (* / _),
 * strikethrough (~~), inline code (`), fenced code blocks (```),
 * unordered/ordered lists, blockquotes (>), simple pipe tables,
 * horizontal rules, and [text](https://…) links. Everything else
 * (including stray markers like `2 * 3`) passes through as literal text.
 */

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Present only for safe http(s) links. Unsafe URLs are dropped. */
  href?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; spans: TextSpan[] }
  | { type: "paragraph"; spans: TextSpan[] }
  | { type: "list"; ordered: boolean; items: TextSpan[][] }
  | { type: "code"; language: string; text: string }
  | { type: "quote"; spans: TextSpan[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "rule" };

function plain(text: string): TextSpan[] {
  return text.length > 0 ? [{ text }] : [];
}

/** Keep only http(s) links; anything else renders as plain text. */
function safeHref(url: string): string | undefined {
  const trimmed = url.trim();
  if (/^https?:\/\/[^ \s]+$/i.test(trimmed)) return trimmed;
  return undefined;
}

const INLINE_PATTERN =
  /`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~|\[([^\]]+)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g;

/**
 * Split one line of text into styled spans. Unmatched markers are left
 * as literal text so no content is ever lost.
 */
export function parseInline(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ text: text.slice(cursor, match.index) });
    }
    const [full, code, boldStar, boldUnder, italicStar, italicUnder, strike, linkText, linkUrl] =
      match;
    if (code !== undefined) {
      spans.push({ text: code, code: true });
    } else if (boldStar !== undefined || boldUnder !== undefined) {
      spans.push({ text: (boldStar ?? boldUnder) as string, bold: true });
    } else if (italicStar !== undefined || italicUnder !== undefined) {
      spans.push({ text: (italicStar ?? italicUnder) as string, italic: true });
    } else if (strike !== undefined) {
      spans.push({ text: strike, strike: true });
    } else if (linkText !== undefined) {
      const href = safeHref(linkUrl ?? "");
      spans.push(href ? { text: linkText, href } : { text: linkText });
    } else {
      spans.push({ text: full });
    }
    cursor = match.index + full.length;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor) });
  }
  return spans.length > 0 ? spans : plain(text);
}

function isRule(line: string): boolean {
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(line.trim());
}

function headingMatch(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  const hashes = match[1] ?? "#";
  return { level: hashes.length as 1 | 2 | 3, text: (match[2] ?? "").trim() };
}

function listMatch(line: string): { ordered: boolean; text: string } | null {
  const trimmed = line.trim();
  const unordered = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(trimmed);
  // A lone `*` could be emphasis, not a list — require "-"/"+" /"1." or
  // "* " followed by non-empty text; single-word lines stay paragraphs.
  if (!unordered) return null;
  const ordered = /^\d+[.)]/.test(trimmed);
  if (!ordered && trimmed.startsWith("*") && !trimmed.startsWith("* ")) return null;
  return { ordered, text: (unordered[1] ?? "").trim() };
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parse full answer text into blocks. Blank lines separate paragraphs;
 * consecutive list items group into one list; tables need a header row
 * plus a `| --- |` separator row.
 */
export function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    // Fenced code block.
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] as string).trim().startsWith("```")) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // consume closing fence (or EOF)
      blocks.push({ type: "code", language, text: body.join("\n") });
      continue;
    }

    const heading = headingMatch(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading.level, spans: parseInline(heading.text) });
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    // Pipe table: header + separator + body rows.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] as string)) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i] as string).includes("|") &&
        !isRule(lines[i] as string)
      ) {
        const row = splitRow(lines[i] as string);
        if (row.every((c) => c.length === 0)) break;
        rows.push(row);
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote: merge consecutive `>` lines.
    if (line.trim().startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith(">")) {
        quoted.push((lines[i] as string).trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", spans: parseInline(quoted.join(" ")) });
      continue;
    }

    // List: merge consecutive items.
    const first = listMatch(line);
    if (first) {
      const items: TextSpan[][] = [];
      let ordered = first.ordered;
      while (i < lines.length) {
        const item = listMatch(lines[i] as string);
        if (!item) break;
        if (item.ordered !== ordered && items.length > 0) break;
        ordered = item.ordered;
        items.push(parseInline(item.text));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: merge consecutive plain lines.
    const passage: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] as string).trim().length > 0 &&
      !headingMatch(lines[i] as string) &&
      !(lines[i] as string).trim().startsWith("```") &&
      !(lines[i] as string).trim().startsWith(">") &&
      !listMatch(lines[i] as string) &&
      !isRule(lines[i] as string)
    ) {
      // A following pipe-table header ends the paragraph.
      if (
        (lines[i] as string).includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1] as string)
      ) {
        break;
      }
      passage.push(lines[i] as string);
      i += 1;
    }
    blocks.push({ type: "paragraph", spans: parseInline(passage.join("\n")) });
  }

  return blocks;
}

/** Plain-text fallback (tests, metadata): formatting dropped, words kept. */
export function markdownToPlainText(input: string): string {
  return parseMarkdown(input)
    .map((block) => {
      switch (block.type) {
        case "code":
          return block.text;
        case "table":
          return [...block.headers, ...block.rows.flat()].join(" ");
        case "rule":
          return "";
        case "list":
          return block.items.map((spans) => spans.map((s) => s.text).join("")).join(" ");
        default:
          return block.spans.map((s) => s.text).join("");
      }
    })
    .filter((t) => t.length > 0)
    .join("\n");
}
