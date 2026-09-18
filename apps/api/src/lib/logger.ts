import pino from "pino";
import { config } from "../config/index.js";

const REDACTED = "[REDACTED]";

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    service: "api",
    environment: config.SENTRY_ENVIRONMENT,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      // Parsed cookies (session token) and anything cookie-shaped.
      "req.cookies",
      "*.cookie",
      "*.sessionToken",
      "*.tokenHash",
      "*.sessionId",
      "*.passwordHash",
      "*.apiKey",
      "*.password",
      "*.token",
      "*.secret",
      "DATABASE_URL",
      "DIRECT_URL",
      "GROQ_API_KEY",
      "GEMINI_API_KEY",
      "SESSION_SECRET",
      "UPSTASH_REDIS_TOKEN",
    ],
    censor: REDACTED,
  },
  transport:
    config.isDevelopment && !config.isTest
      ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
      : undefined,
});

export type Logger = typeof logger;
