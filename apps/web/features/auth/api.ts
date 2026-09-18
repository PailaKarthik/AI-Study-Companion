import type { CurrentUser } from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

/**
 * Auth API surface. Session travels in the httpOnly cookie (credentials:
 * include is set in the central client) — no tokens in localStorage, ever.
 */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
  try {
    const { data } = await api.get<CurrentUser>("/api/auth/me", { signal });
    return data;
  } catch (error) {
    const { ApiClientError } = await import("@/lib/api/errors");
    if (error instanceof ApiClientError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export interface AuthCredentials {
  email: string;
  password: string;
  name?: string;
}

export async function loginRequest(input: { email: string; password: string }) {
  const { data } = await api.post<CurrentUser>("/api/auth/login", input);
  return data;
}

export async function registerRequest(input: { name: string; email: string; password: string }) {
  const { data } = await api.post<CurrentUser>("/api/auth/register", input);
  return data;
}

export async function logoutRequest() {
  await api.post("/api/auth/logout");
}
