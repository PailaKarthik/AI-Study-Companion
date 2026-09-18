"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@ai-study-companion/shared";
import { matchNavItem, visibleNavItems } from "@/lib/navigation/items";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom navigation: the 2–3 real destinations as large touch
 * targets with safe-area padding. The header menu drawer remains for
 * account context — this bar is for moving, not for everything.
 */
export function MobileBottomNav({ user }: { user: CurrentUser | null | undefined }) {
  const pathname = usePathname();
  const items = visibleNavItems(user).filter((i) => i.href && !i.comingSoon);
  if (items.length === 0) return null;
  const activeId = matchNavItem(pathname ?? "/", items);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid w-full max-w-md auto-cols-fr grid-flow-col gap-1 px-3 py-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <Link
              key={item.id}
              href={item.href as string}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  active ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "bg-transparent"
                )}
                aria-hidden
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
