/**
 * Embedding provider abstraction. Retrieval logic depends on this
 * interface — never on Gemini directly — so providers can change without
 * rewriting chunking, persistence, or search.
 */

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbedBatchInput {
  /** Raw texts to embed. Order is preserved in the output. */
  texts: string[];
  /** Retrieval role; document chunks vs user queries embed differently. */
  taskType: EmbeddingTaskType;
}

export interface EmbedBatchResult {
  /** One vector per input text, in input order. */
  vectors: number[][];
  /** Provider-reported or approximated input tokens (for AIUsage rows). */
  inputTokens: number;
  model: string;
  latencyMs: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embedBatch(input: EmbedBatchInput): Promise<EmbedBatchResult>;
}

/** Base error for embedding failures. `retryable` drives backoff vs abort. */
export class EmbeddingError extends Error {
  readonly retryable: boolean;
  readonly provider: string;

  constructor(message: string, options: { retryable: boolean; provider: string }) {
    super(message);
    this.name = "EmbeddingError";
    this.retryable = options.retryable;
    this.provider = options.provider;
  }
}

/**
 * Permanent failure: the provider returned vectors of the wrong width.
 * Retrying is pointless and the pgvector column would reject the write,
 * so callers must fail the job loudly instead.
 */
export class EmbeddingDimensionError extends EmbeddingError {
  readonly expected: number;
  readonly received: number;

  constructor(provider: string, expected: number, received: number) {
    super(
      `Embedding dimension mismatch from ${provider}: expected ${expected}, got ${received}. ` +
        `Refusing to persist — fix the model/outputDimensionality, do not truncate silently.`,
      { retryable: false, provider }
    );
    this.name = "EmbeddingDimensionError";
    this.expected = expected;
    this.received = received;
  }
}

/** Approximate input tokens for usage rows (chars/4, rounded up). */
export function approximateInputTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
