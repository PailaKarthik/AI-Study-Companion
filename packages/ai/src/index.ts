/**
 * @ai-study-companion/ai — provider-agnostic AI access for worker + API.
 *
 * Today: Gemini embeddings behind the `EmbeddingProvider` interface.
 * Retrieval code depends on the interface; swapping providers later means
 * writing one new class, not touching chunking, persistence, or search.
 */
export * from "./types.js";
export * from "./chat.js";
export * from "./gemini.js";
export * from "./groq.js";
export * from "./mock.js";
export * from "./mockChat.js";
export * from "./pricing.js";
export * from "./usage.js";
