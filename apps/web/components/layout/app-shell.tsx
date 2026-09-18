"use client";

import type { ReactNode } from "react";
import { useCurrentUser } from "@/features/auth";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { MobileBottomNav } from "@/components/navigation/mobile-bottom-nav";
import type { Crumb } from "@/components/navigation/breadcrumbs";

/**
 * Authenticated application shell: persistent sidebar (desktop), drawer
 * navigation (mobile), slim header, spacious content column, footer.
 * Route guards (RequireAuth/RequireAdmin) wrap this per page.
 */
export function AppShell({
  children,
  crumbs,
  title,
  headerActions,
}: {
  children: ReactNode;
  crumbs?: Crumb[];
  title?: ReactNode;
  headerActions?: ReactNode;
}) {
  const { data: user } = useCurrentUser();
  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AppSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader user={user} crumbs={crumbs} title={title} actions={headerActions} />
        <main id="main-content" className="flex flex-1 flex-col pb-24 lg:pb-0">
          {children}
        </main>
        <MobileBottomNav user={user} />
      </div>
    </div>
  );
}
