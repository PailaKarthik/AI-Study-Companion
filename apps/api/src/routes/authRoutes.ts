import { Router } from "express";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
} from "../controllers/authController.js";
import { createAuthLimiter } from "../middleware/rateLimit.js";

export interface AuthRouterOptions {
  registerMax?: number;
  loginMax?: number;
}

/**
 * POST /api/auth/register — rate-limited, validated, sets session cookie.
 * POST /api/auth/login    — rate-limited, generic 401s, sets session cookie.
 * POST /api/auth/logout   — revokes session, clears cookie (always 200).
 * GET  /api/auth/me       — requires valid session, returns safe user only.
 */
export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const router: Router = Router();

  router.post("/register", createAuthLimiter("register", options.registerMax), ...registerHandler);
  router.post("/login", createAuthLimiter("login", options.loginMax), ...loginHandler);
  router.post("/logout", ...[logoutHandler]);
  router.get("/me", ...meHandler);

  return router;
}
