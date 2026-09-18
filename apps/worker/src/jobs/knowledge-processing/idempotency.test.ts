import { describe, expect, it } from "vitest";
import { diffChunkPlan } from "./idempotency.js";
import type { ChunkPlanItem } from "./chunker.js";

function item(chunkIndex: number, hash: string): ChunkPlanItem {
  return {
    chunkIndex,
    pageId: "page-1",
    pageNumber: 1,
    content: `content-${chunkIndex}`,
    tokenCount: 10,
    contentHash: hash,
    metadata: { pageNumber: 1, chunkIndex, sourceType: "pdf" },
  };
}

describe("diffChunkPlan", () => {
  it("embeds everything on first run", () => {
    const diff = diffChunkPlan([item(0, "a"), item(1, "b")], []);
    expect(diff.toEmbed.map((i) => i.chunkIndex)).toEqual([0, 1]);
    expect(diff.toSkip).toEqual([]);
    expect(diff.staleIndexes).toEqual([]);
  });

  it("skips identical chunks and re-embeds changed or embedding-less ones", () => {
    const plan = [item(0, "same"), item(1, "changed"), item(2, "no-vector")];
    const diff = diffChunkPlan(plan, [
      { chunkIndex: 0, contentHash: "same", hasEmbedding: true },
      { chunkIndex: 1, contentHash: "old", hasEmbedding: true },
      { chunkIndex: 2, contentHash: "no-vector", hasEmbedding: false },
    ]);
    expect(diff.toSkip.map((i) => i.chunkIndex)).toEqual([0]);
    expect(diff.toEmbed.map((i) => i.chunkIndex)).toEqual([1, 2]);
  });

  it("flags stored indexes missing from the plan as stale", () => {
    const diff = diffChunkPlan(
      [item(0, "a")],
      [
        { chunkIndex: 0, contentHash: "a", hasEmbedding: true },
        { chunkIndex: 1, contentHash: "old", hasEmbedding: true },
        { chunkIndex: 5, contentHash: "older", hasEmbedding: false },
      ]
    );
    expect(diff.staleIndexes).toEqual([1, 5]);
  });

  it("is empty on exact re-run (retry safety)", () => {
    const plan = [item(0, "a"), item(1, "b")];
    const diff = diffChunkPlan(plan, [
      { chunkIndex: 0, contentHash: "a", hasEmbedding: true },
      { chunkIndex: 1, contentHash: "b", hasEmbedding: true },
    ]);
    expect(diff.toEmbed).toEqual([]);
    expect(diff.staleIndexes).toEqual([]);
    expect(diff.toSkip).toHaveLength(2);
  });
});
