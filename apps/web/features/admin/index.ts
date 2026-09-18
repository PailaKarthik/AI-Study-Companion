/**
 * Admin feature: system overview, users, activity, learning, AI usage,
 * evaluations, jobs, and health. Real endpoints only — every section
 * requires the ADMIN role server-side (RequireAdmin guards the route).
 */
export * from "./api";
export * from "./hooks";
export { OverviewSection } from "./components/OverviewSection";
export { UsersSection } from "./components/UsersSection";
export { ActivitySection } from "./components/ActivitySection";
export { LearningSection } from "./components/LearningSection";
export { AIUsageSection, AIEvaluationsSection } from "./components/AISections";
export { JobsSection, SystemHealthSection } from "./components/JobsHealthSections";
