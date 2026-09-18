"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthStatus } from "@/lib/auth/status";
import { useCurrentUser } from "./hooks";

/**
 * Client-side route guard for protected pages. UX convenience only — the
 * Express API enforces authorization on every request regardless.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: user, isPending, isError } = useCurrentUser();
  const status = getAuthStatus({ isPending, isError, user });

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (status === "unauthenticated") return null;
  return <>{children}</>;
}

/**
 * Admin-only guard. Reads the SERVER-verified role from /me — never a
 * frontend flag. The API's requireAdmin remains the real enforcement.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: user, isPending, isError } = useCurrentUser();
  const status = getAuthStatus({ isPending, isError, user });
  const denied = status === "unauthenticated" || (status === "authenticated" && user?.role !== "ADMIN");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    else if (status === "authenticated" && user?.role !== "ADMIN") router.replace("/spaces");
  }, [status, user, router]);

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (denied) return null;
  return <>{children}</>;
}
