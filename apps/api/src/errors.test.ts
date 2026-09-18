import { describe, expect, it } from "vitest";
import { AppError, toErrorPayload, ValidationError } from "./errors/AppError.js";

describe("error model", () => {
  it("formats validation errors without stack traces", () => {
    const error = new ValidationError("Bad input", [{ path: "name" }]);
    const payload = toErrorPayload(error, "req-1");
    expect(payload).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Bad input",
        details: [{ path: "name" }],
      },
      requestId: "req-1",
    });
    expect(JSON.stringify(payload)).not.toContain("stack");
  });

  it("maps codes to HTTP statuses", () => {
    expect(new AppError("NOT_FOUND", "missing").status).toBe(404);
    expect(new AppError("RATE_LIMITED", "slow down").status).toBe(429);
    expect(new AppError("INTERNAL_ERROR", "boom").status).toBe(500);
  });
});
