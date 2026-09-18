import * as Sentry from "@sentry/node";
import { config, isSentryConfigured } from "../config/index.js";
import { logger } from "./logger.js";

let initialized = false;

/** Header names that must never leave the process (auth material). */
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);

/**
 * Minimal structural shape the scrubber needs — deliberately narrower
 * than Sentry.ErrorEvent so the function stays unit-testable without SDK
 * types and never depends on fields it doesn't touch.
 */
export interface ScrubbableSentryEvent {
  request?: {
    headers?: Record<string, unknown>;
    cookies?: unknown;
  };
  user?: unknown;
}

/**
 * Strip auth material from Sentry events before they leave the process.
 * Pure function (exported for tests): request headers are dropped to
 * just names, cookies/authorization removed, and any `user` payload
 * reduced to an id.
 */
export function scrubSentryEvent(event: ScrubbableSentryEvent): ScrubbableSentryEvent {
  try {
    const headers = event.request?.headers;
    if (headers && typeof headers === "object") {
      const scrubbed: Record<string, string> = {};
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) continue;
        scrubbed[key] = "[present]";
      }
      event.request = { ...event.request, headers: scrubbed };
    }
    if (event.request && "cookies" in event.request) {
      const { cookies: _cookies, ...rest } = event.request;
      event.request = rest;
    }
    const user = event.user;
    if (user && typeof user === "object") {
      const id = (user as Record<string, unknown>).id;
      event.user = typeof id === "string" ? { id } : undefined;
    }
    return event;
  } catch {
    // A scrub failure must never drop the error report itself.
    return event;
  }
}

export function initSentry(): void {
  if (initialized || !isSentryConfigured()) {
    return;
  }
  try {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.SENTRY_ENVIRONMENT,
      tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
      beforeSend: (event) => scrubSentryEvent(event) as Sentry.ErrorEvent,
    });
    initialized = true;
    logger.info("Sentry initialized for API");
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Sentry initialization failed; continuing without Sentry"
    );
  }
}

export { Sentry };
