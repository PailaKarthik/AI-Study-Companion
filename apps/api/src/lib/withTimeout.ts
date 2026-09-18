import { AppError } from "../errors/AppError.js";

/**
 * Race a promise against a timeout. The loser is abandoned (its side
 * effects, if any, still settle) — callers must only use this where a
 * late success is harmless (idempotent enqueues) or compensated
 * (see materialsService.reindexMaterial).
 *
 * On timeout throws AppError SERVICE_UNAVAILABLE so the error boundary
 * renders a controlled 503, never a hang.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AppError("SERVICE_UNAVAILABLE", `${operation} timed out; try again shortly.`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
