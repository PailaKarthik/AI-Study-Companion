import type { PrismaClient, Session } from "@ai-study-companion/db";

export type DbClient = PrismaClient;

export async function createSession(
  db: DbClient,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }
): Promise<Session> {
  return db.session.create({ data: input });
}

export async function findSessionByTokenHash(
  db: DbClient,
  tokenHash: string
): Promise<Session | null> {
  return db.session.findUnique({ where: { tokenHash } });
}

export async function touchSession(db: DbClient, id: string): Promise<void> {
  await db.session.update({ where: { id }, data: { lastUsedAt: new Date() } });
}

export async function revokeSessionByTokenHash(db: DbClient, tokenHash: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash } });
}

export async function revokeAllUserSessions(db: DbClient, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

export async function deleteExpiredSessions(db: DbClient): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

/**
 * Session hygiene on every new login/registration (no cron needed):
 * drop the user's expired sessions, then evict oldest-first beyond the
 * active cap so one account can never accumulate unbounded sessions.
 */
export const MAX_ACTIVE_SESSIONS_PER_USER = 20;

export async function pruneSessionsForUser(db: DbClient, userId: string): Promise<void> {
  await db.session.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });
  // Count-then-evict (not take-capped fetch): one login must be able to
  // clear an arbitrarily large backlog, not just a single row.
  const active = await db.session.count({ where: { userId } });
  if (active > MAX_ACTIVE_SESSIONS_PER_USER) {
    const evict = await db.session.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: active - MAX_ACTIVE_SESSIONS_PER_USER,
    });
    if (evict.length > 0) {
      await db.session.deleteMany({
        where: { id: { in: evict.map((s) => s.id) } },
      });
    }
  }
}
