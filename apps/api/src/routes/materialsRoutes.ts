import express, { Router } from "express";
import {
  deleteMaterialHandler,
  downloadMaterialHandler,
  downloadMaterialImageHandler,
  listMaterialImagesHandler,
  listProjectMaterialsHandler,
  reindexMaterialHandler,
  reprocessMaterialHandler,
  uploadMaterialHandler,
} from "../controllers/materialsController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * GET  /api/projects/:projectId/materials  — owned materials + knowledge state
 * POST /api/projects/:projectId/materials  — upload PDF (raw bytes) → 201 + document queued
 * GET  /api/materials/:materialId/file     — download/view bytes (ownership-checked)
 * GET  /api/materials/:materialId/images   — extracted-image metadata (ownership-checked)
 * GET  /api/materials/:materialId/images/:imageId/file — image bytes (ownership-checked)
 * DELETE /api/materials/:materialId        — delete material + stored objects
 * POST /api/materials/:materialId/reprocess — re-run document extraction (202)
 * POST /api/materials/:materialId/reindex  — queue knowledge (re)build (202)
 *
 * Uploads carry raw PDF bytes (`Content-Type: application/pdf`,
 * `?filename=` query) so no multipart parser is needed. File bytes live
 * in Neon Object Storage; image ids address metadata rows, never bucket
 * keys. Reprocess and reindex share the search limiter: both trigger
 * worker/AI work.
 */
export function createMaterialsRouter(): Router {
  const router: Router = Router();

  const expensiveLimiter = createRateLimiter({
    windowMs: config.SEARCH_RATE_LIMIT_WINDOW_MS,
    max: config.SEARCH_RATE_LIMIT_MAX,
    namespace: "materials",
  });

  // Raw PDF body, capped just above the service ceiling so oversized
  // files get the service's controlled 400 (not a bare parser error).
  const pdfBody = express.raw({
    type: ["application/pdf", "application/octet-stream"],
    limit: config.STORAGE_MAX_UPLOAD_BYTES + 1024 * 1024,
  });

  router.get("/api/projects/:projectId/materials", ...listProjectMaterialsHandler);
  router.post(
    "/api/projects/:projectId/materials",
    expensiveLimiter,
    pdfBody,
    ...uploadMaterialHandler
  );
  router.get("/api/materials/:materialId/file", ...downloadMaterialHandler);
  router.get("/api/materials/:materialId/images", ...listMaterialImagesHandler);
  router.get("/api/materials/:materialId/images/:imageId/file", ...downloadMaterialImageHandler);
  router.delete("/api/materials/:materialId", ...deleteMaterialHandler);
  router.post(
    "/api/materials/:materialId/reprocess",
    expensiveLimiter,
    ...reprocessMaterialHandler
  );
  router.post("/api/materials/:materialId/reindex", expensiveLimiter, ...reindexMaterialHandler);

  return router;
}
