import { getPrisma } from "@ai-study-companion/db";
import type { PrismaClient } from "@ai-study-companion/db";
import { AppError } from "../errors/AppError.js";

/**
 * Repositories are the ONLY layer that touches Prisma directly.
 * Services call repositories; controllers never touch Prisma.
 */

/** Throw 503 when the API boots without a database (degraded mode). */
export function requireDb(client?: PrismaClient | null): PrismaClient {
  const db = client ?? getPrisma();
  if (!db) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Database is not configured. Set DATABASE_URL to enable authentication."
    );
  }
  return db;
}

export function getDb() {
  return getPrisma();
}
