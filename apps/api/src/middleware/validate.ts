import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ValidationError } from "../errors/AppError.js";
import { formatZodError } from "@ai-study-companion/validation";

/**
 * Zod validation for body / params / query. Rejects unknown keys where the
 * schema is strict and always returns the centralized VALIDATION_ERROR
 * envelope — never trusts client input.
 */
function validate<T>(schema: ZodSchema<T>, data: unknown, source: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${source}`, formatZodError(parsed.error));
  }
  return parsed.data;
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = validate(schema, req.body, "request body");
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated = validate(schema, req.params, "route parameters");
    req.params = validated as unknown as Request["params"];
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const validated = validate(schema, req.query, "query parameters");
    req.query = validated as unknown as Request["query"];
    next();
  };
}
