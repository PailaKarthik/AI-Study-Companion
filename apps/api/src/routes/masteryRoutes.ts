import { Router } from "express";
import {
  completeRecommendationHandler,
  dismissRecommendationHandler,
  getConceptDetailHandler,
  getGrowthHandler,
  listRecommendationsHandler,
  refreshRecommendationsHandler,
} from "../controllers/masteryController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * GET  /api/projects/:projectId/growth — project growth board (mastery +
 *   trends + buckets, all project-scoped).
 * GET  /api/projects/:projectId/concepts/:conceptId — concept detail
 *   (mastery, trend, history, evidence, mistakes, recommendations).
 * GET  /api/projects/:projectId/recommendations — pending, ranked.
 * POST /api/projects/:projectId/recommendations/refresh — deterministic
 *   rebuild (expire stale, complete achieved, dedupe, persist).
 * POST /api/recommendations/:recommendationId/complete — learner action.
 * POST /api/recommendations/:recommendationId/dismiss — learner action.
 *
 * Reads and lifecycle actions share one generous limiter: no LLM calls,
 * no fan-out — just bounded indexed queries.
 */
export function createMasteryRouter(): Router {
  const router: Router = Router();

  const masteryLimiter = createRateLimiter({
    windowMs: config.MASTERY_RATE_LIMIT_WINDOW_MS,
    max: config.MASTERY_RATE_LIMIT_MAX,
    namespace: "mastery",
  });

  router.get("/api/projects/:projectId/growth", masteryLimiter, ...getGrowthHandler);
  router.get(
    "/api/projects/:projectId/concepts/:conceptId",
    masteryLimiter,
    ...getConceptDetailHandler
  );
  router.get(
    "/api/projects/:projectId/recommendations",
    masteryLimiter,
    ...listRecommendationsHandler
  );
  router.post(
    "/api/projects/:projectId/recommendations/refresh",
    masteryLimiter,
    ...refreshRecommendationsHandler
  );
  router.post(
    "/api/recommendations/:recommendationId/complete",
    masteryLimiter,
    ...completeRecommendationHandler
  );
  router.post(
    "/api/recommendations/:recommendationId/dismiss",
    masteryLimiter,
    ...dismissRecommendationHandler
  );

  return router;
}
