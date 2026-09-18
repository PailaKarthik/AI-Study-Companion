/**
 * Central TanStack Query keys. One canonical key per server resource so
 * caches stay consistent across hooks and pages.
 *
 * Only keys for APIs that actually exist are listed.
 */
export const queryKeys = {
  currentUser: ["auth", "me"],
  apiHealth: ["admin", "health"],
  apiReadiness: ["admin", "ready"],
  home: ["home"],
  spaces: (params?: { page?: number; pageSize?: number; q?: string }) =>
    ["spaces", params ?? {}] as const,
  space: (spaceId: string) => ["spaces", spaceId] as const,
  projects: (
    spaceId: string,
    params?: { page?: number; pageSize?: number; q?: string; status?: string }
  ) => ["spaces", spaceId, "projects", params ?? {}] as const,
  projectStatusCounts: (spaceId: string) => ["spaces", spaceId, "projects", "counts"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  projectOverview: (projectId: string) => ["projects", projectId, "overview"] as const,
  materials: (projectId: string) => ["projects", projectId, "materials"] as const,
  conversations: (projectId: string) => ["projects", projectId, "conversations"] as const,
  conversation: (projectId: string, conversationId: string) =>
    ["projects", projectId, "conversations", conversationId] as const,
  quizzes: (projectId: string) => ["projects", projectId, "quizzes"] as const,
  concepts: (projectId: string) => ["projects", projectId, "concepts"] as const,
  quiz: (quizId: string) => ["quizzes", quizId] as const,
  attempt: (attemptId: string) => ["quiz-attempts", attemptId] as const,
  growth: (projectId: string) => ["projects", projectId, "growth"] as const,
  conceptDetail: (projectId: string, conceptId: string) =>
    ["projects", projectId, "concepts", conceptId] as const,
  recommendations: (projectId: string) => ["projects", projectId, "recommendations"] as const,
  projectAnalytics: (projectId: string, range?: { from?: string; to?: string }) =>
    ["projects", projectId, "analytics", range ?? {}] as const,
  homeAnalytics: (range?: { from?: string; to?: string }) =>
    ["home", "analytics", range ?? {}] as const,
  adminOverview: (range?: { from?: string; to?: string }) =>
    ["admin", "overview", range ?? {}] as const,
  adminUsers: (params?: { page?: number; pageSize?: number; q?: string; role?: string }) =>
    ["admin", "users", params ?? {}] as const,
  adminUser: (userId: string) => ["admin", "users", userId] as const,
  adminSpaces: (params?: { page?: number; pageSize?: number; q?: string }) =>
    ["admin", "spaces", params ?? {}] as const,
  adminProjects: (params?: { page?: number; pageSize?: number; q?: string }) =>
    ["admin", "projects", params ?? {}] as const,
  adminActivity: (params?: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    userId?: string;
    eventType?: string;
    spaceId?: string;
    projectId?: string;
    sort?: string;
  }) => ["admin", "activity", params ?? {}] as const,
  adminLearning: (range?: { from?: string; to?: string }) =>
    ["admin", "learning", range ?? {}] as const,
  adminAIUsage: (params?: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    feature?: string;
    provider?: string;
    status?: string;
    sort?: string;
  }) => ["admin", "ai-usage", params ?? {}] as const,
  adminAIEvaluations: (params?: {
    page?: number;
    pageSize?: number;
    feature?: string;
    sort?: string;
  }) => ["admin", "ai-evaluations", params ?? {}] as const,
  adminJobs: (params?: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    type?: string;
    status?: string;
    sort?: string;
  }) => ["admin", "jobs", params ?? {}] as const,
  adminSystemHealth: ["admin", "system-health"] as const,
} as const;

export type QueryKey = (typeof queryKeys)[keyof typeof queryKeys];
