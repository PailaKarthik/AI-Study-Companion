import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import { GeminiEmbeddingProvider } from "./gemini.js";
import { EmbeddingDimensionError } from "./types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function vectorJson(dimensions = EMBEDDING_DIMENSIONS): { values: number[] } {
  return { values: Array.from({ length: dimensions }, (_, i) => (i + 1) / dimensions) };
}

describe("GeminiEmbeddingProvider", () => {
  it("batches texts and preserves order", async () => {
    // Echo one embedding per requested text, like the real endpoint.
    const fetchImpl = vi.fn(async (url: unknown, init?: unknown): Promise<Response> => {
      const body = JSON.parse(String((init as { body?: unknown })?.body ?? "{}")) as {
        requests?: unknown[];
      };
      const count = body.requests?.length ?? 0;
      return jsonResponse(200, { embeddings: Array.from({ length: count }, () => vectorJson()) });
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      batchSize: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    const result = await provider.embedBatch({
      texts: ["alpha", "beta", "gamma"],
      taskType: "RETRIEVAL_DOCUMENT",
    });
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    // Two batches for three texts with batchSize 2.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.model).toBe("gemini-embedding-001");
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  it("retries transient failures with backoff, then succeeds", async () => {
    const scripted: Response[] = [
      jsonResponse(429, { error: "rate limited" }),
      jsonResponse(503, { error: "unavailable" }),
      jsonResponse(200, { embeddings: [vectorJson()] }),
    ];
    let calls = 0;
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      const next = scripted[Math.min(calls, scripted.length - 1)] as Response;
      calls += 1;
      return next;
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    const result = await provider.embedBatch({ texts: ["retry me"], taskType: "RETRIEVAL_QUERY" });
    expect(result.vectors).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats 400 as permanent and does not retry", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return jsonResponse(400, { error: "bad request" });
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    await expect(
      provider.embedBatch({ texts: ["bad"], taskType: "RETRIEVAL_QUERY" })
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects dimension mismatches permanently without persisting", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return jsonResponse(200, { embeddings: [vectorJson(128)] });
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    const error = await provider
      .embedBatch({ texts: ["wrong width"], taskType: "RETRIEVAL_DOCUMENT" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingDimensionError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed responses permanently", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return jsonResponse(200, { embeddings: [{ values: "nope" }] });
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    await expect(
      provider.embedBatch({ texts: ["malformed"], taskType: "RETRIEVAL_DOCUMENT" })
    ).rejects.toMatchObject({ retryable: false });
  });

  it("requires an API key at construction", () => {
    expect(() => new GeminiEmbeddingProvider({ apiKey: "" })).toThrow(/API key/);
  });
});
