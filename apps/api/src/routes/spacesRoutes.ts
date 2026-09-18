import { Router } from "express";
import {
  createSpaceHandler,
  deleteSpaceHandler,
  getSpaceHandler,
  listSpacesHandler,
  updateSpaceHandler,
} from "../controllers/spacesController.js";

/**
 * GET    /api/spaces          — owned spaces, paginated, searchable
 * POST   /api/spaces          — create (201)
 * GET    /api/spaces/:spaceId — detail + project count (404 covers foreign)
 * PATCH  /api/spaces/:spaceId — allowed fields only, ownership immutable
 * DELETE /api/spaces/:spaceId — permanent, cascades per schema design
 */
export function createSpacesRouter(): Router {
  const router: Router = Router();

  router.get("/", ...listSpacesHandler);
  router.post("/", ...createSpaceHandler);
  router.get("/:spaceId", ...getSpaceHandler);
  router.patch("/:spaceId", ...updateSpaceHandler);
  router.delete("/:spaceId", ...deleteSpaceHandler);

  return router;
}
