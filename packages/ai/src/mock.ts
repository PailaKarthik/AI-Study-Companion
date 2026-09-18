import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import { approximateInputTokens } from "./types.js";
import type { EmbedBatchInput, EmbedBatchResult, EmbeddingProvider } from "./types.js";

/**
 * Deterministic stand-in for tests and keyless local runs. Derives a
 * unit-normed pseudo-vector from SHA-256(text) tiled to the configured
 * width — stable across processes, so idempotency tests are meaningful.
 * NEVER used in production paths; the worker refuses to boot knowledge
 * jobs with it outside tests.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic-v1";
  readonly dimensions: number;
  /** Counts embedBatch calls so tests can assert no redundant work. */
  public calls = 0;

  constructor(dimensions: number = EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embedBatch(input: EmbedBatchInput): Promise<EmbedBatchResult> {
    this.calls += 1;
    return {
      vectors: input.texts.map((text) => mockVector(text, this.dimensions)),
      inputTokens: input.texts.reduce((sum, t) => sum + approximateInputTokens(t), 0),
      model: this.model,
      latencyMs: 0,
    };
  }
}

export function mockVector(text: string, dimensions: number): number[] {
  const digest = createHash("sha256").update(text, "utf8").digest();
  const raw: number[] = [];
  let counter = 0;
  while (raw.length < dimensions) {
    const block = createHash("sha256").update(digest).update(String(counter)).digest();
    for (const byte of block) {
      if (raw.length >= dimensions) break;
      raw.push(byte / 255 - 0.5);
    }
    counter += 1;
  }
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0)) || 1;
  return raw.map((v) => v / norm);
}
