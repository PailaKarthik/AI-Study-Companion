import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import type { ActivityEventType } from "@ai-study-companion/shared";
import { activityEventTypeSchema } from "@ai-study-companion/validation";
import { logger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";

export interface ActivityInput {
  userId: string;
  spaceId?: string;
  projectId?: string;
  eventType: ActivityEventType;
  entityType?: string;
  entityId?: string;
  /**
   * Optional idempotency key (e.g. `quiz-complete:<attemptId>`). When two
   * calls share a key, the second is a no-op returning the existing row —
   * retried API requests and reprocessed jobs cannot fork duplicate
   * logical events.
   */
  idempotencyKey?: string;
  /** Plain JSON only — never secrets, tokens, or PII beyond ids. */
  metadata?: Prisma.InputJsonValue;
}

type DbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Metadata keys that must never reach the activity table. Values under
 * these keys are replaced with "[redacted]" (and logged once per call)
 * rather than throwing, so a single careless caller cannot break an
 * otherwise valid business transaction. Callers remain responsible for
 * not putting raw prompts, message content, or PII in metadata at all —
 * see docs/ANALYTICS.md.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "sessionid",
  "session_secret",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-scrub forbidden keys from event metadata. */
export function sanitizeMetadata(
  metadata: Prisma.InputJsonValue | undefined
): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;
  let redacted = 0;
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
        redacted += 1;
        out[key] = "[redacted]";
      } else {
        out[key] = scrub(entry);
      }
    }
    return out;
  };
  const cleaned = scrub(metadata) as Prisma.InputJsonValue;
  if (redacted > 0) {
    logger.warn({ redactedKeys: redacted }, "Activity metadata contained forbidden keys");
  }
  return cleaned;
}

function validateInput(input: ActivityInput): void {
  const parsed = activityEventTypeSchema.safeParse(input.eventType);
  if (!parsed.success) {
    throw new Error(`Invalid activity event type: ${String(input.eventType)}`);
  }
  if (!input.userId) {
    throw new Error("Activity events require a userId");
  }
}

/**
 * Append one activity row. Runs inside the caller's transaction so the
 * business write and its audit trail commit atomically — core prototype
 * workflows prefer consistency over fire-and-forget logging.
 *
 * Ownership note: this service trusts the ids it is given. Every caller
 * must pass space/project ids it has already verified (via
 * getOwnedSpaceOrThrow / getOwnedProjectOrThrow / getOwnedMaterialOrThrow),
 * so one user can never write activity into another user's project. New
 * call sites: verify first, then record.
 */
export async function recordActivity(db: DbOrTx, input: ActivityInput) {
  validateInput(input);
  const data = {
    userId: input.userId,
    spaceId: input.spaceId,
    projectId: input.projectId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    idempotencyKey: input.idempotencyKey,
    metadata: sanitizeMetadata(input.metadata) ?? undefined,
  };
  if (!input.idempotencyKey) {
    return db.activityEvent.create({ data });
  }
  try {
    return await db.activityEvent.create({ data });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // The row already exists — return it so retries are idempotent.
    // NOTE: inside a caller transaction this follow-up read runs on an
    // aborted transaction (Postgres 25P02) and throws; callers must treat
    // keyed writes in transactions as claim-once (see completeAttempt).
    // Never mask the follow-up failure with a generic error — rethrow the
    // ORIGINAL conflict so the boundary renders a truthful 409.
    try {
      const existing = await db.activityEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return existing;
    } catch {
      // Fall through to rethrow the original conflict below.
    }
    throw error;
  }
}

/**
 * Append many activity rows in one round trip. No per-row idempotency
 * handling here — use recordActivity for retried operations, or pass
 * distinct keys and rely on createMany's atomicity. Rows are validated
 * and scrubbed exactly like single records.
 */
export async function recordMany(
  db: DbOrTx,
  inputs: ActivityInput[]
): Promise<{ count: number; duplicatesSkipped: number }> {
  if (inputs.length === 0) return { count: 0, duplicatesSkipped: 0 };
  for (const input of inputs) validateInput(input);
  const result = await db.activityEvent.createMany({
    data: inputs.map((input) => ({
      userId: input.userId,
      spaceId: input.spaceId,
      projectId: input.projectId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      idempotencyKey: input.idempotencyKey,
      metadata: sanitizeMetadata(input.metadata) ?? undefined,
    })),
    skipDuplicates: true,
  });
  return { count: result.count, duplicatesSkipped: inputs.length - result.count };
}
