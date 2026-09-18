import { defineConfig } from "vitest/config";

/**
 * Test-only env wiring. Runs before any test file is imported, so the API
 * config module (which reads env at import time) sees the test database.
 *
 * - TEST_DATABASE_URL → isolated throwaway DB (e.g. local pgvector
 *   container). Integration suites skip with a warning when it is absent.
 * - NEVER point it at production: startup refuses when it matches the
 *   outer DATABASE_URL.
 * - STORAGE_PROVIDER=memory selects the explicit in-memory storage
 *   double (no bucket credentials in this environment). It is test-only
 *   by construction — production boot refuses it — and mirrors the
 *   MockEmbeddingProvider precedent: metadata↔bytes contracts stay
 *   fully exercised without live infrastructure.
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
    // Integration suites share ONE isolated database and reset it in
    // beforeEach — files must run serially to avoid wiping each other.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
