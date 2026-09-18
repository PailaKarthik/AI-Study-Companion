"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@ai-study-companion/shared";
import { matchNavItem, visibleNavItems, type NavItem } from "@/lib/navigation/items";
import { cn } from "@/lib/utils";

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          active
            ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
            : "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </>
  );
  const classes = cn(
    "relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  );
  const indicator = active ? (
    <span
      className="absolute -left-2.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-slate-950 dark:bg-white"
      aria-hidden
    />
  ) : null;
  if (item.comingSoon || !item.href) {
    return (
      <span
        className={cn(classes, "cursor-default opacity-60")}
        aria-disabled="true"
        title={`${item.label} — coming soon`}
      >
        {indicator}
        {content}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={classes}
    >
      {indicator}
      {content}
    </Link>
  );
}

/** Desktop sidebar navigation with section grouping. Active section derives from the URL. */
export function SidebarNav({
  user,
  onNavigate,
}: {
  user: CurrentUser | null | undefined;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = visibleNavItems(user);
  const activeId = matchNavItem(pathname ?? "/", items);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Learn
        </p>
        {items
          .filter((i) => i.id !== "admin")
          .map((item) => (
            <NavLink
              key={item.id}
              item={item}
              active={item.id === activeId}
              onNavigate={onNavigate}
            />
          ))}
      </div>
      {items.some((i) => i.id === "admin") ? (
        <div className="flex flex-col gap-1">
          <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Manage
          </p>
          {items
            .filter((i) => i.id === "admin")
            .map((item) => (
              <NavLink
                key={item.id}
                item={item}
                active={item.id === activeId}
                onNavigate={onNavigate}
              />
            ))}
        </div>
      ) : null}
    </nav>
  );
}
