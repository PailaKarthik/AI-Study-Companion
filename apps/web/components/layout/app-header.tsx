"use client";

import type { CurrentUser } from "@ai-study-companion/shared";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Breadcrumbs, type Crumb } from "@/components/navigation/breadcrumbs";
import { MobileNav } from "@/components/navigation/mobile-nav";
import { UserMenu } from "./user-menu";

/**
 * Slim app header: mobile nav trigger, breadcrumb/title slot, contextual
 * actions, account menu. Keeps chrome minimal — page content owns the UI.
 */
export function AppHeader({
  user,
  crumbs,
  title,
  actions,
}: {
  user: CurrentUser | null | undefined;
  crumbs?: Crumb[];
  title?: ReactNode;
  actions?: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            {crumbs && crumbs.length > 1 ? <Breadcrumbs items={crumbs} /> : null}
            {title ? (
              <p className="truncate text-[15px] font-semibold tracking-tight">{title}</p>
            ) : null}
          </div>
          {actions}
          {user ? <UserMenu user={user} /> : null}
        </div>
      </header>
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} user={user} />
    </>
  );
}
