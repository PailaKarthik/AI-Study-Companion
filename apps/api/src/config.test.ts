import { describe, expect, it } from "vitest";
import {
  assertCorsOrigins,
  assertProductionDatabase,
  assertProductionUrls,
} from "./config/index.js";

/**
 * Production configuration guards (unit — no env mutation, so the module
 * singleton is untouched and suites stay hermetic).
 */
describe("production configuration guards", () => {
  const prodDb = { NODE_ENV: "production", DATABASE_URL: "postgresql://db:5432/app" };

  it("requires DATABASE_URL in production, allows empty elsewhere", () => {
    expect(() => assertProductionDatabase(prodDb)).not.toThrow();
    expect(() => assertProductionDatabase({ NODE_ENV: "production", DATABASE_URL: "" })).toThrow(
      /DATABASE_URL is required in production/
    );
    expect(() =>
      assertProductionDatabase({ NODE_ENV: "development", DATABASE_URL: "" })
    ).not.toThrow();
    expect(() => assertProductionDatabase({ NODE_ENV: "test", DATABASE_URL: "" })).not.toThrow();
  });

  it("rejects localhost deployment URLs in production only", () => {
    const prod = {
      NODE_ENV: "production",
      WEB_URL: "https://app.example.com",
      API_URL: "https://api.example.com",
      API_CORS_ORIGIN: "https://app.example.com",
    };
    expect(() => assertProductionUrls(prod)).not.toThrow();
    expect(() => assertProductionUrls({ ...prod, WEB_URL: "http://localhost:3000" })).toThrow(
      /WEB_URL.*must not be localhost/
    );
    expect(() =>
      assertProductionUrls({
        ...prod,
        API_CORS_ORIGIN: "https://app.example.com, http://127.0.0.1:3000",
      })
    ).toThrow(/API_CORS_ORIGIN/);
    expect(() =>
      assertProductionUrls({
        NODE_ENV: "development",
        WEB_URL: "http://localhost:3000",
        API_URL: "http://localhost:4000",
        API_CORS_ORIGIN: "http://localhost:3000",
      })
    ).not.toThrow();
  });

  it("rejects wildcard and invalid CORS origins at startup", () => {
    expect(() => assertCorsOrigins({ NODE_ENV: "development", API_CORS_ORIGIN: "*" })).toThrow(
      /must not be "\*"/
    );
    expect(() =>
      assertCorsOrigins({ NODE_ENV: "development", API_CORS_ORIGIN: "not-a-url" })
    ).toThrow(/not a valid origin/);
    expect(() => assertCorsOrigins({ NODE_ENV: "development", API_CORS_ORIGIN: "   " })).toThrow(
      /at least one origin/
    );
    expect(() =>
      assertCorsOrigins({
        NODE_ENV: "development",
        API_CORS_ORIGIN: "https://app.example.com, https://admin.example.com",
      })
    ).not.toThrow();
  });
});
