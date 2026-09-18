import pino from "pino";
import { workerConfig } from "../config/index.js";

export const logger = pino({
  level: workerConfig.LOG_LEVEL,
  base: {
    service: "worker",
    environment: workerConfig.SENTRY_ENVIRONMENT,
  },
  redact: {
    paths: ["*.apiKey", "*.password", "*.token", "*.secret", "UPSTASH_REDIS_TOKEN"],
    censor: "[REDACTED]",
  },
  transport:
    workerConfig.isDevelopment && !workerConfig.isTest
      ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
      : undefined,
});
