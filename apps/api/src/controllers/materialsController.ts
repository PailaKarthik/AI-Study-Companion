import type { Request, Response } from "express";
import {
  materialIdParamSchema,
  materialImageParamSchema,
  materialUploadQuerySchema,
  paginationSchema,
  projectIdParamSchema,
} from "@ai-study-companion/validation";
import { toSuccess } from "../utils/response.js";
import { getRequestId } from "../middleware/requestId.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { validateParams, validateQuery } from "../middleware/validate.js";
import {
  deleteMaterial,
  downloadMaterial,
  downloadMaterialImage,
  listMaterialImagesById,
  listProjectMaterials,
  reindexMaterialById,
  reprocessMaterialById,
  uploadMaterial,
} from "../services/materialsService.js";

/** Thin controller: auth → validated input → service → envelope. */

function projectIdOf(req: Request): string {
  return (req.params as { projectId: string }).projectId;
}

function materialIdOf(req: Request): string {
  return (req.params as { materialId: string }).materialId;
}

function materialImageOf(req: Request): { materialId: string; imageId: string } {
  const params = req.params as { materialId: string; imageId: string };
  return { materialId: params.materialId, imageId: params.imageId };
}

export const listProjectMaterialsHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateQuery(paginationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listProjectMaterials(
      getAuth(req).id,
      projectIdOf(req),
      req.query.page,
      req.query.pageSize
    );
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const reindexMaterialHandler = [
  requireAuth,
  validateParams(materialIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await reindexMaterialById(getAuth(req).id, materialIdOf(req));
    res.status(202).json(toSuccess(data, getRequestId(req)));
  }),
];

export const reprocessMaterialHandler = [
  requireAuth,
  validateParams(materialIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await reprocessMaterialById(getAuth(req).id, materialIdOf(req));
    res.status(202).json(toSuccess(data, getRequestId(req)));
  }),
];

export const uploadMaterialHandler = [
  requireAuth,
  validateParams(projectIdParamSchema),
  validateQuery(materialUploadQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const bytes = req.body as unknown;
    const data = await uploadMaterial(getAuth(req).id, projectIdOf(req), {
      filename: req.query.filename as string,
      contentType: req.get("content-type") ?? undefined,
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from([]),
    });
    res.status(201).json(toSuccess(data, getRequestId(req)));
  }),
];

export const downloadMaterialHandler = [
  requireAuth,
  validateParams(materialIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const file = await downloadMaterial(getAuth(req).id, materialIdOf(req));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    // Inline so browsers can preview; filename is server-sanitized.
    res.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
    if (file.checksum) {
      res.setHeader("ETag", `"${file.checksum}"`);
    }
    res.status(200).send(file.bytes);
  }),
];

export const deleteMaterialHandler = [
  requireAuth,
  validateParams(materialIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await deleteMaterial(getAuth(req).id, materialIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const listMaterialImagesHandler = [
  requireAuth,
  validateParams(materialIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await listMaterialImagesById(getAuth(req).id, materialIdOf(req));
    res.status(200).json(toSuccess(data, getRequestId(req)));
  }),
];

export const downloadMaterialImageHandler = [
  requireAuth,
  validateParams(materialImageParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { materialId, imageId } = materialImageOf(req);
    const file = await downloadMaterialImage(getAuth(req).id, materialId, imageId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader("Content-Disposition", `inline; filename="page-${file.pageNumber ?? 0}.png"`);
    res.setHeader("ETag", `"${file.checksum}"`);
    res.status(200).send(file.bytes);
  }),
];
