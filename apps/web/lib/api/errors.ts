import { ApiClientError } from "./client";

export { ApiClientError };

/** Human-readable message for any thrown API error. Never leaks internals. */
export function toUserMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

/** True for errors worth retrying (network/5xx/rate-limit), false for 4xx. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    if (error.status === 429) return true;
    return error.status >= 500;
  }
  return false;
}

/** Support-debug request id for an API error, if it carries one. */
export function requestIdOf(error: unknown): string | undefined {
  return error instanceof ApiClientError ? error.requestId : undefined;
}
