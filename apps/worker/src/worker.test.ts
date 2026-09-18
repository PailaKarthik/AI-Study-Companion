import { describe, expect, it } from "vitest";
import { isRedisConfigured, workerConfig } from "./config/index.js";
import { bullMqConnectionOptions, resolveRedisUrl } from "./lib/redis.js";
import { queueName } from "./queues/index.js";
import { QUEUE_NAMES } from "@ai-study-companion/config";
import { processSystemHealth } from "./processors/systemHealth.js";

describe("worker infrastructure", () => {
  it("queue naming convention is prefixed", () => {
    expect(queueName(QUEUE_NAMES.system)).toBe("aistudy.system");
  });

  it("BullMQ requires maxRetriesPerRequest: null", () => {
    const opts = bullMqConnectionOptions("rediss://example:6379");
    expect(opts.maxRetriesPerRequest).toBeNull();
  });

  it("does not require Redis credentials to import/boot config", () => {
    expect(typeof isRedisConfigured()).toBe("boolean");
    expect(typeof workerConfig.version).toBe("string");
    // resolveRedisUrl must not throw when unconfigured
    expect(() => resolveRedisUrl()).not.toThrow();
  });

  it("system.health processor returns ok without external services", async () => {
    const result = await processSystemHealth(
      { correlationId: "corr-test", enqueuedAt: new Date().toISOString() },
      {
        queue: "aistudy.system",
        jobName: "system.health",
        attempt: 1,
        correlationId: "corr-test",
      },
    );
    expect(result.status).toBe("ok");
    expect(result.correlationId).toBe("corr-test");
  });
});
