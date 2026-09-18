import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { requestIdSchema } from "@ai-study-companion/validation";

export const REQUEST_ID_HEADER = "x-request-id";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Assigns (or propagates) a request ID for correlation across
 * frontend -> API -> worker -> AI/DB. Returned in response headers
 * and included in every structured log line.
 *
 * Client-supplied IDs are validated against `requestIdSchema` (≤128
 * chars, safe alphabet). Invalid, missing, or oversized values are
 * replaced with a server-generated UUID — never reflected raw — so a
 * malicious `x-request-id` cannot pollute logs or response headers.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = (Array.isArray(incoming) ? incoming[0] : incoming)?.toString().trim();
  const requestId =
    candidate && requestIdSchema.safeParse(candidate).success ? candidate : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(req: Request): string {
  return req.requestId ?? "unknown";
}
