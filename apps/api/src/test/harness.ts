import cookieParser from "cookie-parser";
import express, { Router, type Express, type Router as ExpressRouter } from "express";
import { errorHandler, notFoundHandler } from "../middleware/errorHandler.js";
import { requestIdMiddleware } from "../middleware/requestId.js";

/**
 * Minimal HTTP harness for test-only routes.
 *
 * Some middleware (requireAdmin, requireSpaceOwner, requireProjectAccess)
 * has no shipped feature endpoint yet in this stage. Instead of bolting
 * test routes onto the production app factory (after its 404 handler —
 * which would shadow them), tests mount the REAL middleware on this
 * harness. Auth flows (register/login) always go through the real
 * createApp() instance.
 */
export function buildTestHarness(mount: (router: ExpressRouter) => void): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  const router = Router();
  mount(router);
  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
