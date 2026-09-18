import { describe, expect, it, vi } from "vitest";
import { isTimeoutError } from "./chat.js";
import { GroqChatProvider } from "./groq.js";
import { MockChatProvider } from "./mockChat.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chatOk(content: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return jsonResponse(200, {
    choices: [{ message: { role: "assistant", content } }],
    usage,
  });
}

describe("GroqChatProvider", () => {
  it("returns content with provider-reported usage", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      chatOk("Photosynthesis converts light [1].", {
        prompt_tokens: 120,
        completion_tokens: 12,
      })
    );
    const provider = new GroqChatProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    const result = await provider.complete({
      messages: [{ role: "user", content: "What is photosynthesis?" }],
    });
    expect(result.content).toContain("Photosynthesis");
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(12);
    expect(result.model).toBe("openai/gpt-oss-120b");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with backoff, then succeeds", async () => {
    const scripted: Response[] = [
      jsonResponse(429, { error: { message: "rate limited" } }),
      chatOk("Recovered answer."),
    ];
    let calls = 0;
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      const next = scripted[Math.min(calls, scripted.length - 1)] as Response;
      calls += 1;
      return next;
    });
    const provider = new GroqChatProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("Recovered answer.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats 400 as permanent and does not retry", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse(400, { error: { message: "bad request" } })
    );
    const provider = new GroqChatProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    await expect(
      provider.complete({ messages: [{ role: "user", content: "bad" }] })
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects empty completions instead of returning empty answers", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => chatOk("   "));
    const provider = new GroqChatProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffBaseMs: 1,
    });
    await expect(
      provider.complete({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toMatchObject({ retryable: false });
  });

  it("requires an API key", () => {
    expect(() => new GroqChatProvider({ apiKey: "" })).toThrow(/API key/);
  });
});

describe("MockChatProvider", () => {
  it("returns a deterministic canned answer and counts calls", async () => {
    const provider = new MockChatProvider();
    const input = {
      messages: [
        { role: "system" as const, content: "Be helpful." },
        { role: "user" as const, content: "Explain mitosis [Source 1] cell splits." },
      ],
    };
    const first = await provider.complete(input);
    const second = await provider.complete(input);
    expect(first.content).toBe(second.content);
    expect(provider.calls).toBe(2);
    expect(first.inputTokens).toBeGreaterThan(0);
  });
});

describe("isTimeoutError", () => {
  it("detects AbortSignal-style timeouts and transport messages", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(isTimeoutError(timeout)).toBe(true);
    expect(isTimeoutError(new Error("Groq request failed: TimeoutError: timed out"))).toBe(true);
    expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("rejects permanent failures and non-errors", () => {
    expect(isTimeoutError(new Error("Groq request failed permanently: HTTP 400"))).toBe(false);
    expect(isTimeoutError(new Error("rate limited"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false);
  });
});
