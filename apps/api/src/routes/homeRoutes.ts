import { Router } from "express";
import { getHomeHandler } from "../controllers/homeController.js";
import { getHomeAnalyticsHandler } from "../controllers/analyticsController.js";

/**
 * GET /api/home — aggregated dashboard for the authenticated user.
 * GET /api/home/analytics — focused user-level trend analytics (?from&to, UTC).
 */
export function createHomeRouter(): Router {
  const router: Router = Router();

  router.get("/", ...getHomeHandler);
  router.get("/analytics", ...getHomeAnalyticsHandler);

  return router;
}
