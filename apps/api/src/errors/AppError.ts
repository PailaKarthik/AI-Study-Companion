import type { ApiErrorCode } from "@ai-study-companion/config";

/** HTTP status mapped from each application error code. */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly isOperational: boolean;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.isOperational = true;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: unknown) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: unknown) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super("INTERNAL_ERROR", message);
    this.name = "InternalError";
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError("INTERNAL_ERROR", "An unexpected error occurred");
  }
  return new InternalError();
}

/** JSON-safe error payload. Never includes stack traces. */
export function toErrorPayload(error: AppError, requestId: string) {
  return {
    success: false as const,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
    requestId,
  };
}
