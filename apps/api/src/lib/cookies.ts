import type { Response } from "express";
import { config, isCookieSecure, sessionTtlMs } from "../config/index.js";

function baseCookie() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: config.SESSION_SAMESITE as "lax" | "strict" | "none",
    path: "/",
  };
}

/** Set the session cookie after register/login. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.SESSION_COOKIE_NAME, token, {
    ...baseCookie(),
    maxAge: sessionTtlMs(),
  });
}

/** Clear the session cookie on logout (same attributes, expired). */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.SESSION_COOKIE_NAME, baseCookie());
}
