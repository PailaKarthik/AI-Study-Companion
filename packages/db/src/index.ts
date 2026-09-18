import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Singleton PrismaClient for the monorepo.
 *
 * - Reuses a single client in development (Next.js / Express HMR safe).
 * - Never throws at import time: connection is lazy, so the API/worker
 *   can boot without DATABASE_URL for local foundation development.
 * - `isDatabaseConfigured()` lets /ready report `skipped` instead of
 *   failing when no database is configured yet.
 * - Consumed only by `apps/api` and `apps/worker`. The browser must never
 *   import this package (see docs/DATABASE.md).
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  return (
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    })
  );
}

let client: PrismaClient | null = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production" && client) {
  globalForPrisma.prisma = client;
}

export function getPrisma(): PrismaClient | null {
  if (!client) {
    client = createClient();
    if (client && process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    }
  }
  return client;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function checkDatabase(): Promise<{
  status: "up" | "down" | "skipped";
  detail?: string;
}> {
  const db = getPrisma();
  if (!db) {
    return { status: "skipped", detail: "DATABASE_URL is not configured" };
  }
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "up" };
  } catch (error) {
    return {
      status: "down",
      detail: error instanceof Error ? error.message : "database ping failed",
    };
  }
}

/**
 * Run work inside a Prisma transaction. Throws a plain Error (instead of a
 * confusing null-deref) when no database is configured.
 */
export async function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const db = getPrisma();
  if (!db) {
    throw new Error(
      "Database is not configured (DATABASE_URL is missing); cannot start a transaction."
    );
  }
  return db.$transaction((tx) => fn(tx));
}

/** Graceful shutdown helper for API/worker process exit and tests. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
  }
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = undefined;
  }
  client = null;
}

export { PrismaClient };
export type { Prisma, Project, Session, Space, User } from "@prisma/client";
export * from "./isolation.js";
export * from "./pagination.js";
export * from "./errors.js";
export * from "./storage.js";
