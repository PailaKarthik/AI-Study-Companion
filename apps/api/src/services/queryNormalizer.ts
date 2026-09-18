/**
 * Query normalization for hybrid retrieval. Pure + deterministic.
 *
 * The normalized string feeds BOTH paths unchanged:
 * - lexical: parameterized `websearch_to_tsquery('english', $1)` — the
 *   database parses quotes/operators, so user input is never concatenated
 *   into SQL and never needs manual escaping here.
 * - semantic: Gemini embeds the same string (taskType RETRIEVAL_QUERY).
 */

/** Collapse whitespace; reject empties (validated to 1..500 chars upstream). */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Hard ceiling applied before any provider/DB work (defense in depth). */
export const MAX_SEARCH_QUERY_CHARS = 500;

export function assertSearchableQuery(normalized: string): void {
  if (normalized.length === 0 || normalized.length > MAX_SEARCH_QUERY_CHARS) {
    throw new Error("Query must be 1-500 characters after normalization.");
  }
}
