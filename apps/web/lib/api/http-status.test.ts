import { describe, expect, it } from "vitest";
import { ApiClientError } from "./client";
import { errorStateForStatus, isForbidden, isUnauthorized, statusOf } from "./http-status";

function apiError(status: number): ApiClientError {
  return new ApiClientError({ code: "X", message: "x", status, requestId: "r" });
}

describe("status helpers", () => {
  it("detects 401 and 403 API errors", () => {
    expect(isUnauthorized(apiError(401))).toBe(true);
    expect(isUnauthorized(apiError(403))).toBe(false);
    expect(isUnauthorized(new Error("nope"))).toBe(false);
    expect(isForbidden(apiError(403))).toBe(true);
    expect(isForbidden(apiError(404))).toBe(false);
  });

  it("extracts status from API errors only", () => {
    expect(statusOf(apiError(429))).toBe(429);
    expect(statusOf(new Error("nope"))).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

describe("errorStateForStatus", () => {
  it("maps known statuses to safe copy", () => {
    expect(errorStateForStatus(401).title).toBe("Authentication required");
    expect(errorStateForStatus(403).title).toBe("Not permitted");
    expect(errorStateForStatus(404).title).toBe("Not found");
    expect(errorStateForStatus(429).title).toBe("Too many requests");
  });

  it("falls back to a generic message for 500s and unknown input", () => {
    expect(errorStateForStatus(500).title).toBe("Something went wrong");
    expect(errorStateForStatus(undefined).title).toBe("Something went wrong");
    expect(errorStateForStatus(418).title).toBe("Something went wrong");
  });
});
