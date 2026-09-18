import type { HealthResponse, ReadinessResponse } from "@ai-study-companion/shared";

export type { HealthResponse, ReadinessResponse };

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  requestId: string;
}
