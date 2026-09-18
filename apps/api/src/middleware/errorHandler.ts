import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  AppError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
  toErrorPayload,
} from "../errors/AppError.js";
import { formatZodError } from "@ai-study-companion/validation";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { isRecordNotFound, isUniqueViolation } from "../lib/prismaErrors.js";
import { Sentry } from "../lib/sentry.js";
import { getRequestId } from "./requestId.js";

/** Wraps async route handlers so rejections reach the error handler. */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Translate known Prisma error codes into safe client errors. Anything
 * unrecognized falls through to a generic 500 — database internals
 * (constraint names, SQL, URLs) never reach the client.
 */
export function fromPrismaError(error: unknown): AppError | null {
  if (typeof error !== "object" || error === null) return null;
  if (isUniqueViolation(error)) {
    return new ConflictError("A resource with these details already exists");
  }
  if (isRecordNotFound(error)) {
    return new NotFoundError("Resource not found");
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !code.startsWith("P")) return null;
  switch (code) {
    case "P2003":
    case "P2014":
      return new ValidationError("The request references a resource that cannot be used here");
    default:
      return null;
  }
}

/** 404 handler for unknown routes. Never reflects user input. */
export function notFoundHandler(req: Request, res: Response): void {
  const requestId = getRequestId(req);
  res.status(404).json({
    success: false as const,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
    },
    requestId,
  });
}

/** Centralized error handler. Never exposes stack traces in production. */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = getRequestId(req);

  let appError: AppError;
  if (error instanceof ZodError) {
    appError = new ValidationError("Request validation failed", formatZodError(error));
  } else if (error instanceof AppError) {
    appError = error;
  } else if (
    error instanceof SyntaxError &&
    "body" in (error as unknown as Record<string, unknown>)
  ) {
    appError = new ValidationError("Invalid JSON request body");
  } else if (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 413
  ) {
    // Body-parser limits (e.g. oversized raw uploads that cleared the
    // route ceiling): controlled 400, never a bare 500.
    appError = new ValidationError("Request body too large");
  } else {
    appError = fromPrismaError(error) ?? new InternalError();
  }

  const status = appError.status;

  logger.error(
    {
      requestId,
      route: `${req.method} ${req.path}`,
      code: appError.code,
      status,
      // Only include safe diagnostics; never echo bodies or secrets.
      errorName: error instanceof Error ? error.name : typeof error,
      // Server logs only (never sent to the client — see toErrorPayload):
      // the message + stack are what make a production 500 diagnosable
      // from platform logs. Without them a TypeError is just a name.
      ...(error instanceof Error ? { errorMessage: error.message, stack: error.stack } : {}),
    },
    `Request failed: ${appError.code}`
  );

  if (status >= 500 && config.SENTRY_DSN) {
    try {
      Sentry.captureException(error, { extra: { requestId } });
    } catch {
      // Sentry must never break error responses.
    }
  }

  if (res.headersSent) {
    return;
  }
  res.status(status).json(toErrorPayload(appError, requestId));
}
