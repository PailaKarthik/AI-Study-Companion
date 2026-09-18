import { describe, expect, it } from "vitest";
import { toUserMessage, isRetryable, requestIdOf, ApiClientError } from "./errors";

function apiError(status: number, requestId = "r1") {
  return new ApiClientError({ code: "ERR", message: "m", status, requestId });
}

describe("api error helpers", () => {
  it("maps ApiClientError to user message", () => {
    const error = new ApiClientError({
      code: "NOT_FOUND",
      message: "Missing",
      status: 404,
      requestId: "r1",
    });
    expect(toUserMessage(error)).toBe("Missing");
    expect(isRetryable(error)).toBe(false);
  });

  it("marks 503 as retryable", () => {
    const error = new ApiClientError({
      code: "SERVICE_UNAVAILABLE",
      message: "Down",
      status: 503,
      requestId: "r2",
    });
    expect(isRetryable(error)).toBe(true);
  });

  it("marks 429 as retryable but 4xx as final", () => {
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(500))).toBe(true);
    expect(isRetryable(apiError(400))).toBe(false);
    expect(isRetryable(apiError(401))).toBe(false);
    expect(isRetryable(apiError(403))).toBe(false);
    expect(isRetryable(apiError(404))).toBe(false);
  });

  it("never retries transport-level aborts/offline as queries", () => {
    // A network TypeError is not an ApiClientError: TanStack's global
    // retry fn must not spin on it (offline stays an error state).
    expect(isRetryable(new TypeError("fetch failed"))).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });

  it("extracts request ids only from API errors", () => {
    expect(requestIdOf(apiError(500, "abc"))).toBe("abc");
    expect(requestIdOf(new Error("boom"))).toBeUndefined();
    expect(requestIdOf(null)).toBeUndefined();
  });
});
