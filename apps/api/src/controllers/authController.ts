import type { Request, Response } from "express";
import { loginSchema, registerSchema } from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  authenticateUser,
  getCurrentUser,
  registerUser,
  revokeSession,
  sessionCookieName,
} from "../services/authService.js";

function deviceFrom(req: Request) {
  const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    userAgent: req.get("user-agent"),
    ipAddress: forwarded ?? req.ip,
  };
}

export const registerHandler = [
  validateBody(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await registerUser(req.body, deviceFrom(req));
    setSessionCookie(res, result.sessionToken);
    res.status(201).json(toSuccess(result.user, getRequestId(req)));
  }),
];

export const loginHandler = [
  validateBody(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await authenticateUser(req.body, deviceFrom(req));
    setSessionCookie(res, result.sessionToken);
    res.status(200).json(toSuccess(result.user, getRequestId(req)));
  }),
];

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  await revokeSession(req.cookies?.[sessionCookieName()]);
  clearSessionCookie(res);
  res.status(200).json(toSuccess({ loggedOut: true }, getRequestId(req)));
});

export const meHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await getCurrentUser(getAuth(req).id);
    res.status(200).json(toSuccess(user, getRequestId(req)));
  }),
];
