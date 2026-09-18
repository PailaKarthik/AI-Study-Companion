"use client";

import { memo, useId } from "react";

/**
 * Minimal accessible SVG charts for analytics dashboards.
 *
 * Deliberately dependency-free: every visualization answers one product
 * question from real API data (counts per UTC day bucket, distribution
 * shares). Bars carry <title> tooltips and the svg has role="img" with
 * an aria-label summary so screen readers get the same numbers.
 */

export interface SeriesPoint {
  date: string;
  count: number;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso.slice(0, 10)
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const ActivityBars = memo(function ActivityBars({
  points,
  ariaLabel,
  height = 120,
}: {
  points: SeriesPoint[];
  ariaLabel: string;
  height?: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const width = Math.max(points.length * 14, 120);
  const barWidth = points.length > 0 ? Math.min(10, (width - 20) / points.length - 2) : 0;
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const peak = max > 0 ? points.findIndex((p) => p.count === max) : -1;
  const gradientId = useId();
  // Horizontal scroll on narrow screens: squeezing a 90-day (1260-unit)
  // series into 360px would crush bars to ~2px. The inner svg keeps a
  // readable minimum width; the wrapper scrolls instead of breaking layout.
  return (
    <div className="overflow-x-auto rounded-xl bg-gradient-to-b from-muted/60 to-transparent p-3">
      <svg
        viewBox={`0 0 ${width} ${height + 24}`}
        className="w-full"
        style={{ height: "auto", minWidth: Math.min(width, 480) }}
        role="img"
        aria-label={`${ariaLabel}: ${total} total across ${points.length} days`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#475569" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={10}
            x2={width - 10}
            y1={height * (1 - fraction)}
            y2={height * (1 - fraction)}
            className="stroke-border"
            strokeDasharray="3 3"
            aria-hidden
          />
        ))}
        {points.map((point, i) => {
          const barHeight = Math.round((point.count / max) * height);
          const x = 10 + i * ((width - 20) / Math.max(points.length, 1));
          const isPeak = i === peak && point.count > 0;
          return (
            <g
              key={point.date}
              className="animate-bar-rise motion-reduce:animate-none"
              style={{
                animationDelay: `${Math.min(i * 18, 900)}ms`,
                transformBox: "fill-box",
                transformOrigin: "50% 100%",
              }}
            >
              <title>{`${formatDay(point.date)}: ${point.count}${isPeak ? " (peak)" : ""}`}</title>
              <rect
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={Math.max(barHeight, point.count > 0 ? 2 : 0)}
                rx={Math.min(3, barWidth / 2)}
                fill={point.count > 0 ? `url(#${gradientId})` : undefined}
                className={point.count > 0 ? undefined : "fill-muted"}
                opacity={point.count > 0 ? 1 : 0.5}
              />
              {isPeak ? (
                <g aria-hidden>
                  <circle cx={x + barWidth / 2} cy={height - barHeight - 5} r={5} className="fill-slate-500 opacity-30 animate-ping motion-reduce:animate-none" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                  <circle cx={x + barWidth / 2} cy={height - barHeight - 5} r={2.5} className="fill-slate-900" />
                </g>
              ) : null}
            </g>
          );
        })}
        {points.length > 0 ? (
          <text x={10} y={height + 16} className="fill-muted-foreground" fontSize={10} aria-hidden>
            {formatDay(points[0]?.date ?? "")}
          </text>
        ) : null}
        {points.length > 1 ? (
          <text
            x={width - 10}
            y={height + 16}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={10}
            aria-hidden
          >
            {formatDay(points[points.length - 1]?.date ?? "")}
          </text>
        ) : null}
      </svg>
    </div>
  );
});

export interface DistributionSlice {
  label: string;
  value: number;
  /** Bar fill; defaults follow slice order. Pass explicit tones so color
   * always means something (never red-for-"created"). */
  tone?: "success" | "info" | "warning" | "danger" | "neutral";
}

const TONE_BAR_CLASSES: Record<NonNullable<DistributionSlice["tone"]>, string> = {
  success: "bg-gradient-to-r from-slate-900 to-slate-600",
  info: "bg-gradient-to-r from-slate-700 to-slate-500",
  warning: "bg-gradient-to-r from-slate-400 to-slate-300",
  danger: "bg-gradient-to-r from-slate-950 to-slate-700",
  neutral: "bg-gradient-to-r from-slate-300 to-slate-200",
};

const FALLBACK_BAR_CLASSES = [
  "bg-gradient-to-r from-slate-900 to-slate-600",
  "bg-gradient-to-r from-slate-700 to-slate-500",
  "bg-gradient-to-r from-slate-500 to-slate-400",
  "bg-gradient-to-r from-slate-400 to-slate-300",
  "bg-gradient-to-r from-slate-300 to-slate-200",
];

export const DistributionBars = memo(function DistributionBars({
  slices,
  ariaLabel,
}: {
  slices: DistributionSlice[];
  ariaLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <div
      className="flex flex-col gap-2"
      role="img"
      aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}
    >
      {slices.map((slice, i) => {
        const share = total > 0 ? slice.value / total : 0;
        const percent = Math.round(share * 100);
        const fill = slice.tone
          ? TONE_BAR_CLASSES[slice.tone]
          : (FALLBACK_BAR_CLASSES[i % FALLBACK_BAR_CLASSES.length] as string);
        return (
          <div key={slice.label} className="flex items-center gap-3">
            <span
              className="w-32 shrink-0 truncate text-sm text-muted-foreground"
              title={slice.label}
            >
              {slice.label}
            </span>
            <div
              className="h-2.5 min-w-2 flex-1 overflow-hidden rounded-full bg-muted"
              role="presentation"
              title={`${slice.label}: ${slice.value} (${percent}%)`}
            >
              <div
                className={`h-full rounded-full animate-dist-fill motion-reduce:animate-none ${fill}`}
                style={{
                  width: `${percent}%`,
                  minWidth: slice.value > 0 ? 6 : 0,
                  animationDelay: `${i * 90}ms`,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
              {slice.value} · {percent}%
            </span>
          </div>
        );
      })}
      {total === 0 ? <p className="text-sm text-muted-foreground">No data in this range.</p> : null}
    </div>
  );
});

export interface MasteryTrendPoint {
  createdAt: string;
  newScore: number;
  sourceType: string;
}

/**
 * Mastery trend line: one real assessment event per point (gaps are
 * gaps — no interpolation claims). Y axis is fixed 0–100% so small
 * samples can't exaggerate movement. Text list below stays the
 * screen-reader source of truth.
 */
export const MasteryTrendChart = memo(function MasteryTrendChart({
  points,
  ariaLabel,
  height = 140,
}: {
  points: MasteryTrendPoint[];
  ariaLabel: string;
  height?: number;
}) {
  const width = 560;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  const ordered = [...points].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const xs = ordered.map((_, i) =>
    ordered.length === 1 ? padLeft + innerWidth / 2 : padLeft + (i / (ordered.length - 1)) * innerWidth
  );
  const ys = ordered.map(
    (p) => padTop + (1 - Math.min(1, Math.max(0, p.newScore))) * innerHeight
  );
  const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(ys[i] ?? 0).toFixed(1)}`).join(" ");
  const area =
    line.length > 0
      ? `${line} L${(xs[xs.length - 1] ?? 0).toFixed(1)},${(padTop + innerHeight).toFixed(1)} L${(xs[0] ?? 0).toFixed(1)},${(padTop + innerHeight).toFixed(1)} Z`
      : "";
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const delta =
    first && last && ordered.length > 1 ? last.newScore - first.newScore : null;
  const up = (delta ?? 0) >= 0;
  const areaId = useId();
  const lineId = useId();

  return (
    <div className="flex flex-col gap-1 rounded-xl bg-gradient-to-b from-muted/60 to-transparent p-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ height: "auto", minWidth: 420 }}
          role="img"
          aria-label={`${ariaLabel}: ${ordered.length} events${delta !== null ? `, ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} points overall` : ""}`}
        >
          <defs>
            <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#020617" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={lineId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#020617" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((fraction) => {
            const y = padTop + (1 - fraction) * innerHeight;
            return (
              <g key={fraction}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  strokeDasharray={fraction === 1 || fraction === 0 ? undefined : "3 3"}
                  aria-hidden
                />
                <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize={10} className="fill-muted-foreground" aria-hidden>
                  {Math.round(fraction * 100)}%
                </text>
              </g>
            );
          })}
          {area ? (
            <path
              d={area}
              fill={`url(#${areaId})`}
              aria-hidden
              className="animate-fade-slide-in motion-reduce:animate-none"
            />
          ) : null}
          {line ? (
            <path
              d={line}
              fill="none"
              strokeWidth={2.5}
              stroke={`url(#${lineId})`}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              aria-hidden
              className="animate-line-draw motion-reduce:animate-none"
              
            />
          ) : null}
          {ordered.map((point, i) => {
            const isLast = i === ordered.length - 1;
            return (
              <g key={`${point.createdAt}-${i}`}>
                <title>{`${formatDay(point.createdAt)} · ${Math.round(point.newScore * 100)}% · ${point.sourceType.toLowerCase().replaceAll("_", " ")}`}</title>
                <circle
                  cx={xs[i]}
                  cy={ys[i]}
                  r={isLast ? 5 : 3.5}
                  className="fill-background"
                  strokeWidth={2}
                  stroke="#020617"
                />
                {isLast ? (
                  <circle
                    cx={xs[i]}
                    cy={ys[i]}
                    r={9}
                    fill="none"
                    strokeWidth={1.5}
                    stroke="#020617"
                    opacity={0.35}
                    aria-hidden
                    className="animate-ping motion-reduce:animate-none"
                    style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {ordered.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-hidden>
          <span>
            {formatDay(first?.createdAt ?? "")} → {formatDay(last?.createdAt ?? "")}
          </span>
          {delta !== null ? (
            <span
              className={
                up
                  ? "rounded-full bg-slate-950 px-2 py-0.5 font-semibold tabular-nums text-white dark:bg-white dark:text-slate-950"
                  : "rounded-full border px-2 py-0.5 font-semibold tabular-nums text-muted-foreground"
              }
            >
              {up ? "↗" : "↘"} {up ? "+" : ""}{Math.round(delta * 100)} pts
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
