import type { Request, Response } from "express";
import {
  createSpaceSchema,
  spaceIdParamSchema,
  spaceListQuerySchema,
  updateSpaceSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  createSpace,
  deleteSpace,
  getSpace,
  listSpaces,
  updateSpace,
} from "../services/spacesService.js";

/** Thin controller: auth → validated input → service → envelope. */

export const listSpacesHandler = [
  requireAuth,
  validateQuery(spaceListQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listSpaces(getAuth(req).id, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      q: req.query.q as string | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const createSpaceHandler = [
  requireAuth,
  validateBody(createSpaceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await createSpace(getAuth(req).id, req.body);
    res.status(201).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getSpaceHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getSpace(getAuth(req).id, (req.params as { spaceId: string }).spaceId);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const updateSpaceHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  validateBody(updateSpaceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await updateSpace(
      getAuth(req).id,
      (req.params as { spaceId: string }).spaceId,
      req.body
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const deleteSpaceHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await deleteSpace(getAuth(req).id, (req.params as { spaceId: string }).spaceId);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
