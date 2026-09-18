import { z } from "zod";
import { ACTIVITY_EVENT_TYPES } from "@ai-study-companion/shared";

/**
 * @ai-study-companion/validation
 *
 * Reusable Zod schemas shared between API and web.
 */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const requestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9\-_:.]+$/);

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

/** UUID route params (spaces, projects, materials, …). */
export const uuidSchema = z.string().uuid();

export function idParamSchema(param = "id") {
  return z.object({ [param]: uuidSchema });
}

/** Normalized email: trimmed + lowercased, max 254 chars (RFC 5321). */
export const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Prototype password policy: 8–128 chars. Length-only (no complexity
 * theater); strength comes from Argon2id hashing server-side.
 */
export const passwordSchema = z.string().min(8).max(128);

export const displayNameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Future-proof input ceilings (features arrive later; limits ship now). */
export const tutorMessageSchema = z.string().trim().min(1).max(8000);
export const quizResponseTextSchema = z.string().trim().min(1).max(8000);
export const materialFilenameSchema = z.string().trim().min(1).max(255);
export const searchQuerySchema = z.string().trim().min(1).max(500);

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/**
 * HTML forms submit "" for untouched optional inputs. For creates, ""
 * means absent (stored as NULL); for updates, "" means "clear the field".
 * Required names keep min(1) so empties are still rejected.
 */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const emptyToNull = (value: unknown) => (value === "" ? null : value);

/** Space names are required, trimmed, and bounded for UI + DB sanity. */
export const spaceNameSchema = z.string().trim().min(1).max(100);

export const spaceDescriptionSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(2000).optional()
);

/** Optional visual metadata (emoji/short label + hex color). No URLs. */
export const spaceIconSchema = z.string().trim().min(1).max(64).optional();

export const spaceColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #4F46E5")
  .optional();

export const createSpaceSchema = z
  .object({
    name: spaceNameSchema,
    description: spaceDescriptionSchema,
    icon: spaceIconSchema,
    color: spaceColorSchema,
  })
  .strict();

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

/**
 * Partial update; strict so unknown/system fields (ownerId, …) are
 * rejected rather than silently dropped.
 */
export const updateSpaceSchema = z
  .object({
    name: spaceNameSchema.optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable().optional()),
    icon: z.preprocess(emptyToNull, z.string().trim().min(1).max(64).nullable().optional()),
    color: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #4F46E5")
        .nullable()
        .optional()
    ),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projectNameSchema = z.string().trim().min(1).max(100);

export const projectDescriptionSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(2000).optional()
);

export const projectGoalSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(2000).optional()
);

export const projectStatusSchema = z.enum(["ACTIVE", "ARCHIVED", "COMPLETED"]);

export const createProjectSchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema,
    goal: projectGoalSchema,
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Partial update; strict so owner/space/system fields can never change. */
export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable().optional()),
    goal: z.preprocess(emptyToNull, z.string().trim().min(1).max(2000).nullable().optional()),
    status: projectStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ---------------------------------------------------------------------------
// List queries (pagination + lightweight search)
// ---------------------------------------------------------------------------

/** Search across names/descriptions via PostgreSQL `contains` (no engine). */
export const searchTermSchema = z.string().trim().min(1).max(100).optional();

export const spaceListQuerySchema = paginationSchema.extend({ q: searchTermSchema });

export type SpaceListQuery = z.infer<typeof spaceListQuerySchema>;

export const projectListQuerySchema = paginationSchema.extend({
  q: searchTermSchema,
  status: projectStatusSchema.optional(),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const spaceIdParamSchema = idParamSchema("spaceId");

export const projectIdParamSchema = idParamSchema("projectId");

// ---------------------------------------------------------------------------
// Retrieval (Prompt 7 — project-scoped hybrid search + reindex)
// ---------------------------------------------------------------------------

/**
 * Search request body. `query` is normalized server-side (whitespace
 * collapse, websearch_to_tsquery parsing) — never concatenated into SQL.
 * `limit` caps final ranked results; candidate counts come from server
 * config, not the client.
 */
export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    materialId: uuidSchema.optional(),
  })
  .strict();

export type SearchRequestInput = z.infer<typeof searchRequestSchema>;

export const materialIdParamSchema = idParamSchema("materialId");

/** Extracted-image access: both ids validated, ownership checked server-side. */
export const materialImageParamSchema = z.object({
  materialId: uuidSchema,
  imageId: uuidSchema,
});

/**
 * PDF upload metadata. The bytes travel as the raw request body
 * (`Content-Type: application/pdf`); the filename rides the query string
 * so no multipart parser is needed. Strict: nothing else is accepted.
 */
export const materialUploadQuerySchema = z
  .object({
    filename: materialFilenameSchema,
  })
  .strict();

export type MaterialUploadQuery = z.infer<typeof materialUploadQuerySchema>;

// ---------------------------------------------------------------------------
// Tutor (project-scoped RAG chat with evidence citations)
// ---------------------------------------------------------------------------

/**
 * Tutor ask body. `message` reuses the shared tutor ceiling (1–8000 chars);
 * `conversationId` continues an existing thread or is omitted to start one.
 * Strict: unknown keys (model overrides, temperatures, …) are rejected —
 * generation settings come from server config, never the client.
 */
export const tutorAskSchema = z
  .object({
    message: tutorMessageSchema,
    conversationId: uuidSchema.optional(),
  })
  .strict();

export type TutorAskInput = z.infer<typeof tutorAskSchema>;

export const conversationIdParamSchema = idParamSchema("conversationId");

/**
 * Nested conversation route: /api/projects/:projectId/conversations/:conversationId.
 * Both ids are validated as UUIDs; ownership of the pair is enforced
 * server-side (service returns 404 unless the conversation sits in an
 * owned project).
 */
export const projectConversationParamsSchema = z.object({
  projectId: uuidSchema,
  conversationId: uuidSchema,
});

export type ProjectConversationParams = z.infer<typeof projectConversationParamsSchema>;

// ---------------------------------------------------------------------------
// Quizzes + attempts + responses (adaptive assessment)
// ---------------------------------------------------------------------------

export const quizIdParamSchema = idParamSchema("quizId");

export const attemptIdParamSchema = idParamSchema("attemptId");

// ---------------------------------------------------------------------------
// Mastery / Growth / Recommendations (deterministic learning loop)
// ---------------------------------------------------------------------------

export const conceptIdParamSchema = idParamSchema("conceptId");

export const recommendationIdParamSchema = idParamSchema("recommendationId");

/**
 * Nested concept route: /api/projects/:projectId/concepts/:conceptId.
 * Ownership of the pair is enforced server-side (404 unless the concept
 * sits in an owned project).
 */
export const projectConceptParamsSchema = z.object({
  projectId: uuidSchema,
  conceptId: uuidSchema,
});

export type ProjectConceptParams = z.infer<typeof projectConceptParamsSchema>;

export const quizModeSchema = z.enum(["ADAPTIVE", "CONCEPT_FOCUS", "MIXED_REVIEW"]);

export const quizQuestionTypeSchema = z.enum(["MCQ", "OPEN_ENDED"]);

export const quizDifficultySchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]);

/**
 * Quiz creation body. Counts are bounded (1–20); generation settings live
 * in server config. `conceptIds` focuses CONCEPT_FOCUS mode on specific
 * concepts (must be non-empty when that mode is used); `typePreference`
 * biases generation without promising exact composition.
 */
export const createQuizSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    questionCount: z.coerce.number().int().min(1).max(20).default(10),
    mode: quizModeSchema.default("ADAPTIVE"),
    // HTML selects submit "" for "any" — absent, not a value.
    typePreference: z.preprocess(
      (v) => (v === "" ? undefined : v),
      quizQuestionTypeSchema.optional()
    ),
    difficulty: z.preprocess((v) => (v === "" ? undefined : v), quizDifficultySchema.optional()),
    conceptIds: z.array(uuidSchema).max(20).optional(),
  })
  .strict()
  .refine((v) => v.mode !== "CONCEPT_FOCUS" || (v.conceptIds && v.conceptIds.length > 0), {
    message: "CONCEPT_FOCUS mode requires at least one conceptId",
    path: ["conceptIds"],
  });

export type CreateQuizInput = z.infer<typeof createQuizSchema>;

/** Start (or resume) an attempt. `restart` forces a fresh attempt. */
export const startAttemptSchema = z.preprocess(
  (v) => (v === undefined || v === null ? {} : v),
  z
    .object({
      restart: z.boolean().optional(),
      idempotencyKey: z.string().trim().min(1).max(128).optional(),
    })
    .strict()
);

export type StartAttemptInput = z.infer<typeof startAttemptSchema>;

/**
 * Answer submission. Exactly one of `selectedOption` (MCQ) / `responseText`
 * (open-ended) must be present — the server decides which applies from the
 * question's stored type, never from a client-sent type flag.
 */
export const submitResponseSchema = z
  .object({
    questionId: uuidSchema,
    selectedOption: z.string().trim().min(1).max(2000).optional(),
    responseText: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .refine((v) => (v.selectedOption !== undefined) !== (v.responseText !== undefined), {
    message: "Provide exactly one of selectedOption or responseText",
  });

export type SubmitResponseInput = z.infer<typeof submitResponseSchema>;

/** Format a ZodError into a JSON-safe details payload for API responses. */
export function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Activity event types accepted in `activity_events.eventType`.
 * Mirrors ACTIVITY_EVENT_TYPES in `@ai-study-companion/shared` (single
 * source of truth) — a validated string, not a DB enum, so new product
 * events never require a migration.
 */
export const activityEventTypeSchema = z.enum(ACTIVITY_EVENT_TYPES);

export type ActivityEventTypeInput = z.infer<typeof activityEventTypeSchema>;

// ---------------------------------------------------------------------------
// Analytics (Prompt 11 — date ranges, filters, pagination)
// ---------------------------------------------------------------------------

/**
 * ISO date bounds for analytics queries. Both optional; service defaults
 * to the trailing 30 days. Coerced to Date, rejected when unparseable or
 * inverted (from > to). All aggregation is UTC internally; the frontend
 * converts display timestamps to the viewer's timezone.
 */
export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from must not be after to",
    path: ["from"],
  });

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

/** Project analytics query: range only (project comes from the path). */
export const projectAnalyticsQuerySchema = dateRangeSchema;

export type ProjectAnalyticsQuery = z.infer<typeof projectAnalyticsQuerySchema>;

/** Sort direction for admin event streams. */
export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

// ---------------------------------------------------------------------------
// Admin (Prompt 11 — server-side filtering + pagination)
// ---------------------------------------------------------------------------

export const adminIdParamSchema = idParamSchema("userId");

/** Paginated admin user list with optional search + role filter. */
export const adminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

/** Admin activity explorer: multi-axis server-side filtering. */
export const adminActivityQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: uuidSchema.optional(),
  eventType: activityEventTypeSchema.optional(),
  spaceId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  sort: sortDirectionSchema,
});

export type AdminActivityQuery = z.infer<typeof adminActivityQuerySchema>;

/** Admin AI usage explorer. */
export const adminAIUsageQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  feature: z
    .enum([
      "TUTOR",
      "QUIZ_GENERATION",
      "ASSESSMENT",
      "RECOMMENDATION",
      "EMBEDDING",
      "DOCUMENT_UNDERSTANDING",
      "EVALUATION",
    ])
    .optional(),
  provider: z.enum(["GROQ", "GEMINI", "SYSTEM"]).optional(),
  status: z.enum(["SUCCESS", "FAILED", "TIMEOUT"]).optional(),
  sort: sortDirectionSchema,
});

export type AdminAIUsageQuery = z.infer<typeof adminAIUsageQuerySchema>;

/** Admin AI evaluation explorer. */
export const adminAIEvaluationsQuerySchema = paginationSchema.extend({
  feature: z
    .enum([
      "TUTOR",
      "QUIZ_GENERATION",
      "ASSESSMENT",
      "RECOMMENDATION",
      "EMBEDDING",
      "DOCUMENT_UNDERSTANDING",
      "EVALUATION",
    ])
    .optional(),
  sort: sortDirectionSchema,
});

export type AdminAIEvaluationsQuery = z.infer<typeof adminAIEvaluationsQuerySchema>;

/** Admin background-job explorer (persisted DocumentJob rows). */
export const adminJobsQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  type: z.enum(["TEXT_EXTRACTION", "CHUNKING", "EMBEDDING", "FULL_INGEST"]).optional(),
  status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
  sort: sortDirectionSchema,
});

export type AdminJobsQuery = z.infer<typeof adminJobsQuerySchema>;

/** Admin spaces/projects lists (paginated, searchable). */
export const adminSpacesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
});

export type AdminSpacesQuery = z.infer<typeof adminSpacesQuerySchema>;

export const adminProjectsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
});

export type AdminProjectsQuery = z.infer<typeof adminProjectsQuerySchema>;
