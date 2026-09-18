import type { LucideIcon } from "lucide-react";
import { Home, Layers, ShieldCheck } from "lucide-react";
import type { CurrentUser } from "@ai-study-companion/shared";

export interface NavItem {
  id: string;
  label: string;
  /** Omitted for entries whose route ships in a later prompt. */
  href?: string;
  icon: LucideIcon;
  /** Shown only to server-verified admins. */
  adminOnly?: boolean;
  /** Rendered disabled with a "Soon" badge — no dead links. */
  comingSoon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", href: "/", icon: Home },
  { id: "spaces", label: "Spaces", href: "/spaces", icon: Layers }
];

export const ADMIN_NAV_ITEM: NavItem = {
  id: "admin",
  label: "Admin",
  href: "/admin",
  icon: ShieldCheck,
  adminOnly: true,
};

/**
 * Items to render for the given server-verified user. Anonymous users only
 * ever see linked public entries; admin-only entries require role ADMIN.
 */
export function visibleNavItems(user: CurrentUser | null | undefined): NavItem[] {
  const items = [...NAV_ITEMS];
  if (user?.role === "ADMIN") items.push(ADMIN_NAV_ITEM);
  return items;
}

/**
 * Best-match nav id for a pathname: longest href prefix wins so nested
 * routes (e.g. /spaces/abc/projects/def) highlight their section.
 * Returns null when nothing matches.
 */
export function matchNavItem(pathname: string, items: NavItem[] = NAV_ITEMS): string | null {
  let best: NavItem | null = null;
  for (const item of items) {
    if (!item.href) continue;
    const matches =
      item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best?.href || item.href.length > (best.href?.length ?? 0))) {
      best = item;
    }
  }
  return best?.id ?? null;
}
