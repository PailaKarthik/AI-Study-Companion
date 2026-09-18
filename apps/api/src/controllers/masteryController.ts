import type { Request, Response } from "express";
import {
  projectConceptParamsSchema,
  projectIdParamSchema,
  recommendationIdParamSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import {
  completeRecommendation,
  dismissRecommendation,
  getConceptDetail,
  getGrowth,
  listRecommendations,
  refreshRecommendations,
} from "../services/masteryService.js";

/** Thin controllers: auth → validated input → service → envelope. */

export const getGrowthHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getGrowth(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getConceptDetailHandler = [
  requireAuth,
  validateParams(projectConceptParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const params = req.params as { projectId: string; conceptId: string };
    const data = await getConceptDetail(getAuth(req).id, params.projectId, params.conceptId);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listRecommendationsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listRecommendations(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const refreshRecommendationsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await refreshRecommendations(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const completeRecommendationHandler = [
  requireAuth,
  validateParams(recommendationIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await completeRecommendation(
      getAuth(req).id,
      (req.params as { recommendationId: string }).recommendationId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const dismissRecommendationHandler = [
  requireAuth,
  validateParams(recommendationIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await dismissRecommendation(
      getAuth(req).id,
      (req.params as { recommendationId: string }).recommendationId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
