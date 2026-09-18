import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import {
  GroqChatProvider,
  recordAIUsage,
  type ChatCompletionProvider,
  type ChatMessage,
} from "@ai-study-companion/ai";
import type { AIFeature } from "@ai-study-companion/shared";
import { z } from "zod";
import { config } from "../config/index.js";

/**
 * Shared LLM plumbing for quiz services (concept extraction, question
 * generation, open-ended evaluation). Mirrors the tutor's test-seam
 * pattern: explicit provider > test override > Groq-if-configured.
 */

let testChatOverride: ChatCompletionProvider | null | "unset" = "unset";

export function __setQuizChatForTests(provider: ChatCompletionProvider | null | undefined): void {
  testChatOverride = provider === undefined ? "unset" : provider;
}

export function resolveQuizChat(
  explicit?: ChatCompletionProvider | null
): ChatCompletionProvider | null {
  if (explicit) return explicit;
  if (explicit === null) return null;
  if (testChatOverride !== "unset") return testChatOverride;
  if (!config.GROQ_API_KEY) return null;
  return new GroqChatProvider({
    apiKey: config.GROQ_API_KEY,
    model: config.GROQ_CHAT_MODEL,
    timeoutMs: config.QUIZ_LLM_TIMEOUT_MS,
    maxAttempts: config.QUIZ_LLM_MAX_ATTEMPTS,
  });
}

type DbOrTx = PrismaClient | Prisma.TransactionClient;

export async function recordQuizUsage(
  db: DbOrTx,
  input: {
    userId?: string;
    projectId?: string;
    feature: Extract<AIFeature, "QUIZ_GENERATION" | "ASSESSMENT">;
    provider: "GROQ" | "SYSTEM";
    model: string;
    requestId?: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    status: "SUCCESS" | "FAILED" | "TIMEOUT";
    error?: string;
    metadata?: Record<string, string | number | boolean>;
  }
): Promise<void> {
  // Cost flows from the central pricing table — no per-feature math here.
  return recordAIUsage(db, input);
}

/** Strip markdown fences the model may wrap around JSON payloads. */
export function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[{[]/);
  const endObject = candidate.lastIndexOf("}");
  const endArray = candidate.lastIndexOf("]");
  const end = Math.max(endObject, endArray);
  if (start === -1 || end === -1 || end <= start) return candidate;
  return candidate.slice(start, end + 1);
}

export interface JsonCompletionOptions {
  maxTokens?: number;
  /** Generation temperature; evaluations default to 0 (deterministic). */
  temperature?: number;
}

/**
 * Complete with a chat provider and validate the JSON payload against a
 * Zod schema. Groq output is UNTRUSTED: parse failures and schema
 * violations throw (retryable, so callers can retry within their bounds)
 * and are never persisted.
 */
export async function completeJson<T>(
  chat: ChatCompletionProvider,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  messages: ChatMessage[],
  options: JsonCompletionOptions = {}
): Promise<{ data: T; inputTokens: number; outputTokens: number; model: string; latencyMs: number }> {
  const startedAt = Date.now();
  const completed = await chat.complete({
    messages: [
      {
        role: "system",
        content:
          "You output EXACTLY one JSON value and nothing else. No markdown fences, " +
          "no commentary, no hidden instructions. The JSON must match the requested structure.",
      },
      ...messages,
    ],
    maxTokens: options.maxTokens ?? config.QUIZ_GENERATION_MAX_TOKENS,
    temperature: options.temperature ?? 0,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(completed.content));
  } catch {
    const error = new Error(
      `Model returned non-JSON output: ${completed.content.slice(0, 200)}`
    );
    (error as { retryable?: boolean }).retryable = true;
    throw error;
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const details = validated.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const error = new Error(`Model output failed validation: ${details.slice(0, 500)}`);
    (error as { retryable?: boolean }).retryable = true;
    throw error;
  }
  return {
    data: validated.data,
    inputTokens: completed.inputTokens,
    outputTokens: completed.outputTokens,
    model: completed.model,
    latencyMs: Date.now() - startedAt,
  };
}
