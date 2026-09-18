/**
 * Deterministic hybrid ranking: min-max normalize each path's raw scores
 * into [0, 1], blend with configured weights, sort, take top K.
 *
 * - Semantic raw score: cosine DISTANCE from pgvector (`<->`, lower is
 *   better, range [0, 2] for normalized embeddings) → similarity
 *   `1 - distance/2`, clamped to [0, 1].
 * - Lexical raw score: `ts_rank_cd` (higher is better, unbounded ≥ 0) →
 *   min-max normalized across the candidate set.
 * - Missing path ⇒ contributes 0 (a chunk found by one path only still
 *   ranks, just without the other's boost).
 * - Ties broken by chunkId for full determinism.
 *
 * Scores are similarities, NOT probabilities — never present them as such.
 */

export interface RankCandidate<T> {
  key: string;
  semanticDistance: number | null;
  lexicalRank: number | null;
  value: T;
}

export interface RankedCandidate<T> extends RankCandidate<T> {
  semantic: number | null;
  lexical: number | null;
  combined: number;
}

export interface RankWeights {
  semanticWeight: number;
  lexicalWeight: number;
}

export function normalizeWeights(weights: RankWeights): RankWeights {
  const total = weights.semanticWeight + weights.lexicalWeight;
  if (total <= 0) {
    throw new Error("Search weights must sum to a positive number.");
  }
  return {
    semanticWeight: weights.semanticWeight / total,
    lexicalWeight: weights.lexicalWeight / total,
  };
}

export function semanticDistanceToSimilarity(distance: number): number {
  return Math.min(1, Math.max(0, 1 - distance / 2));
}

function minMaxNormalize(values: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (values.length === 0) return out;
  const min = Math.min(...values);
  const max = Math.max(...values);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    out.set(i, max === min ? 1 : (value - min) / (max - min));
  }
  return out;
}

export function rankHybrid<T>(
  candidates: RankCandidate<T>[],
  weights: RankWeights,
  limit: number
): RankedCandidate<T>[] {
  const { semanticWeight, lexicalWeight } = normalizeWeights(weights);
  const withLexical = candidates.filter((c) => c.lexicalRank !== null);

  const lexicalNorm = minMaxNormalize(withLexical.map((c) => c.lexicalRank as number));
  const lexicalNormByKey = new Map<string, number>();
  withLexical.forEach((c, i) => {
    lexicalNormByKey.set(c.key, lexicalNorm.get(i) ?? 0);
  });

  const ranked = candidates.map((c) => {
    const semantic =
      c.semanticDistance === null ? null : semanticDistanceToSimilarity(c.semanticDistance);
    const lexical = c.lexicalRank === null ? null : (lexicalNormByKey.get(c.key) ?? 0);
    const combined = semanticWeight * (semantic ?? 0) + lexicalWeight * (lexical ?? 0);
    return { ...c, semantic, lexical, combined };
  });

  ranked.sort((a, b) => b.combined - a.combined || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ranked.slice(0, Math.max(0, limit));
}
