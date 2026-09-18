import { Router } from "express";
import type { AuthRouterOptions } from "./authRoutes.js";
import { createAdminRouter } from "./adminRoutes.js";
import { createAuthRouter } from "./authRoutes.js";
import { healthRouter } from "./healthRoutes.js";
import { createHomeRouter } from "./homeRoutes.js";
import { createMaterialsRouter } from "./materialsRoutes.js";
import { createProjectsRouter } from "./projectsRoutes.js";
import { createSearchRouter } from "./searchRoutes.js";
import { createSpacesRouter } from "./spacesRoutes.js";
import { createQuizRouter } from "./quizRoutes.js";
import { createMasteryRouter } from "./masteryRoutes.js";
import { createTutorRouter } from "./tutorRoutes.js";

export function createApiRouter(options: AuthRouterOptions = {}): Router {
  const router = Router();
  // Health/readiness are mounted at root (GET /health, GET /ready).
  router.use(healthRouter);
  // Auth namespace (prompt contract): /api/auth/*.
  router.use("/api/auth", createAuthRouter(options));
  // Spaces + home namespaces.
  router.use("/api/spaces", createSpacesRouter());
  router.use("/api/home", createHomeRouter());
  // Projects router carries full paths (nested + flat + overview).
  router.use(createProjectsRouter());
  // Search + materials routers carry full paths (project-scoped retrieval).
  router.use(createSearchRouter());
  router.use(createMaterialsRouter());
  // Tutor router carries full paths (project-scoped RAG chat).
  router.use(createTutorRouter());
  // Quiz router carries full paths (adaptive assessment).
  router.use(createQuizRouter());
  // Mastery router carries full paths (growth, concepts, recommendations).
  router.use(createMasteryRouter());
  // Admin router carries full paths (all routes require ADMIN role).
  router.use(createAdminRouter());
  return router;
}
