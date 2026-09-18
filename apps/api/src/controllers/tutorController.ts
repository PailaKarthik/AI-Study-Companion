import type { Request, Response } from "express";
import {
  projectConversationParamsSchema,
  projectIdParamSchema,
  tutorAskSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { askTutor, getConversation, listConversations } from "../services/tutorService.js";

/** Thin controllers: auth → validated input → service → envelope. */

export const askTutorHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateBody(tutorAskSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await askTutor(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId,
      {
        message: req.body.message as string,
        conversationId: req.body.conversationId as string | undefined,
      },
      { requestId: getRequestId(req) }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listConversationsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listConversations(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getConversationHandler = [
  requireAuth,
  validateParams(projectConversationParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Project scope comes from the owned conversation itself: the service
    // returns 404 unless the conversation sits in an owned project, so a
    // forged projectId can never leak another user's thread.
    const data = await getConversation(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId,
      (req.params as { conversationId: string }).conversationId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
