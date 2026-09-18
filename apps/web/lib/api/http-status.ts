import { ApiClientError } from "./client";

/** True for API 401s (session missing/expired) regardless of error code. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

/** True for API 403s (authenticated but not permitted). */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
}

export interface ErrorStateContent {
  title: string;
  message: string;
}

/**
 * Maps HTTP status to safe, user-facing error content. Never exposes
 * internals — 500s get a generic message plus the request ID for support.
 */
export function errorStateForStatus(status: number | undefined): ErrorStateContent {
  switch (status) {
    case 401:
      return {
        title: "Authentication required",
        message: "Please log in to continue.",
      };
    case 403:
      return {
        title: "Not permitted",
        message: "You don't have permission to view this.",
      };
    case 404:
      return {
        title: "Not found",
        message: "This doesn't exist or you don't have access to it.",
      };
    case 429:
      return {
        title: "Too many requests",
        message: "Please wait a moment and try again.",
      };
    default:
      return {
        title: "Something went wrong",
        message: "Please try again. If it keeps happening, contact support.",
      };
  }
}

/** Extracts the HTTP status from an API error, if it is one. */
export function statusOf(error: unknown): number | undefined {
  return error instanceof ApiClientError ? error.status : undefined;
}
