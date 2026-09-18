import type { ChunkPlanItem } from "./chunker.js";

/**
 * Idempotency for knowledge processing. The plan is deterministic
 * (same pages + same options ⇒ same indexes, hashes, content), so a
 * retry only needs to compare desired state against stored state:
 *
 * - stored row with same (materialId, chunkIndex) AND same contentHash
 *   AND a non-null embedding ⇒ skip entirely (no re-embed, no rewrite).
 * - same key but different hash or missing embedding ⇒ re-embed + update.
 * - stored indexes beyond the new plan length ⇒ stale, delete at the end.
 *
 * All decisions derive from the database — never from memory — so worker
 * restarts, duplicate jobs, and manual retries are all safe.
 */

export interface StoredChunkState {
  chunkIndex: number;
  contentHash: string | null;
  hasEmbedding: boolean;
}

export interface ChunkDiff {
  /** Plan items that need (re-)embedding + upsert. */
  toEmbed: ChunkPlanItem[];
  /** Plan items already persisted identically — untouched. */
  toSkip: ChunkPlanItem[];
  /** Stored indexes absent from the plan — delete after success. */
  staleIndexes: number[];
}

export function diffChunkPlan(plan: ChunkPlanItem[], stored: StoredChunkState[]): ChunkDiff {
  const storedByIndex = new Map(stored.map((s) => [s.chunkIndex, s]));
  const plannedIndexes = new Set<number>();
  const toEmbed: ChunkPlanItem[] = [];
  const toSkip: ChunkPlanItem[] = [];

  for (const item of plan) {
    plannedIndexes.add(item.chunkIndex);
    const existing = storedByIndex.get(item.chunkIndex);
    if (
      existing &&
      existing.contentHash === item.contentHash &&
      existing.hasEmbedding &&
      item.contentHash.length > 0
    ) {
      toSkip.push(item);
    } else {
      toEmbed.push(item);
    }
  }

  const staleIndexes = stored
    .map((s) => s.chunkIndex)
    .filter((index) => !plannedIndexes.has(index))
    .sort((a, b) => a - b);

  return { toEmbed, toSkip, staleIndexes };
}
