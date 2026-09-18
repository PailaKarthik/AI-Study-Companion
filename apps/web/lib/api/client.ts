/**
 * Central API client for the web app.
 * UI components must use this (via TanStack Query hooks) — never raw fetch().
 *
 * Features:
 * - base URL from NEXT_PUBLIC_API_URL
 * - JSON requests/responses
 * - error parsing into ApiClientError
 * - AbortController / request cancellation
 * - request-ID propagation (x-request-id)
 * - credentials: include (cookie sessions, future auth)
 */

export const REQUEST_ID_HEADER = "x-request-id";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly details?: unknown;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    requestId: string;
    details?: unknown;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  signal?: AbortSignal;
  requestId?: string;
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return url.replace(/\/$/, "");
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ data: T; requestId: string }> {
  const { body, requestId = newRequestId(), headers, signal, ...rest } = options;

  const res = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    signal,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [REQUEST_ID_HEADER]: requestId,
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseRequestId =
    res.headers.get(REQUEST_ID_HEADER) ?? requestId;

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const envelope = json as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiClientError({
      code: envelope?.error?.code ?? "INTERNAL_ERROR",
      message: envelope?.error?.message ?? `Request failed with status ${res.status}`,
      status: res.status,
      requestId: responseRequestId,
      details: envelope?.error?.details,
    });
  }

  const envelope = json as { data?: T } | null;
  return {
    data: (envelope?.data ?? null) as T,
    requestId: responseRequestId,
  };
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),
};
