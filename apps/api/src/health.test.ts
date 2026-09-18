import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const app = createApp();

describe("health endpoints", () => {
  it("GET /health returns ok payload with requestId", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("api");
    expect(typeof res.body.requestId).toBe("string");
    expect(res.headers["x-request-id"]).toBe(res.body.requestId);
  });

  it("GET /ready returns readiness payload without requiring credentials", async () => {
    const res = await request(app).get("/ready");
    expect([200, 503]).toContain(res.status);
    expect(res.body.data.service).toBe("api");
    expect(res.body.data.checks).toBeDefined();
    expect(typeof res.body.requestId).toBe("string");
  });

  it("unknown routes return NOT_FOUND error envelope", async () => {
    const res = await request(app).get("/definitely-not-here");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(typeof res.body.requestId).toBe("string");
  });

  it("propagates incoming x-request-id", async () => {
    const res = await request(app).get("/health").set("x-request-id", "test-123");
    expect(res.body.requestId).toBe("test-123");
    expect(res.headers["x-request-id"]).toBe("test-123");
  });
});
