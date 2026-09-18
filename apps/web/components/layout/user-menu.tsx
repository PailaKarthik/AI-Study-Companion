"use client";

import { useRouter } from "next/navigation";
import type { CurrentUser } from "@ai-study-companion/shared";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/shared/toaster";
import { useLogout } from "@/features/auth";
import { toUserMessage } from "@/lib/api/errors";

function initialsOf(user: CurrentUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return (initials || "?").toUpperCase();
}

/** Header account menu. Logout revokes the server session, then we redirect. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const logout = useLogout();
  const { success, error } = useToast();

  async function handleLogout() {
    try {
      await logout.mutateAsync();
      success("Logged out", "Your session has ended.");
      router.replace("/login");
    } catch (err) {
      error("Logout failed", toUserMessage(err));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.email}`}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initialsOf(user)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{user.name ?? "Account"}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled className="text-xs">
          Role: {user.role}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={logout.isPending}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          {logout.isPending ? "Logging out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
