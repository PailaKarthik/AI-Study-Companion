import { Router } from "express";
import {
  getAdminLearningHandler,
  getAdminOverviewHandler,
  getAdminSystemHealthHandler,
  getAdminUserHandler,
  listAdminActivityHandler,
  listAdminAIEvaluationsHandler,
  listAdminAIUsageHandler,
  listAdminJobsHandler,
  listAdminProjectsHandler,
  listAdminSpacesHandler,
  listAdminUsersHandler,
} from "../controllers/adminController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * Admin namespace (all routes require ADMIN role — 403 otherwise):
 * GET /api/admin/overview — system-wide counts + AI + jobs
 * GET /api/admin/users — paginated, searchable user ledger (no secrets)
 * GET /api/admin/users/:userId — single-user learning journey
 * GET /api/admin/spaces — paginated spaces + owners
 * GET /api/admin/projects — paginated projects + owners
 * GET /api/admin/activity — filtered, sortable, paginated event stream
 * GET /api/admin/learning — system learning analytics
 * GET /api/admin/ai-usage — filtered, paginated AI call ledger
 * GET /api/admin/ai-evaluations — paginated quality evaluations
 * GET /api/admin/jobs — persisted background-job explorer
 * GET /api/admin/system-health — lightweight service checks (no secrets)
 */
export function createAdminRouter(): Router {
  const router: Router = Router();

  const adminLimiter = createRateLimiter({
    windowMs: config.ADMIN_RATE_LIMIT_WINDOW_MS,
    max: config.ADMIN_RATE_LIMIT_MAX,
    namespace: "admin",
  });
  router.use(adminLimiter);

  router.get("/api/admin/overview", ...getAdminOverviewHandler);
  router.get("/api/admin/users", ...listAdminUsersHandler);
  router.get("/api/admin/users/:userId", ...getAdminUserHandler);
  router.get("/api/admin/spaces", ...listAdminSpacesHandler);
  router.get("/api/admin/projects", ...listAdminProjectsHandler);
  router.get("/api/admin/activity", ...listAdminActivityHandler);
  router.get("/api/admin/learning", ...getAdminLearningHandler);
  router.get("/api/admin/ai-usage", ...listAdminAIUsageHandler);
  router.get("/api/admin/ai-evaluations", ...listAdminAIEvaluationsHandler);
  router.get("/api/admin/jobs", ...listAdminJobsHandler);
  router.get("/api/admin/system-health", ...getAdminSystemHealthHandler);

  return router;
}
