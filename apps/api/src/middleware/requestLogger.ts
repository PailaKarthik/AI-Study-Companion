import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";
import { getRequestId } from "./requestId.js";

/**
 * Structured request logging.
 * Emits: timestamp, level, service, requestId, method, route, status, duration.
 * Never logs bodies, API keys or tokens.
 */
export const requestLogger: RequestHandler = pinoHttp({
  logger,
  customProps: (req: Request) => ({
    requestId: getRequestId(req),
  }),
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} -> ${res.statusCode}`,
  customErrorMessage: (req, res, error) =>
    `${req.method} ${req.url} -> ${res.statusCode}: ${error.message}`,
});

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  requestLogger(req, res, next);
}
