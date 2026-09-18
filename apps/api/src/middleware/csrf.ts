import type { NextFunction, Request, Response } from "express";
import { config } from "../config/index.js";
import { ForbiddenError } from "../errors/AppError.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense-in-depth.
 *
 * Primary defense: SameSite=Lax (default) session cookies — browsers refuse
 * to attach them to cross-site fetch/POST requests, which is exactly how
 * CSRF against a same-site API (web on WEB_URL, API on API_URL) works.
 * Top-level navigational GETs carry no state-changing routes here.
 *
 * This middleware adds origin validation for state-changing requests that
 * DO present an Origin/Referer (i.e. browser-issued requests): the origin
 * must match the request host or the configured web/API origins.
 * Non-browser clients (curl, mobile) send no Origin and pass through —
 * authentication still requires the httpOnly session cookie.
 *
 * Rationale documented in docs/SECURITY.md.
 */
export function csrfOriginCheck(req: Request, _res: Response, next: NextFunction): void {
  if (!STATE_CHANGING.has(req.method)) {
    next();
    return;
  }
  const originHeader = req.get("origin") ?? req.get("referer");
  if (!originHeader) {
    next();
    return;
  }
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new ForbiddenError("Invalid request origin");
  }
  const allowed = new Set<string>();
  for (const value of [config.WEB_URL, config.API_URL, config.API_CORS_ORIGIN]) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        allowed.add(new URL(trimmed).origin);
      } catch {
        // Ignore malformed config fragments; startup validation owns that.
      }
    }
  }
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (origin.origin !== requestOrigin && !allowed.has(origin.origin)) {
    throw new ForbiddenError("Invalid request origin");
  }
  next();
}
