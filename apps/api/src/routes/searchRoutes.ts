import { Router } from "express";
import { searchProjectHandler } from "../controllers/searchController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * POST /api/projects/:projectId/search — project-scoped hybrid retrieval.
 * Dedicated limiter: each call can trigger one Gemini query-embedding.
 */
export function createSearchRouter(): Router {
  const router: Router = Router();

  const searchLimiter = createRateLimiter({
    windowMs: config.SEARCH_RATE_LIMIT_WINDOW_MS,
    max: config.SEARCH_RATE_LIMIT_MAX,
    namespace: "search",
  });

  router.post("/api/projects/:projectId/search", searchLimiter, ...searchProjectHandler);

  return router;
}
