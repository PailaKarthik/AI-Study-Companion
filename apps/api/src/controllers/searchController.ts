import type { Request, Response } from "express";
import { projectIdParamSchema, searchRequestSchema } from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { searchProject } from "../services/searchService.js";

/** Thin controller: auth → validated input → service → envelope. */

export const searchProjectHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateBody(searchRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await searchProject(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId,
      req.body.query as string,
      {
        limit: req.body.limit as number | undefined,
        materialId: req.body.materialId as string | undefined,
      }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
