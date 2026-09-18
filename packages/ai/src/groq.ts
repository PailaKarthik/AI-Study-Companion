import {
  approximateMessagesTokens,
  approximateTokens,
  ChatError,
  type ChatCompletionInput,
  type ChatCompletionProvider,
  type ChatCompletionResult,
  type ChatMessage,
} from "./chat.js";

export interface GroqChatOptions {
  apiKey: string;
  /** e.g. "openai/gpt-oss-120b". */
  model?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Total attempts including the first try. Kept low: chat is latency-sensitive. */
  maxAttempts?: number;
  /** Base backoff in ms; doubled per retry with jitter. */
  backoffBaseMs?: number;
  /** Injected fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 2;
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

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { message?: unknown };
}

/**
 * Groq chat completions via the OpenAI-compatible endpoint
 * (plain fetch, no SDK — same rationale as the Gemini provider).
 *
 * Empty/censored completions surface as permanent ChatErrors rather than
 * empty tutor answers; transient HTTP statuses retry with backoff.
 */
export class GroqChatProvider implements ChatCompletionProvider {
  readonly name = "groq";
  readonly model: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqChatOptions) {
    if (!options.apiKey) {
      throw new Error("GroqChatProvider requires an API key (GROQ_API_KEY).");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const startedAt = Date.now();
    const messages = input.messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    }));
    const body = JSON.stringify({
      model: this.model,
      messages,
      ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    });

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.maxAttempts) {
            lastError = new ChatError(`Groq HTTP ${response.status}`, {
              retryable: true,
              provider: this.name,
            });
            await sleep(backoffDelayMs(attempt, this.backoffBaseMs));
            continue;
          }
          const detail = await safeErrorDetail(response);
          throw new ChatError(
            `Groq request failed permanently: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
            { retryable: false, provider: this.name }
          );
        }
        const parsed = (await response.json()) as GroqChatResponse;
        const content = parsed.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new ChatError("Groq returned an empty completion", {
            retryable: false,
            provider: this.name,
          });
        }
        const inputTokens =
          typeof parsed.usage?.prompt_tokens === "number"
            ? parsed.usage.prompt_tokens
            : approximateMessagesTokens(input.messages);
        const outputTokens =
          typeof parsed.usage?.completion_tokens === "number"
            ? parsed.usage.completion_tokens
            : approximateTokens(content);
        return {
          content,
          model: this.model,
          latencyMs: Date.now() - startedAt,
          inputTokens,
          outputTokens,
        };
      } catch (error) {
        if (error instanceof ChatError && !error.retryable) throw error;
        const retryable = !(error instanceof ChatError && !error.retryable);
        if (retryable && attempt < this.maxAttempts) {
          lastError = error;
          await sleep(backoffDelayMs(attempt, this.backoffBaseMs));
          continue;
        }
        if (error instanceof ChatError) throw error;
        throw new ChatError(
          `Groq request failed: ${error instanceof Error ? error.message : String(error)}`,
          { retryable: attempt < this.maxAttempts, provider: this.name }
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ChatError("Groq request failed after retries", {
          retryable: true,
          provider: this.name,
        });
  }
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as GroqChatResponse;
    const message = parsed.error?.message;
    return typeof message === "string" ? message.slice(0, 300) : "";
  } catch {
    return "";
  }
}
