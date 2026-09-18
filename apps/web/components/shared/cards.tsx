import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Card hierarchy (single theme: white surfaces + dark gradient accents).
 *
 * - SectionCard: white surface, rounded-2xl, soft border + shadow. Every
 *   dashboard section uses this — identical padding, header rhythm, gaps.
 * - StatCard: metric tile. `tone="dark"` renders the signature dark
 *   gradient (slate-950 → slate-800, white text) for KPI/hero numbers;
 *   `tone="light"` (default) is the white surface. Never mix more than
 *   one dark card per row group — accents, not walls.
 * - Plain shadcn Card for one-off list rows.
 */

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  className,
  tone = "light",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-sm font-medium", dark ? "text-slate-300" : "text-muted-foreground")}>
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              dark ? "bg-white/10 text-white" : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-2 text-3xl font-semibold tracking-tight tabular-nums",
          dark && "text-white"
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className={cn("mt-1 text-sm", dark ? "text-slate-400" : "text-muted-foreground")}>
          {hint}
        </p>
      ) : null}
    </>
  );
  const classes = cn(
    "relative overflow-hidden rounded-2xl p-6",
    dark ? "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800" : "",
    href && "transition-all hover:-translate-y-0.5 motion-reduce:transform-none",
    className
  );
  const glow = null;
  if (href) {
    return (
      <Link href={href} className={cn("block rounded-2xl", className)} aria-label={label}>
        <Card className={classes}>
          {glow}
          <div className="relative">{body}</div>
        </Card>
      </Link>
    );
  }
  return (
    <Card className={classes}>
      {glow}
      <div className="relative">{body}</div>
    </Card>
  );
}
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className={cn("rounded-2xl", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
