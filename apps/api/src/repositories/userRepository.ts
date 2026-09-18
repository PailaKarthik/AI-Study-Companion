import type { PrismaClient, User } from "@ai-study-companion/db";
import { normalizeEmail } from "@ai-study-companion/validation";
import { requireDb } from "./base.js";

export type DbClient = PrismaClient;

export async function findUserByEmail(db: DbClient, email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function findUserById(db: DbClient, id: string): Promise<User | null> {
  return db.user.findUnique({ where: { id } });
}

export async function createUser(
  db: DbClient,
  input: { name: string; email: string; passwordHash: string }
): Promise<User> {
  return db.user.create({
    data: {
      name: input.name,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      lastActiveAt: new Date(),
    },
  });
}

export async function touchUserActive(db: DbClient, id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { lastActiveAt: new Date() } });
}

/** Default client bound helpers for services that don't inject a client. */
export const users = {
  findByEmail: (email: string) => findUserByEmail(requireDb(), email),
  findById: (id: string) => findUserById(requireDb(), id),
};
