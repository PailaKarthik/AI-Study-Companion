import { defineConfig } from "vitest/config";

/**
 * Test-only env wiring (mirrors apps/api/vitest.config.ts): map the
 * isolated throwaway database to DATABASE_URL before any module reads
 * env at import time. Refuses to run when pointed at the outer database.
 * STORAGE_PROVIDER=memory selects the explicit in-memory storage double
 * (test-only; production boot refuses it).
 */
const testDb = process.env.TEST_DATABASE_URL;
const outerDb = process.env.DATABASE_URL;

if (testDb) {
  if (outerDb && testDb === outerDb) {
    throw new Error(
      "Refusing to run tests: TEST_DATABASE_URL must not equal DATABASE_URL (production guard)."
    );
  }
  process.env.DATABASE_URL = testDb;
  process.env.DIRECT_URL = testDb;
}

if (!process.env.STORAGE_PROVIDER) {
  process.env.STORAGE_PROVIDER = "memory";
}

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
