/**
 * Shared Prisma error predicates. Single definition — services and the
 * error boundary must agree on what P2002/P2025 mean.
 *
 * Re-exported from @ai-study-companion/db so API and worker share one
 * implementation.
 */
export { isRecordNotFound, isUniqueViolation } from "@ai-study-companion/db";
