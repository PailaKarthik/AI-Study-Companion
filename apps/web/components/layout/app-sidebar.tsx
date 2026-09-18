"use client";

import Link from "next/link";
import type { CurrentUser } from "@ai-study-companion/shared";
import { SidebarNav } from "@/components/navigation/sidebar-nav";

/** Persistent desktop sidebar: identity, nav, account footer. */
export function AppSidebar({ user }: { user: CurrentUser | null | undefined }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r bg-card/40 p-5 lg:flex">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          AI
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">Study Companion</span>
          <span className="text-xs text-muted-foreground">Learn anything, deeply</span>
        </span>
      </Link>
      <SidebarNav user={user} />
      <div className="mt-auto flex flex-col gap-1 rounded-lg border bg-card p-3">
        <p className="truncate text-sm font-medium" title={user?.email ?? undefined}>
          {user?.name ?? "Signed in"}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={user?.email ?? undefined}>
          {user?.email ?? "Loading account…"}
        </p>
      </div>
    </aside>
  );
}
