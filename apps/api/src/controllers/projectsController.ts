import type { Request, Response } from "express";
import {
  createProjectSchema,
  projectIdParamSchema,
  projectListQuerySchema,
  spaceIdParamSchema,
  updateProjectSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  countProjectsByStatus,
  createProject,
  deleteProject,
  getProject,
  getProjectOverview,
  listProjects,
  updateProject,
} from "../services/projectsService.js";

/** Thin controller: auth → validated input → service → envelope. */

function spaceIdOf(req: Request): string {
  return (req.params as { spaceId: string }).spaceId;
}

function projectIdOf(req: Request): string {
  return (req.params as { projectId: string }).projectId;
}

export const listProjectsHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  validateQuery(projectListQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listProjects(getAuth(req).id, spaceIdOf(req), {
      page: req.query.page,
      pageSize: req.query.pageSize,
      q: req.query.q as string | undefined,
      status: req.query.status as "ACTIVE" | "ARCHIVED" | "COMPLETED" | undefined,
    });
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const countProjectsHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await countProjectsByStatus(getAuth(req).id, spaceIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const createProjectHandler = [
  requireAuth,
  validateParams(spaceIdParamSchema),
  validateBody(createProjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await createProject(getAuth(req).id, spaceIdOf(req), req.body);
    res.status(201).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getProjectHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getProject(getAuth(req).id, projectIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const updateProjectHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateBody(updateProjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await updateProject(getAuth(req).id, projectIdOf(req), req.body);
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const deleteProjectHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await deleteProject(getAuth(req).id, projectIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const getProjectOverviewHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await getProjectOverview(getAuth(req).id, projectIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];
