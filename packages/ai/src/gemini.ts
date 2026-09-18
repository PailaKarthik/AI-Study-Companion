import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import {
  approximateInputTokens,
  EmbeddingDimensionError,
  EmbeddingError,
  type EmbedBatchInput,
  type EmbedBatchResult,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./types.js";

export interface GeminiEmbeddingOptions {
  apiKey: string;
  /** e.g. "gemini-embedding-001". */
  model?: string;
  /** Must match the pgvector column; enforced on every response. */
  dimensions?: number;
  /** Texts per batchEmbedContents call (provider caps apply). */
  batchSize?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Total attempts including the first try. */
  maxAttempts?: number;
  /** Base backoff in ms; doubled per retry with jitter. */
  backoffBaseMs?: number;
  /** Injected fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_BASE_MS = 1_000;

/** HTTP statuses worth retrying with backoff. Everything else is permanent. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number, baseMs: number): number {
  const capped = Math.min(attempt, 6);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.floor(baseMs * 2 ** (capped - 1) * jitter);
}

interface GeminiBatchResponse {
  embeddings?: Array<{ values?: unknown }>;
}

/**
 * Gemini embeddings via `batchEmbedContents` (plain fetch, no SDK).
 *
 * Model/dimension contract: `gemini-embedding-001` with explicit
 * `outputDimensionality: 768` so output always matches the
 * `vector(768)` column + HNSW index. Any width mismatch throws
 * EmbeddingDimensionError (permanent) instead of persisting garbage.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly dimensions: number;

  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiEmbeddingOptions) {
    if (!options.apiKey) {
      throw new Error("GeminiEmbeddingProvider requires an API key (GEMINI_API_KEY).");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embedBatch(input: EmbedBatchInput): Promise<EmbedBatchResult> {
    const startedAt = Date.now();
    if (input.texts.length === 0) {
      return { vectors: [], inputTokens: 0, model: this.model, latencyMs: 0 };
    }
    const vectors: number[][] = [];
    for (let i = 0; i < input.texts.length; i += this.batchSize) {
      const slice = input.texts.slice(i, i + this.batchSize);
      const out = await this.embedSlice(slice, input.taskType);
      vectors.push(...out);
    }
    return {
      vectors,
      inputTokens: input.texts.reduce((sum, t) => sum + approximateInputTokens(t), 0),
      model: this.model,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async embedSlice(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`;
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: this.dimensions,
      })),
    });

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.maxAttempts) {
            lastError = new EmbeddingError(`Gemini HTTP ${response.status}`, {
              retryable: true,
              provider: this.name,
            });
            await sleep(backoffDelayMs(attempt, this.backoffBaseMs));
            continue;
          }
          throw new EmbeddingError(`Gemini request failed permanently: HTTP ${response.status}`, {
            retryable: false,
            provider: this.name,
          });
        }
        const parsed = (await response.json()) as GeminiBatchResponse;
        return this.validateVectors(parsed, texts.length);
      } catch (error) {
        if (error instanceof EmbeddingDimensionError) throw error;
        const retryable = !(error instanceof EmbeddingError && !error.retryable);
        if (retryable && attempt < this.maxAttempts) {
          lastError = error;
          await sleep(backoffDelayMs(attempt, this.backoffBaseMs));
          continue;
        }
        if (error instanceof EmbeddingError) throw error;
        throw new EmbeddingError(
          `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: attempt < this.maxAttempts, provider: this.name }
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new EmbeddingError("Gemini request failed after retries", {
          retryable: true,
          provider: this.name,
        });
  }

  private validateVectors(parsed: GeminiBatchResponse, expected: number): number[][] {
    const embeddings = parsed.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== expected) {
      throw new EmbeddingError(
        `Gemini returned ${embeddings?.length ?? 0} embeddings for ${expected} texts`,
        { retryable: false, provider: this.name }
      );
    }
    return embeddings.map((entry) => {
      const values = entry.values;
      if (!Array.isArray(values) || values.some((v) => typeof v !== "number")) {
        throw new EmbeddingError("Gemini returned malformed embedding values", {
          retryable: false,
          provider: this.name,
        });
      }
      if (values.length !== this.dimensions) {
        throw new EmbeddingDimensionError(this.name, this.dimensions, values.length);
      }
      return values as number[];
    });
  }
}
