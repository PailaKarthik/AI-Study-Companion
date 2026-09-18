import type { Request, Response } from "express";
import {
  adminActivityQuerySchema,
  adminAIEvaluationsQuerySchema,
  adminAIUsageQuerySchema,
  adminIdParamSchema,
  adminJobsQuerySchema,
  adminProjectsQuerySchema,
  adminSpacesQuerySchema,
  adminUsersQuerySchema,
  dateRangeSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdmin } from "../middleware/auth.js";
import { validateParams, validateQuery } from "../middleware/validate.js";
import {
  getAdminLearning,
  getAdminOverview,
  getAdminSystemHealth,
  getAdminUser,
  listAdminActivity,
  listAdminAIEvaluations,
  listAdminAIUsage,
  listAdminJobs,
  listAdminProjects,
  listAdminSpaces,
  listAdminUsers,
} from "../services/adminService.js";

/**
 * Thin controllers: requireAdmin → validated input → service → envelope.
 * Every route here returns 403 FORBIDDEN for non-admins (tested).
 */

function queryOf(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export const getAdminOverviewHandler = [
  ...requireAdmin,
  validateQuery(dateRangeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await getAdminOverview({
      from: q.from as Date | undefined,
      to: q.to as Date | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminUsersHandler = [
  ...requireAdmin,
  validateQuery(adminUsersQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminUsers({
      page: q.page,
      pageSize: q.pageSize,
      q: q.q as string | undefined,
      role: q.role as "USER" | "ADMIN" | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getAdminUserHandler = [
  ...requireAdmin,
  validateParams(adminIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getAdminUser((req.params as { userId: string }).userId);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminSpacesHandler = [
  ...requireAdmin,
  validateQuery(adminSpacesQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminSpaces({
      page: q.page,
      pageSize: q.pageSize,
      q: q.q as string | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminProjectsHandler = [
  ...requireAdmin,
  validateQuery(adminProjectsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminProjects({
      page: q.page,
      pageSize: q.pageSize,
      q: q.q as string | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminActivityHandler = [
  ...requireAdmin,
  validateQuery(adminActivityQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminActivity({
      page: q.page,
      pageSize: q.pageSize,
      from: q.from as Date | undefined,
      to: q.to as Date | undefined,
      userId: q.userId as string | undefined,
      eventType: q.eventType as string | undefined,
      spaceId: q.spaceId as string | undefined,
      projectId: q.projectId as string | undefined,
      sort: (q.sort as "asc" | "desc" | undefined) ?? "desc",
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getAdminLearningHandler = [
  ...requireAdmin,
  validateQuery(dateRangeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await getAdminLearning({
      from: q.from as Date | undefined,
      to: q.to as Date | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminAIUsageHandler = [
  ...requireAdmin,
  validateQuery(adminAIUsageQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminAIUsage({
      page: q.page,
      pageSize: q.pageSize,
      from: q.from as Date | undefined,
      to: q.to as Date | undefined,
      feature: q.feature as
        | "TUTOR"
        | "QUIZ_GENERATION"
        | "ASSESSMENT"
        | "RECOMMENDATION"
        | "EMBEDDING"
        | "DOCUMENT_UNDERSTANDING"
        | "EVALUATION"
        | undefined,
      provider: q.provider as "GROQ" | "GEMINI" | "SYSTEM" | undefined,
      status: q.status as "SUCCESS" | "FAILED" | "TIMEOUT" | undefined,
      sort: (q.sort as "asc" | "desc" | undefined) ?? "desc",
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminAIEvaluationsHandler = [
  ...requireAdmin,
  validateQuery(adminAIEvaluationsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminAIEvaluations({
      page: q.page,
      pageSize: q.pageSize,
      feature: q.feature as
        | "TUTOR"
        | "QUIZ_GENERATION"
        | "ASSESSMENT"
        | "RECOMMENDATION"
        | "EMBEDDING"
        | "DOCUMENT_UNDERSTANDING"
        | "EVALUATION"
        | undefined,
      sort: (q.sort as "asc" | "desc" | undefined) ?? "desc",
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listAdminJobsHandler = [
  ...requireAdmin,
  validateQuery(adminJobsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = queryOf(req);
    const data = await listAdminJobs({
      page: q.page,
      pageSize: q.pageSize,
      from: q.from as Date | undefined,
      to: q.to as Date | undefined,
      type: q.type as "TEXT_EXTRACTION" | "CHUNKING" | "EMBEDDING" | "FULL_INGEST" | undefined,
      status: q.status as "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | undefined,
      sort: (q.sort as "asc" | "desc" | undefined) ?? "desc",
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getAdminSystemHealthHandler = [
  ...requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const data = await getAdminSystemHealth();
    res.status(200).json(toSuccess(data, getRequestId(_req)));
  }),
];
