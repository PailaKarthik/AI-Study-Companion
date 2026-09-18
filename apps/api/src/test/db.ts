import { PrismaClient } from "@ai-study-companion/db";

/**
 * Isolated test-database helpers.
 *
 * Integration suites run ONLY when TEST_DATABASE_URL is set (wired to
 * DATABASE_URL by vitest.config.ts). Otherwise they skip — `pnpm test`
 * without a test DB still passes on unit tests alone. Destructive tests
 * never touch production: the config guard refuses TEST == outer DATABASE.
 */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

let prisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!hasTestDb) {
    throw new Error("TEST_DATABASE_URL is not set; integration tests are skipped.");
  }
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * Wipe all test data. Activity/audit/observability rows survive user
 * deletion by design (SetNull FKs or no user FK at all), so they are
 * cleared explicitly first; everything else cascades from the user delete.
 */
export async function resetTestDb(): Promise<void> {
  const db = getTestPrisma();
  await db.activityEvent.deleteMany();
  await db.aIUsage.deleteMany();
  await db.aIEvaluation.deleteMany();
  await db.documentJob.deleteMany();
  await db.user.deleteMany();
}

export async function closeTestDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
