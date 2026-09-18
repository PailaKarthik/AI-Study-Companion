import type { CurrentUser } from "@ai-study-companion/shared";
import type { PrismaClient, User } from "@ai-study-companion/db";
import { normalizeEmail } from "@ai-study-companion/validation";
import { config, sessionTtlMs } from "../config/index.js";
import { ConflictError, UnauthenticatedError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { requireDb } from "../repositories/base.js";
import * as sessions from "../repositories/sessionRepository.js";
import * as users from "../repositories/userRepository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSessionToken, hashSessionToken } from "./sessionToken.js";
import { recordActivity } from "./activityService.js";

export interface RequestDevice {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthResult {
  user: CurrentUser;
  sessionToken: string;
  expiresAt: Date;
}

/** Argon2id hash used to equalize timing when the account/hash is missing. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXk$R2V8xK7mF5Q9J0mN3P6Q8S0U2V4W6X8Y0Z2a4B6C8D0";

export function toSafeUser(user: User): CurrentUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function newExpiry(): Date {
  return new Date(Date.now() + sessionTtlMs());
}

async function issueSession(
  db: PrismaClient,
  userId: string,
  device: RequestDevice
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const sessionToken = generateSessionToken();
  const expiresAt = newExpiry();
  await sessions.createSession(db, {
    userId,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt,
    userAgent: device.userAgent?.slice(0, 512),
    ipAddress: device.ipAddress,
  });
  // Best-effort hygiene: a prune failure must never block login.
  await sessions.pruneSessionsForUser(db, userId).catch((error: unknown) => {
    logger.warn(
      { userId, error: error instanceof Error ? error.message : String(error) },
      "Session prune skipped"
    );
  });
  return { sessionToken, expiresAt };
}

/**
 * Register a new USER account. Duplicate email → 409 (documented
 * enumeration trade-off in docs/SECURITY.md; login stays fully generic).
 */
export async function registerUser(
  input: { name: string; email: string; password: string },
  device: RequestDevice,
  db: PrismaClient = requireDb()
): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const existing = await users.findUserByEmail(db, email);
  if (existing) {
    throw new ConflictError("An account with this email already exists");
  }
  const passwordHash = await hashPassword(input.password);
  const user = await users.createUser(db, {
    name: input.name.trim(),
    email,
    passwordHash,
  });
  const { sessionToken, expiresAt } = await issueSession(db, user.id, device);
  logger.info({ userId: user.id, event: "user_registered" }, "User registered");
  // Audit write is best-effort: registration already committed and the
  // session issued — a logging failure must not fail the signup.
  await recordActivity(db, {
    userId: user.id,
    eventType: "USER_REGISTERED",
    entityType: "user",
    entityId: user.id,
  }).catch((error: unknown) => {
    logger.warn(
      { userId: user.id, error: error instanceof Error ? error.message : String(error) },
      "Registration audit event skipped"
    );
  });
  return { user: toSafeUser(user), sessionToken, expiresAt };
}

/** Login with a fully generic failure (no email/password/user disclosure). */
export async function authenticateUser(
  input: { email: string; password: string },
  device: RequestDevice,
  db: PrismaClient = requireDb()
): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const user = await users.findUserByEmail(db, email);
  const hash = user?.passwordHash;
  // Equalize timing whether or not the account (or its hash) exists.
  const ok =
    user && user.isActive && hash
      ? await verifyPassword(hash, input.password)
      : await verifyPassword(DUMMY_HASH, input.password).then(() => false);
  if (!ok || !user) {
    throw new UnauthenticatedError("Invalid email or password");
  }
  await users.touchUserActive(db, user.id);
  const { sessionToken, expiresAt } = await issueSession(db, user.id, device);
  logger.info({ userId: user.id, event: "user_login" }, "User logged in");
  await recordActivity(db, {
    userId: user.id,
    eventType: "USER_LOGIN",
    entityType: "user",
    entityId: user.id,
  }).catch((error: unknown) => {
    logger.warn(
      { userId: user.id, error: error instanceof Error ? error.message : String(error) },
      "Login audit event skipped"
    );
  });
  return { user: toSafeUser(user), sessionToken, expiresAt };
}

/** Revoke one session. Safe when the token is unknown (logout idempotent). */
export async function revokeSession(
  sessionToken: string | undefined,
  db: PrismaClient = requireDb()
): Promise<void> {
  if (!sessionToken) return;
  const tokenHash = hashSessionToken(sessionToken);
  const session = await sessions.findSessionByTokenHash(db, tokenHash);
  await sessions.revokeSessionByTokenHash(db, tokenHash);
  // Only real sessions produce an event — unknown tokens stay silent.
  if (session) {
    await recordActivity(db, {
      userId: session.userId,
      eventType: "USER_LOGOUT",
      entityType: "user",
      entityId: session.userId,
    });
  }
}

/** Validate a raw session token → current user, or throw 401. */
export async function validateSessionToken(
  sessionToken: string | undefined,
  db: PrismaClient = requireDb()
): Promise<{ user: CurrentUser; sessionId: string }> {
  if (!sessionToken) {
    throw new UnauthenticatedError();
  }
  const session = await sessions.findSessionByTokenHash(db, hashSessionToken(sessionToken));
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) {
      await sessions.revokeSessionByTokenHash(db, session.tokenHash);
    }
    throw new UnauthenticatedError("Session expired");
  }
  const user = await users.findUserById(db, session.userId);
  if (!user || !user.isActive) {
    await sessions.revokeSessionByTokenHash(db, session.tokenHash);
    throw new UnauthenticatedError();
  }
  // Throttled touch: avoid a write on every single request.
  if (Date.now() - session.lastUsedAt.getTime() > 15 * 60 * 1000) {
    await sessions.touchSession(db, session.id).catch(() => undefined);
  }
  return { user: toSafeUser(user), sessionId: session.id };
}

/** Fresh safe user for GET /me. */
export async function getCurrentUser(
  userId: string,
  db: PrismaClient = requireDb()
): Promise<CurrentUser> {
  const user = await users.findUserById(db, userId);
  if (!user || !user.isActive) {
    throw new UnauthenticatedError();
  }
  return toSafeUser(user);
}

export function sessionCookieName(): string {
  return config.SESSION_COOKIE_NAME;
}
