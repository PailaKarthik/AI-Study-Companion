import type { NextFunction, Request, Response } from "express";
import type { CurrentUser } from "@ai-study-companion/shared";
import { ForbiddenError, UnauthenticatedError } from "../errors/AppError.js";
import { asyncHandler } from "./errorHandler.js";
import { sessionCookieName, validateSessionToken } from "../services/authService.js";

/**
 * Authenticated request context. Handlers for protected routes type their
 * `req` as AuthenticatedRequest — no `as any` anywhere in the codebase.
 */
export interface AuthenticatedUser extends CurrentUser {}

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedUser;
  sessionId: string;
}

const AUTH_KEY = "auth";

/** Read the typed auth context. Throws 401 when absent (defense in depth). */
export function getAuth(req: Request): AuthenticatedUser {
  const auth = (req as Partial<AuthenticatedRequest>)[AUTH_KEY];
  if (!auth) {
    throw new UnauthenticatedError();
  }
  return auth;
}

/** Read the current session id (server-side only, never sent to clients). */
export function getSessionId(req: Request): string {
  const sessionId = (req as Partial<AuthenticatedRequest>).sessionId;
  if (!sessionId) {
    throw new UnauthenticatedError();
  }
  return sessionId;
}

/**
 * requireAuth: cookie → session validation → expiry/active checks →
 * fresh user attached as req.auth. Rejects with 401 otherwise.
 */
export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token: string | undefined = req.cookies?.[sessionCookieName()];
    const { user, sessionId } = await validateSessionToken(token);
    (req as AuthenticatedRequest).auth = user;
    (req as AuthenticatedRequest).sessionId = sessionId;
    next();
  }
);

/** requireAdmin: requireAuth + server-verified role === ADMIN. */
export const requireAdmin = [
  requireAuth,
  (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (auth.role !== "ADMIN") {
      throw new ForbiddenError("Administrator access required");
    }
    next();
  },
];
