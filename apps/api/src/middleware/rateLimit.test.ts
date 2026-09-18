import { describe, expect, it } from "vitest";
import { rateLimitRedisKey } from "./rateLimit.js";

/**
 * Regression: limiter budgets sharing a key shape (global IP limiter vs
 * register IP limiter) must not increment the same Redis counter —
 * otherwise every API request burns the register budget and real users
 * get 429s. The in-memory fallback is per-instance by construction;
 * these pins cover the shared-Redis path.
 */
describe("rate-limit Redis key namespaces", () => {
  it("isolates limiter budgets sharing a client key", () => {
    const ip = "::ffff:127.0.0.1";
    expect(rateLimitRedisKey("global", ip)).toBe(`ratelimit:global:${ip}`);
    expect(rateLimitRedisKey("auth-register", ip)).toBe(`ratelimit:auth-register:${ip}`);
    expect(rateLimitRedisKey("global", ip)).not.toBe(rateLimitRedisKey("auth-register", ip));
  });

  it("gives every route limiter its own namespace", () => {
    const keys = new Set(
      [
        "global",
        "admin",
        "tutor",
        "mastery",
        "materials",
        "search",
        "quiz",
        "quiz-generate",
        "auth-register",
        "auth-login",
      ].map((namespace) => rateLimitRedisKey(namespace, "same-key"))
    );
    expect(keys.size).toBe(10);
  });
});
