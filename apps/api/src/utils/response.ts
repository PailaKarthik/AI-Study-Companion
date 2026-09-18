/** Small pure helpers shared across the API. */

export function toSuccess<T>(data: T, requestId: string) {
  return { success: true as const, data, requestId };
}
