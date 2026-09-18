import { describe, expect, it } from "vitest";
import { buildUpstashTcpUrl } from "../lib/queues.js";
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

/**
 * Regression (production incident): the Upstash pair was composed with
 * `${url.host}:6379`, but `host` already includes `:6379` when the pasted
 * URL carries a port — producing `host:6379:6379`, which makes ioredis
 * `new Redis()` throw `TypeError: Invalid URL` synchronously. Thrown
 * outside the store's try/catch, that 500'd every request including
 * GET /health. Composition must never emit an invalid URL.
 */
describe("Upstash TCP URL composition", () => {
  it("returns a full credentialed TCP URL verbatim", () => {
    const full = "rediss://default:s3cret@host.upstash.io:6379";
    expect(buildUpstashTcpUrl(full, "ignored")).toBe(full);
  });

  it("composes host + token without duplicating the port", () => {
    expect(buildUpstashTcpUrl("https://host.upstash.io", "tok")).toBe(
      "rediss://default:tok@host.upstash.io:6379"
    );
    // A ported URL without credentials keeps its port, exactly once.
    expect(buildUpstashTcpUrl("rediss://host.upstash.io:6380", "tok")).toBe(
      "rediss://default:tok@host.upstash.io:6380"
    );
  });

  it("returns null instead of a malformed URL", () => {
    expect(buildUpstashTcpUrl("not a url", "tok")).toBeNull();
  });
});
