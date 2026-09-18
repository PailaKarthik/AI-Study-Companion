import { Router } from "express";
import {
  countProjectsHandler,
  createProjectHandler,
  deleteProjectHandler,
  getProjectHandler,
  getProjectOverviewHandler,
  listProjectsHandler,
  updateProjectHandler,
} from "../controllers/projectsController.js";
import { getProjectAnalyticsHandler } from "../controllers/analyticsController.js";

/**
 * GET    /api/spaces/:spaceId/projects — projects of one owned space
 * GET    /api/spaces/:spaceId/projects/counts — real per-status counts
 * POST   /api/spaces/:spaceId/projects — create inside an owned space (201)
 * GET    /api/projects/:projectId         — detail (404 covers foreign)
 * PATCH  /api/projects/:projectId         — allowed fields only
 * DELETE /api/projects/:projectId         — permanent, cascades per schema
 * GET    /api/projects/:projectId/overview — lightweight dashboard aggregate
 * GET    /api/projects/:projectId/analytics — real aggregates, ?from&to (UTC)
 */
export function createProjectsRouter(): Router {
  const router: Router = Router();

  router.get("/api/spaces/:spaceId/projects", ...listProjectsHandler);
  router.get("/api/spaces/:spaceId/projects/counts", ...countProjectsHandler);
  router.post("/api/spaces/:spaceId/projects", ...createProjectHandler);
  router.get("/api/projects/:projectId", ...getProjectHandler);
  router.patch("/api/projects/:projectId", ...updateProjectHandler);
  router.delete("/api/projects/:projectId", ...deleteProjectHandler);
  router.get("/api/projects/:projectId/overview", ...getProjectOverviewHandler);
  router.get("/api/projects/:projectId/analytics", ...getProjectAnalyticsHandler);

  return router;
}
