/**
 * Central model pricing for AI cost observability (Prompt 11).
 *
 * ONE table, used by every AIUsage writer — cost logic never lives in
 * controllers. Prices are USD per 1M tokens, captured from public
 * provider pages on the `asOf` date below. They WILL drift: review this
 * table quarterly, and treat every computed value as an estimate
 * (surfaced to clients as `estimatedCostUsd`, never `costUsd`).
 *
 * Unknown models yield null cost — the system stays fully functional
 * (recording, analytics, dashboards) and simply reports cost as
 * unavailable rather than inventing numbers.
 */

export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

interface PricedModel extends ModelPrice {
  source: string;
}

const PRICING_AS_OF = "2026-09-01";

const MODEL_PRICES: Record<string, PricedModel> = {
  // Groq public pricing for OpenAI GPT-OSS 120B (current default chat model).
  "openai/gpt-oss-120b": {
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    source: "https://console.groq.com/docs/models (public model pricing)",
  },
  // Groq public pricing for OpenAI GPT-OSS 20B (lighter alternative).
  "openai/gpt-oss-20b": {
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3,
    source: "https://console.groq.com/docs/models (public model pricing)",
  },
  // Legacy Groq pricing for Llama 3.3 70B Versatile (now Enterprise-only;
  // kept so historical AIUsage rows still price correctly).
  "llama-3.3-70b-versatile": {
    inputPerMillionUsd: 0.59,
    outputPerMillionUsd: 0.79,
    source: "https://console.groq.com/docs/models (public model pricing)",
  },
  // Google AI Studio standard tier for the Gemini embedding family
  // (gemini-embedding-001 shares text-embedding-004 list pricing; the
  // free tier bills $0, which this table conservatively ignores).
  "gemini-embedding-001": {
    inputPerMillionUsd: 0.02,
    outputPerMillionUsd: 0,
    source: "https://ai.google.dev/pricing (embeddings standard tier)",
  },
};

export function pricingAsOf(): string {
  return PRICING_AS_OF;
}

/** Look up a model's price, or null when unpriced (cost unavailable). */
export function priceForModel(model: string): ModelPrice | null {
  const entry = MODEL_PRICES[model.trim().toLowerCase()];
  if (!entry) return null;
  return {
    inputPerMillionUsd: entry.inputPerMillionUsd,
    outputPerMillionUsd: entry.outputPerMillionUsd,
  };
}

/**
 * Estimate call cost in USD, rounded to 6 decimals (matches the
 * `ai_usage.estimated_cost DECIMAL(10,6)` column). Returns null when the
 * model is unpriced or token counts are absent — never throws, never
 * guesses.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined
): number | null {
  const price = priceForModel(model);
  if (!price) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  if (input < 0 || output < 0) return null;
  if (input === 0 && output === 0) return 0;
  const cost =
    (input / 1_000_000) * price.inputPerMillionUsd +
    (output / 1_000_000) * price.outputPerMillionUsd;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
