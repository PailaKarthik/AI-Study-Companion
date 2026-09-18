/**
 * Chat-completion provider abstraction. The tutor service depends on this
 * interface — never on Groq directly — so the LLM can change without
 * rewriting retrieval, persistence, or citation logic.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionInput {
  /** Ordered history + current prompt. Providers may truncate from the front. */
  messages: ChatMessage[];
  /** Caps cost/latency; provider passes through to the API. */
  maxTokens?: number;
  /** Lower = more deterministic tutoring. */
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  latencyMs: number;
  /** Provider-reported or approximated token counts (for AIUsage rows). */
  inputTokens: number;
  outputTokens: number;
}

export interface ChatCompletionProvider {
  readonly name: string;
  readonly model: string;
  complete(input: ChatCompletionInput): Promise<ChatCompletionResult>;
}

/** Base error for chat failures. `retryable` drives backoff vs abort. */
export class ChatError extends Error {
  readonly retryable: boolean;
  readonly provider: string;

  constructor(message: string, options: { retryable: boolean; provider: string }) {
    super(message);
    this.name = "ChatError";
    this.retryable = options.retryable;
    this.provider = options.provider;
  }
}

/**
 * True when a provider failure looks like a timeout (AbortSignal.timeout
 * surfaces DOMException "TimeoutError"; transports report "timed out" /
 * "timeout" / ETIMEDOUT). Used to record AIUsageStatus.TIMEOUT instead of
 * lumping timeouts into FAILED — timeout analytics must not undercount.
 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: unknown; message?: unknown; code?: unknown };
  if (record.name === "TimeoutError") return true;
  if (typeof record.code === "string" && /timedout/i.test(record.code)) return true;
  if (typeof record.message === "string" && /timed?\s?out/i.test(record.message)) return true;
  return false;
}

/** Approximate tokens for usage rows when the provider omits usage (~chars/4). */
export function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function approximateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + approximateTokens(m.content), 0);
}
