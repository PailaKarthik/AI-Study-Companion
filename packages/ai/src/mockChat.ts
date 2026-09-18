import { approximateMessagesTokens, approximateTokens } from "./chat.js";
import type {
  ChatCompletionInput,
  ChatCompletionProvider,
  ChatCompletionResult,
} from "./chat.js";

/**
 * Deterministic stand-in for tests and keyless local runs. Returns a canned
 * tutoring-style answer that references the number of supplied evidence
 * blocks — stable across processes, so idempotency tests are meaningful.
 * NEVER used in production paths; the tutor service refuses to answer
 * knowledge-backed questions with it outside tests.
 */
export class MockChatProvider implements ChatCompletionProvider {
  readonly name = "mock";
  readonly model = "mock-chat-v1";
  /** Counts complete calls so tests can assert no redundant work. */
  public calls = 0;

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    this.calls += 1;
    const evidenceBlocks = input.messages.filter((m) =>
      m.content.includes("[Source ")
    ).length;
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const question = lastUser ? lastUser.content.slice(0, 120) : "your question";
    const content =
      `Mock tutor answer for: ${question} ` +
      `(grounded in ${evidenceBlocks} evidence block${evidenceBlocks === 1 ? "" : "s"}). [1]`;
    return {
      content,
      model: this.model,
      latencyMs: 0,
      inputTokens: approximateMessagesTokens(input.messages),
      outputTokens: approximateTokens(content),
    };
  }
}
