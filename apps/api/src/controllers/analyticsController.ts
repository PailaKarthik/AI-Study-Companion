import type { Request, Response } from "express";
import { projectAnalyticsQuerySchema, projectIdParamSchema } from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateParams, validateQuery } from "../middleware/validate.js";
import { getHomeAnalytics, getProjectAnalytics } from "../services/analyticsService.js";

/** Thin controller: auth → validated input → service → envelope. */

export const getProjectAnalyticsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateQuery(projectAnalyticsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getProjectAnalytics(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId,
      {
        from: req.query.from as Date | undefined,
        to: req.query.to as Date | undefined,
      }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getHomeAnalyticsHandler = [
  requireAuth,
  validateQuery(projectAnalyticsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getHomeAnalytics(getAuth(req).id, {
      from: req.query.from as Date | undefined,
      to: req.query.to as Date | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
