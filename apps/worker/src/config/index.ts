import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Required in production (fail fast): without a database every job
  // would fail with UnrecoverableError. Development may boot degraded.
  DATABASE_URL: z.string().optional().default(""),
  UPSTASH_REDIS_URL: z.string().optional().default(""),
  UPSTASH_REDIS_TOKEN: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),

  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).max(128).default("gemini-embedding-001"),

  KNOWLEDGE_CHUNK_TARGET_TOKENS: z.coerce.number().int().min(100).max(4000).default(700),
  KNOWLEDGE_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).max(1000).default(100),
  KNOWLEDGE_MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(2000).default(500),

  // Document pipeline (Prompt: async PDF processing). OCR runs fully
  // in-process via tesseract.js with vendored language data — no CDN.
  DOCUMENT_OCR_ENABLED: z.coerce.boolean().default(true),
  /** Pages with fewer chars than this are OCR candidates (scanned pages). */
  DOCUMENT_OCR_TEXT_THRESHOLD: z.coerce.number().int().min(0).max(10000).default(50),
  DOCUMENT_MAX_PAGES_PER_JOB: z.coerce.number().int().min(1).max(2000).default(500),
  DOCUMENT_MAX_IMAGES_PER_MATERIAL: z.coerce.number().int().min(0).max(500).default(50),
  /** Override for `<lang>.traineddata` dir; default is the vendored asset. */
  TESSERACT_LANG_PATH: z.string().optional().default(""),

  // Neon Object Storage (S3-compatible bucket) holds every file byte.
  // Same credential set as the API (branch credential with storage
  // scopes). STORAGE_PROVIDER=memory/redis are explicit test transports,
  // refused in production.
  STORAGE_PROVIDER: z.enum(["neon", "memory", "redis"]).default("neon"),
  STORAGE_BUCKET: z.string().optional().default(""),
  AWS_ENDPOINT_URL_S3: z.string().optional().default(""),
  AWS_ACCESS_KEY_ID: z.string().optional().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(""),
  AWS_REGION: z.string().optional().default(""),

  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  EMBEDDING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
});

export type WorkerConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  version: string;
};

function loadConfig(): WorkerConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker configuration: ${details}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
    throw new Error("Invalid worker configuration: DATABASE_URL is required in production.");
  }
  if (env.NODE_ENV === "production") {
    if (env.STORAGE_PROVIDER === "memory" || env.STORAGE_PROVIDER === "redis") {
      throw new Error(
        `Invalid worker configuration: STORAGE_PROVIDER=${env.STORAGE_PROVIDER} is test-only and refused in production.`
      );
    }
    const missing = [
      ["STORAGE_BUCKET", env.STORAGE_BUCKET],
      ["AWS_ENDPOINT_URL_S3", env.AWS_ENDPOINT_URL_S3],
      ["AWS_ACCESS_KEY_ID", env.AWS_ACCESS_KEY_ID],
      ["AWS_SECRET_ACCESS_KEY", env.AWS_SECRET_ACCESS_KEY],
    ]
      .filter(([, value]) => !value || value.trim().length === 0)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `Invalid worker configuration: Neon Object Storage is not configured in production ` +
          `(missing: ${missing.join(", ")}). Create a branch credential with storage scopes.`
      );
    }
  }
  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",
    version: process.env.npm_package_version ?? "0.1.0",
  };
}

export const workerConfig: WorkerConfig = loadConfig();

export function isRedisConfigured(cfg: WorkerConfig = workerConfig): boolean {
  return Boolean(cfg.REDIS_URL || (cfg.UPSTASH_REDIS_URL && cfg.UPSTASH_REDIS_TOKEN));
}
