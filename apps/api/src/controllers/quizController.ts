import type { Request, Response } from "express";
import {
  attemptIdParamSchema,
  createQuizSchema,
  projectIdParamSchema,
  quizIdParamSchema,
  startAttemptSchema,
  submitResponseSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  completeAttempt,
  createQuiz,
  getAttempt,
  getQuiz,
  listConcepts,
  listQuizzes,
  startAttempt,
  submitResponse,
} from "../services/quizService.js";

/** Thin controllers: auth → validated input → service → envelope. */

export const createQuizHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateBody(createQuizSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await createQuiz(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId,
      {
        title: req.body.title as string | undefined,
        description: req.body.description as string | undefined,
        questionCount: req.body.questionCount as number,
        mode: req.body.mode,
        typePreference: req.body.typePreference,
        difficulty: req.body.difficulty,
        conceptIds: req.body.conceptIds as string[] | undefined,
      },
      { requestId: getRequestId(req) }
    );
    res.status(201).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listQuizzesHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listQuizzes(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listConceptsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listConcepts(
      getAuth(req).id,
      (req.params as { projectId: string }).projectId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getQuizHandler = [
  requireAuth,
  validateParams(quizIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getQuiz(
      getAuth(req).id,
      (req.params as { quizId: string }).quizId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const startAttemptHandler = [
  requireAuth,
  validateParams(quizIdParamSchema),
  validateBody(startAttemptSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await startAttempt(
      getAuth(req).id,
      (req.params as { quizId: string }).quizId,
      {
        restart: req.body.restart as boolean | undefined,
        idempotencyKey: req.body.idempotencyKey as string | undefined,
      },
      { requestId: getRequestId(req) }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getAttemptHandler = [
  requireAuth,
  validateParams(attemptIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getAttempt(
      getAuth(req).id,
      (req.params as { attemptId: string }).attemptId
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const submitResponseHandler = [
  requireAuth,
  validateParams(attemptIdParamSchema),
  validateBody(submitResponseSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await submitResponse(
      getAuth(req).id,
      (req.params as { attemptId: string }).attemptId,
      {
        questionId: req.body.questionId as string,
        selectedOption: req.body.selectedOption as string | undefined,
        responseText: req.body.responseText as string | undefined,
      },
      { requestId: getRequestId(req) }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const completeAttemptHandler = [
  requireAuth,
  validateParams(attemptIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await completeAttempt(
      getAuth(req).id,
      (req.params as { attemptId: string }).attemptId,
      { requestId: getRequestId(req) }
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
