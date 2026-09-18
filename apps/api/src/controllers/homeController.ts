import type { Request, Response } from "express";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { getHomeData } from "../services/homeService.js";

/** Thin controller: auth → service → envelope. */
export const getHomeHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getHomeData(getAuth(req).id);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
