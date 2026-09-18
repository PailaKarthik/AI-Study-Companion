import type { NextFunction, Request, Response } from "express";
import { uuidSchema } from "@ai-study-companion/validation";
import { NotFoundError } from "../errors/AppError.js";
import type { OwnedProject, OwnedSpace } from "../services/accessService.js";
import {
  assertProjectAccess,
  getOwnedProjectOrThrow,
  getOwnedSpaceOrThrow,
} from "../services/accessService.js";
import { asyncHandler } from "./errorHandler.js";
import { getAuth } from "./auth.js";

export interface SpaceRequest extends Request {
  auth: import("./auth.js").AuthenticatedUser;
  ownedSpace: OwnedSpace;
}

export interface ProjectRequest extends Request {
  auth: import("./auth.js").AuthenticatedUser;
  ownedProject: OwnedProject;
}

function parseUuidParam(req: Request, param: string): string {
  const raw = req.params[param];
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    // Treat malformed ids as "not found" — same observable as a miss.
    throw new NotFoundError("Resource not found");
  }
  return parsed.data;
}

/**
 * requireSpaceOwner: verifies the :spaceId route param belongs to the
 * authenticated user and attaches it as req.ownedSpace.
 */
export function requireSpaceOwner(param = "spaceId") {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const space = await getOwnedSpaceOrThrow(getAuth(req).id, parseUuidParam(req, param));
    (req as SpaceRequest).ownedSpace = space;
    next();
  });
}

/**
 * requireProjectAccess: verifies the :projectId route param belongs to the
 * authenticated user (optionally chained inside an owned space) and
 * attaches it as req.ownedProject.
 */
export function requireProjectAccess(options?: { param?: string; spaceParam?: string }) {
  const param = options?.param ?? "projectId";
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const userId = getAuth(req).id;
    const projectId = parseUuidParam(req, param);
    const project = options?.spaceParam
      ? await assertProjectAccess(userId, parseUuidParam(req, options.spaceParam), projectId)
      : await getOwnedProjectOrThrow(userId, projectId);
    (req as ProjectRequest).ownedProject = project;
    next();
  });
}
