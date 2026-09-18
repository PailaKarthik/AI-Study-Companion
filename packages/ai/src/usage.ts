import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import type { AIFeature } from "@ai-study-companion/shared";
import { estimateCostUsd } from "./pricing.js";

/**
 * Central AI usage writer (Prompt 11). Every provider call in API and
 * worker funnels through here so cost estimation lives in exactly one
 * place. `estimatedCost` is computed from the pricing table when the
 * model is known, else null (cost unavailable — never invented).
 */
export interface AIUsageInput {
  userId?: string;
  projectId?: string;
  feature: AIFeature;
  provider: "GROQ" | "GEMINI" | "SYSTEM";
  model: string;
  requestId?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  error?: string;
  metadata?: Record<string, string | number | boolean>;
}

export async function recordAIUsage(
  db: PrismaClient | Prisma.TransactionClient,
  input: AIUsageInput
): Promise<void> {
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  await db.aIUsage.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId,
      latencyMs: input.latencyMs,
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens !== null || outputTokens !== null
          ? (inputTokens ?? 0) + (outputTokens ?? 0)
          : null,
      estimatedCost: estimateCostUsd(input.model, inputTokens, outputTokens),
      status: input.status,
      error: input.error,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Backward-compatible embedding writer: delegates to recordAIUsage so
 * existing call sites (search, knowledge worker) gain cost estimation
 * without churn.
 */
export interface EmbeddingUsageInput {
  userId?: string;
  projectId?: string;
  feature: Extract<AIFeature, "EMBEDDING">;
  provider: "GEMINI" | "SYSTEM";
  model: string;
  requestId?: string;
  latencyMs: number;
  inputTokens: number;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  error?: string;
  metadata?: Record<string, string | number | boolean>;
}

export async function recordEmbeddingUsage(
  db: PrismaClient | Prisma.TransactionClient,
  input: EmbeddingUsageInput
): Promise<void> {
  return recordAIUsage(db, input);
}
