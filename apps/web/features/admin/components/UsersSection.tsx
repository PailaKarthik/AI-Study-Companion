"use client";

import { useState } from "react";
import { Activity, GraduationCap, Layers, Users } from "lucide-react";
import { SectionCard } from "@/components/shared/cards";
import { EmptyState, ErrorState, PageLoading } from "@/components/shared/states";
import { AdminTableSkeleton } from "@/components/shared/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusOf } from "@/lib/api/http-status";
import { useAdminUser, useAdminUsers } from "../hooks";
import { ALL_OPTION, Pager, SearchFilter, SelectFilter } from "./filters";

/** User ledger + single-user journey inspection (no secrets, ever). */
export function UsersSection() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const users = useAdminUsers({
    page,
    pageSize: 10,
    q: query || undefined,
    role: (role || undefined) as "USER" | "ADMIN" | undefined,
  });

  if (selectedId) {
    return <UserJourney userId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <SectionCard
      title="Users"
      description="Accounts with safe summaries — never credentials."
      icon={Users}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchFilter
          id="admin-users-q"
          label="Search"
          value={query}
          placeholder="Name or email…"
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
        <SelectFilter
          id="admin-users-role"
          label="Role"
          value={role}
          options={[
            ALL_OPTION,
            { value: "USER", label: "User" },
            { value: "ADMIN", label: "Admin" },
          ]}
          onChange={(value) => {
            setRole(value);
            setPage(1);
          }}
        />
      </div>
      {users.isPending ? (
        <PageLoading label="Loading users…" />
      ) : users.isError ? (
        <ErrorState status={statusOf(users.error)} onRetry={() => users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState title="No users found" message="Adjust the search or filters." />
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {users.data.items.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white dark:bg-white dark:text-slate-950"
                >
                  {(user.name || user.email).trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {user.name || user.email}
                    {user.name ? (
                      <span className="ml-2 font-normal text-muted-foreground">{user.email}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {user.counts.projects} projects · {user.counts.quizAttempts} attempts ·{" "}
                    {user.counts.assessments} assessments
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>{user.role}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedId(user.id)}
                  >
                    Inspect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Pager
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onPage={setPage}
          />
        </div>
      )}
    </SectionCard>
  );
}

function UserJourney({ userId, onBack }: { userId: string; onBack: () => void }) {
  const detail = useAdminUser(userId);
  return (
    <div className="flex flex-col gap-4">
      <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={onBack}>
        ← Back to users
      </Button>
      {detail.isPending ? (
        <PageLoading label="Loading user…" />
      ) : detail.isError ? (
        <ErrorState status={statusOf(detail.error)} onRetry={() => detail.refetch()} />
      ) : (
        <>
          <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white sm:p-8 dark:bg-white dark:text-slate-950">
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
              <span
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl font-bold text-slate-950 dark:bg-slate-950 dark:text-white"
              >
                {(detail.data.name || detail.data.email).trim().charAt(0).toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {detail.data.name || detail.data.email}
                </p>
                <p className="truncate text-sm text-slate-400 dark:text-slate-500">
                  {detail.data.email}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 ">
                  <Badge
                    className="text-slate-400"
                    variant={detail.data.role === "ADMIN" ? "default" : "outline"}
                  >
                    {detail.data.role}
                  </Badge>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    Joined {new Date(detail.data.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-3">
                {[
                  { value: String(detail.data.counts.spaces), label: "spaces" },
                  { value: String(detail.data.counts.projects), label: "projects" },
                  { value: String(detail.data.counts.materials), label: "materials" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="flex min-w-16 flex-col items-center gap-0.5 rounded-xl bg-white/10 px-3 py-2.5 dark:bg-slate-950/5"
                  >
                    <span className="text-lg font-semibold tabular-nums">{stat.value}</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {stat.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <SectionCard
            title="Learning profile"
            description="Mastery and recommendations from persisted rows."
            icon={GraduationCap}
          >
            <p className="text-sm">
              {detail.data.mastery.average === null
                ? "No assessed concepts yet."
                : `${Math.round(detail.data.mastery.average * 100)}% average across ${
                    detail.data.mastery.assessedConcepts
                  } of ${detail.data.mastery.totalConcepts} concepts.`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Recommendations: {detail.data.recommendations.pending} pending ·{" "}
              {detail.data.recommendations.completed} completed ·{" "}
              {detail.data.recommendations.dismissed} dismissed.
            </p>
          </SectionCard>
          <SectionCard title="Spaces" description="Content tree for this account." icon={Layers}>
            {detail.data.spaces.length === 0 ? (
              <EmptyState title="No spaces" message="This user has not created any spaces." />
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.data.spaces.map((space) => (
                  <li
                    key={space.id}
                    className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">{space.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {space.projectCount} projects ·{" "}
                      {new Date(space.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard
            title="Recent activity"
            description="Latest events for this account."
            icon={Activity}
          >
            {detail.data.recentActivity.length === 0 ? (
              <EmptyState title="No activity" message="Nothing recorded for this user yet." />
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.data.recentActivity.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">
                      {event.eventType.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
