import type { CurrentUser } from "@ai-study-companion/shared";

/** UI auth state derived from the server-verified /me query. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * Derives UI auth state from the server-verified /me query.
 *
 * Fail-closed: any settled query without a user (null data, or an error
 * such as the API being unreachable) is "unauthenticated", sending the
 * visitor to /login. The Express API remains the real enforcement layer.
 */
export function getAuthStatus(input: {
  isPending: boolean;
  isError: boolean;
  user: CurrentUser | null | undefined;
}): AuthStatus {
  if (input.user !== undefined && input.user !== null) return "authenticated";
  if (input.isPending && !input.isError) return "loading";
  return "unauthenticated";
}

/** True when the server-verified user holds the admin role. */
export function isAdminUser(user: CurrentUser | null | undefined): boolean {
  return user != null && user.role === "ADMIN";
}
