import "dotenv/config";
import { z } from "zod";

/**
 * Central typed configuration for the Express API.
 * No `process.env.X` access is allowed outside this module.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  API_CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Trusted reverse-proxy hops for Express `trust proxy` (rate-limit IP,
   * Secure cookies). Must match the real deployment topology. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  DATABASE_URL: z.string().optional().default(""),
  DIRECT_URL: z.string().optional().default(""),

  GROQ_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),

  UPSTASH_REDIS_URL: z.string().optional().default(""),
  UPSTASH_REDIS_TOKEN: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default(""),

  // Neon Object Storage (S3-compatible bucket) holds every file byte:
  // uploaded PDFs + extracted page images. PostgreSQL holds only
  // metadata. Credentials come from a branch credential with
  // storage:read + storage:write scopes (Neon Console → Credentials).
  // STORAGE_PROVIDER=memory/redis are explicit test transports (refused
  // in production); "neon" without credentials fails file operations
  // honestly (503/FAILED) instead of falling back anywhere.
  STORAGE_PROVIDER: z.enum(["neon", "memory", "redis"]).default("neon"),
  STORAGE_BUCKET: z.string().optional().default(""),
  AWS_ENDPOINT_URL_S3: z.string().optional().default(""),
  AWS_ACCESS_KEY_ID: z.string().optional().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(""),
  AWS_REGION: z.string().optional().default(""),
  // Upload ceiling: PDFs above it are rejected with a controlled 400
  // before any byte reaches the bucket (1–50 MB).
  STORAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024 * 1024)
    .max(50 * 1024 * 1024)
    .default(15 * 1024 * 1024),

  SESSION_SECRET: z.string().min(1).default("dev-only-change-me"),

  SESSION_COOKIE_NAME: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .default("asc_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  SESSION_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  AUTH_REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  GEMINI_EMBEDDING_MODEL: z.string().min(1).max(128).default("gemini-embedding-001"),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  EMBEDDING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),

  SEARCH_SEMANTIC_WEIGHT: z.coerce.number().min(0).max(1).default(0.7),
  SEARCH_LEXICAL_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
  SEARCH_SEMANTIC_TOP_K: z.coerce.number().int().min(1).max(100).default(20),
  SEARCH_LEXICAL_TOP_K: z.coerce.number().int().min(1).max(100).default(20),
  SEARCH_RESULT_LIMIT: z.coerce.number().int().min(1).max(50).default(8),
  SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  SEARCH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  GROQ_CHAT_MODEL: z.string().min(1).max(128).default("openai/gpt-oss-120b"),
  TUTOR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(60000),
  TUTOR_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  TUTOR_MAX_TOKENS: z.coerce.number().int().min(128).max(8192).default(1024),
  TUTOR_HISTORY_LIMIT: z.coerce.number().int().min(0).max(50).default(20),
  TUTOR_RETRIEVAL_LIMIT: z.coerce.number().int().min(1).max(20).default(6),
  TUTOR_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  TUTOR_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  QUIZ_MIN_QUESTIONS: z.coerce.number().int().min(1).max(20).default(1),
  QUIZ_MAX_QUESTIONS: z.coerce.number().int().min(1).max(20).default(20),
  QUIZ_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90000),
  QUIZ_LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  QUIZ_GENERATION_MAX_TOKENS: z.coerce.number().int().min(512).max(8192).default(4096),
  /** Evidence chunks supplied per concept during question generation. */
  QUIZ_EVIDENCE_CHUNKS: z.coerce.number().int().min(1).max(20).default(6),
  /** Knowledge chunks sampled for lightweight concept extraction. */
  QUIZ_CONCEPT_SAMPLE_CHUNKS: z.coerce.number().int().min(5).max(100).default(30),
  /** Bounded regeneration attempts for malformed/duplicate questions. */
  QUIZ_GENERATION_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  QUIZ_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  QUIZ_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),
  QUIZ_GENERATE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  QUIZ_GENERATE_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  // -------------------------------------------------------------------------
  // Concept mastery / growth / recommendations (Prompt 10).
  // Starting weights, not universal truths — see docs/MASTERY.md.
  // Assessment evidence (quiz + open-ended) dominates; low-quality
  // interactions can never overwhelm it.
  // -------------------------------------------------------------------------
  /** Base blend weight for deterministic MCQ evidence (0–1). */
  MASTERY_QUIZ_WEIGHT: z.coerce.number().min(0).max(1).default(0.45),
  /** Base blend weight for Groq open-ended evidence (0–1). */
  MASTERY_OPEN_ENDED_WEIGHT: z.coerce.number().min(0).max(1).default(0.35),
  /** Base blend weight for learning-activity evidence (0–1). */
  MASTERY_ACTIVITY_WEIGHT: z.coerce.number().min(0).max(1).default(0.1),
  /** Base blend weight for grounded tutor-engagement evidence (0–1). */
  MASTERY_TUTOR_WEIGHT: z.coerce.number().min(0).max(1).default(0.1),
  /** Hard cap on one evidence item's effective weight — no single question
   * radically changes mastery. */
  MASTERY_MAX_SINGLE_WEIGHT: z.coerce.number().min(0.05).max(1).default(0.6),
  /** Recency half-life in days; weight floored so old evidence never
   * vanishes and absence never aggressively decays mastery. */
  MASTERY_RECENCY_HALF_LIFE_DAYS: z.coerce.number().min(1).max(365).default(30),
  MASTERY_RECENCY_FLOOR: z.coerce.number().min(0).max(1).default(0.4),
  /** Mastery bands: [0, attention) NEEDS_ATTENTION, [attention, developing)
   * DEVELOPING, [developing, strong) STABLE, [strong, 1] STRONG. */
  MASTERY_ATTENTION_BELOW: z.coerce.number().min(0).max(1).default(0.4),
  MASTERY_DEVELOPING_BELOW: z.coerce.number().min(0).max(1).default(0.65),
  MASTERY_STRONG_AT: z.coerce.number().min(0).max(1).default(0.8),
  /** Minimum MasteryEvents before a trend classifies (else INSUFFICIENT_DATA). */
  GROWTH_MIN_EVENTS: z.coerce.number().int().min(2).max(20).default(3),
  /** Recent-half vs older-half mean gap that counts as a real move. */
  GROWTH_TREND_DELTA: z.coerce.number().min(0.01).max(0.5).default(0.05),
  /** Recent-half mean below this with poor form flags NEEDS_ATTENTION. */
  GROWTH_WEAK_BELOW: z.coerce.number().min(0).max(1).default(0.4),
  /** Bounded MasteryEvents analyzed per concept for growth reads. */
  GROWTH_MAX_EVENTS_PER_CONCEPT: z.coerce.number().int().min(5).max(100).default(20),
  /** Incorrect responses across distinct attempts before a REPEATED_MISTAKE
   * LearnerContext row is written (single answers never become traits). */
  MASTERY_REPEATED_MISTAKE_THRESHOLD: z.coerce.number().int().min(2).max(10).default(3),
  /** Recommendations router limiter (reads + lifecycle actions). */
  MASTERY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  MASTERY_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  /** Admin analytics limiter — generous enough for dashboard navigation. */
  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60 * 1000),

  SENTRY_DSN: z.string().optional().default(""),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  version: string;
};

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid API configuration: ${details}`);
  }
  const env = parsed.data;
  assertProductionSessionSecret({ NODE_ENV: env.NODE_ENV, SESSION_SECRET: env.SESSION_SECRET });
  assertCorsOrigins(env);
  assertProductionDatabase(env);
  assertProductionUrls(env);
  assertProductionStorage(env);
  const cfg = {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",
    version: process.env.npm_package_version ?? "0.1.0",
  };
  return cfg;
}

const KNOWN_BAD_SECRETS = new Set([
  "dev-only-change-me",
  "change-me-in-development-use-32-plus-random-chars",
  "secret",
  "development-secret",
  "changeme",
]);

/**
 * Production must never boot with a placeholder or short session secret —
 * it would let anyone forge session-token HMACs. No silent fallbacks.
 */
function assertProductionSessionSecret(cfg: { NODE_ENV: string; SESSION_SECRET: string }): void {
  if (cfg.NODE_ENV !== "production") return;
  if (cfg.SESSION_SECRET.length < 32 || KNOWN_BAD_SECRETS.has(cfg.SESSION_SECRET)) {
    throw new Error(
      "Invalid API configuration: SESSION_SECRET must be a unique random value " +
        "of at least 32 characters in production."
    );
  }
}

/**
 * Production file operations require the Neon Object Storage bucket:
 * without it every upload/download fails. The memory double is
 * test-only. Fail fast instead of booting an API that cannot store.
 */
function assertProductionStorage(cfg: {
  NODE_ENV: string;
  STORAGE_PROVIDER: string;
  STORAGE_BUCKET: string;
  AWS_ENDPOINT_URL_S3: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
}): void {
  if (cfg.NODE_ENV !== "production") return;
  if (cfg.STORAGE_PROVIDER === "memory" || cfg.STORAGE_PROVIDER === "redis") {
    throw new Error(
      `Invalid API configuration: STORAGE_PROVIDER=${cfg.STORAGE_PROVIDER} is test-only and refused in production.`
    );
  }
  const missing = [
    ["STORAGE_BUCKET", cfg.STORAGE_BUCKET],
    ["AWS_ENDPOINT_URL_S3", cfg.AWS_ENDPOINT_URL_S3],
    ["AWS_ACCESS_KEY_ID", cfg.AWS_ACCESS_KEY_ID],
    ["AWS_SECRET_ACCESS_KEY", cfg.AWS_SECRET_ACCESS_KEY],
  ]
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Invalid API configuration: Neon Object Storage is not configured in production ` +
        `(missing: ${missing.join(", ")}). Create a branch credential with storage scopes.`
    );
  }
}

/**
 * CORS origins must be explicit, parseable URL origins — never "*".
 * A wildcard with `credentials: true` would let any site read
 * authenticated responses; fail fast instead of booting insecure.
 */
export function assertCorsOrigins(cfg: { NODE_ENV: string; API_CORS_ORIGIN: string }): void {
  const origins = cfg.API_CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("Invalid API configuration: API_CORS_ORIGIN must list at least one origin.");
  }
  for (const origin of origins) {
    if (origin === "*") {
      throw new Error(
        'Invalid API configuration: API_CORS_ORIGIN must not be "*" for the authenticated API.'
      );
    }
    try {
      const url = new URL(origin);
      if (url.origin !== origin) {
        throw new Error("not an origin");
      }
    } catch {
      throw new Error(
        `Invalid API configuration: API_CORS_ORIGIN entry is not a valid origin: ${origin}`
      );
    }
  }
}

/**
 * Production must have a database: degraded boot (GET /ready `skipped`)
 * is a development convenience, never a production state. Fail fast so a
 * missing DATABASE_URL can't silently serve an empty API.
 */
export function assertProductionDatabase(cfg: { NODE_ENV: string; DATABASE_URL: string }): void {
  if (cfg.NODE_ENV !== "production") return;
  if (!cfg.DATABASE_URL) {
    throw new Error("Invalid API configuration: DATABASE_URL is required in production.");
  }
}

function isLocalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Production must not point at localhost: cookies, CORS, and CSRF origin
 * checks all assume the configured URLs are the real deployment. A
 * localhost default leaking into production would break auth silently —
 * fail fast instead.
 */
export function assertProductionUrls(cfg: {
  NODE_ENV: string;
  WEB_URL: string;
  API_URL: string;
  API_CORS_ORIGIN: string;
}): void {
  if (cfg.NODE_ENV !== "production") return;
  const offenders: string[] = [];
  if (isLocalUrl(cfg.WEB_URL)) offenders.push("WEB_URL");
  if (isLocalUrl(cfg.API_URL)) offenders.push("API_URL");
  for (const origin of cfg.API_CORS_ORIGIN.split(",").map((o) => o.trim())) {
    if (origin && isLocalUrl(origin)) offenders.push(`API_CORS_ORIGIN (${origin})`);
  }
  if (offenders.length > 0) {
    throw new Error(
      `Invalid API configuration: ${offenders.join(", ")} must not be localhost in production.`
    );
  }
}

export const config: AppConfig = loadConfig();

export function isRedisConfigured(cfg: AppConfig = config): boolean {
  return Boolean(cfg.REDIS_URL || (cfg.UPSTASH_REDIS_URL && cfg.UPSTASH_REDIS_TOKEN));
}

export function isDatabaseConfigured(cfg: AppConfig = config): boolean {
  return Boolean(cfg.DATABASE_URL);
}

export function isSentryConfigured(cfg: AppConfig = config): boolean {
  return Boolean(cfg.SENTRY_DSN);
}

/**
 * Secure cookies in production always; SameSite=None also forces Secure
 * (browsers reject None without it). Local dev stays http-capable.
 */
export function isCookieSecure(cfg: AppConfig = config): boolean {
  return cfg.isProduction || cfg.SESSION_SAMESITE === "none";
}

export function sessionTtlMs(cfg: AppConfig = config): number {
  return cfg.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}
