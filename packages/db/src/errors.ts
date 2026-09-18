/**
 * Prisma error predicates shared by API and worker. Single definition so
 * both runtimes agree on what P2002/P2025 mean (idempotency races vs
 * missing rows). No Prisma import needed — codes are stable strings.
 */

/** Unique-constraint violation (idempotency-key races, duplicate names). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** Record-not-found for update/delete on a missing row. */
export function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025"
  );
}
