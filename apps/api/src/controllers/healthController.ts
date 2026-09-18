import type { Request, RequestHandler, Response } from "express";
import { isDatabaseConfigured, config } from "../config/index.js";
import { checkDatabase } from "@ai-study-companion/db";
import { isRedisConfigured } from "../config/index.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const bootTime = Date.now();

function uptimeSeconds(): number {
  return Math.floor((Date.now() - bootTime) / 1000);
}

/**
 * GET /health — liveness probe.
 * Always returns 200 without requiring external dependencies.
 */
export const getHealth: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const requestId = getRequestId(req);
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "api",
      version: config.version,
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
    },
    requestId,
  });
});

/**
 * GET /ready — readiness probe.
 * Checks optional dependencies but reports `skipped` (still 200) when
 * credentials are absent so local foundation development never blocks.
 * Returns 503 only when a *configured* dependency is actually down.
 */
export const getReadiness: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const requestId = getRequestId(req);

  const checks: Record<string, { status: "up" | "down" | "skipped"; detail?: string }> = {};

  if (isDatabaseConfigured()) {
    checks.database = await checkDatabase();
  } else {
    checks.database = { status: "skipped", detail: "DATABASE_URL is not configured" };
  }

  if (isRedisConfigured()) {
    // Foundation stage: do not perform a live Redis ping from the API.
    // The worker owns the Redis connection and reports it via its own
    // health job. Mark configured-but-unverified explicitly.
    checks.redis = { status: "skipped", detail: "Redis configured; live check owned by worker" };
  } else {
    checks.redis = { status: "skipped", detail: "Redis is not configured" };
  }

  const hasDown = Object.values(checks).some((c) => c.status === "down");
  const status = hasDown ? "not-ready" : "ready";

  res.status(hasDown ? 503 : 200).json({
    success: !hasDown,
    data: {
      status,
      service: "api",
      version: config.version,
      timestamp: new Date().toISOString(),
      checks,
    },
    requestId,
  });
});
