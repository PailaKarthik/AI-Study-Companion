# Analytics & Observability

Real persisted data only. Every number on every dashboard derives from
rows the application wrote while doing real work — activity events,
assessments, mastery rows, AI usage, evaluations, and job records.
Nothing is sampled, modeled, or invented.

## Event taxonomy

`ACTIVITY_EVENT_TYPES` (`packages/shared/src/db.ts`) is the single
source of truth, mirrored by `activityEventTypeSchema` in validation.
A type exists only if code emits it for a real action:

| Area        | Events                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | `USER_REGISTERED`, `USER_LOGIN`, `USER_LOGOUT`                                                                                               |
| Spaces      | `SPACE_CREATED/UPDATED/DELETED/VIEWED`                                                                                                       |
| Projects    | `PROJECT_CREATED/UPDATED/DELETED/VIEWED`                                                                                                     |
| Materials   | `MATERIAL_UPLOADED`, `MATERIAL_PROCESSING_STARTED/COMPLETED/FAILED`, `MATERIAL_RETRY_REQUESTED`                                              |
| Tutor       | `TUTOR_INTERACTION`, `TUTOR_CONVERSATION_CREATED`, `TUTOR_RESPONSE_FAILED`                                                                   |
| Quiz        | `QUIZ_CREATED/STARTED`, `QUIZ_ATTEMPT_STARTED`, `QUIZ_QUESTION_ANSWERED`, `QUIZ_ATTEMPT_COMPLETED`, `QUIZ_COMPLETED`, `OPEN_ENDED_EVALUATED` |
| Assessment  | `ASSESSMENT_STARTED`, `ASSESSMENT_COMPLETED`                                                                                                 |
| Mastery     | `MASTERY_UPDATED`, `CONCEPT_IMPROVED`, `CONCEPT_NEEDS_ATTENTION`                                                                             |
| Growth/recs | `GROWTH_ANALYZED`, `RECOMMENDATION_CREATED/COMPLETED/DISMISSED`                                                                              |
| Misc        | `PROJECT_ACTIVITY`                                                                                                                           |

Deliberately absent: material viewed/deleted (no such endpoints exist),
recommendation viewed/started (view tracking would be noise; completion
and dismissal are the meaningful transitions), per-stage job events
(`DocumentJob` rows carry that state — see below).

## Event lifecycle

All writes funnel through `activityService.recordActivity/recordMany`.
Callers verify ownership first (owned space/project/material loaders),
then record inside the business transaction so the write and its audit
trail commit atomically. View events (`SPACE_VIEWED`) are best-effort:
a logging failure warns but never fails the read.

## Idempotency

`activity_events.idempotencyKey` (nullable unique, migration 0005).
Retried operations pass deterministic keys (`quiz-completed:<attemptId>`,
`material-retry:<materialId>:<jobId>`, `tutor-response-failed:<requestId>`);
a key collision returns the existing row instead of duplicating. NULL
keys stay unlimited (Postgres treats NULLs as distinct). Job-level
dedup also exists in BullMQ (deterministic job ids) and mastery events
(source triple check).

## Metadata safety

`sanitizeMetadata` deep-scrubs a blocklist (password, token, secret,
apikey, authorization, cookie, session, …) to `[redacted]` with a warn
log. Structural rule: ids, counts, flags, and labels only — never raw
prompts, message content, or PII. Example shapes (tutor grounded +
citation count, quiz type/difficulty, job type/attempt) live in the
emitting services.

## Analytics calculations

- **Project analytics** (`GET /api/projects/:id/analytics`): counts via
  Prisma aggregates; activity series via one grouped
  `date_trunc('day')` query (zero-filled in JS over the validated range);
  mastery trend as daily mean `newScore` points only (no zero-fill —
  a day with no assessments has no average); streak from the distinct
  UTC date set (consecutive days ending today, else yesterday, else 0);
  distribution from current mastery bands.
- **Home analytics** (`GET /api/home/analytics`): same engine, user
  scope; "improving" counts concepts with positive mean event delta in
  range — a labeled proxy (full trend math runs per project on the
  growth board, never scanned system-wide).
- **Ranges**: `?from&to` ISO, default trailing 30 days, max 366 days,
  inverted/overlong/unparseable → 400. Aggregation is UTC internally;
  the frontend renders `toLocaleString` in viewer timezone.

## Project isolation

`getOwnedProjectOrThrow` gates every project analytics call; user-level
queries filter `userId`/`ownerId` on every table. Admin endpoints gate
on server-verified `role === ADMIN` (`requireAdmin`); the frontend
`RequireAdmin` guard is UX only.

## AI usage tracking

One writer (`recordAIUsage` in `@ai-study-companion/ai`) used by
embedding, tutor, and quiz recorders. Cost comes from one pricing table
(`pricing.ts`, USD per 1M tokens, review date published): unknown
models and missing tokens yield null cost — the system stays functional
and reports cost as unavailable. Failed calls still record rows (with
error text) so failure rates are real. Costs are estimates, labeled as
such end to end (`estimatedCostUsd`).

## AI evaluation

Deterministic evaluators (`apps/worker/src/jobs/ai-evaluation/`) score
persisted output only: tutor (groundedness, citation validity/coverage,
retrieval relevance, unsupported-answer handling), attempts
(correctness, relevance, concept coverage, reasoning, confidence),
quizzes (concept alignment, difficulty coverage, diversity, type
balance, adaptivity signals), recommendations (relevance,
actionability, alignment). Uncomputable metrics are null
(unavailable). Pipeline: API enqueues best-effort after persist
(`ai-eval-<type>-<id>` job ids); worker validates, skips existing rows
and missing targets, persists one `AIEvaluation`, retries transient
failures with backoff. Evaluation never enqueues further work.

## Job monitoring

`DocumentJob` rows are authoritative for history: API upserts on
enqueue (deterministic `knowledge-<materialId>`), worker transitions
PROCESSING → COMPLETED/FAILED with attempts, durations, and truncated
errors. Status writes never fail a job (logged instead) — completed
work is never thrown away over bookkeeping. BullMQ holds live queue
depth only. Admin aggregates derive failure rate and mean duration
from the persisted rows.

## Aggregation strategy

PostgreSQL does the math (`COUNT`, `AVG`, `SUM`, `GROUP BY`,
`date_trunc`, `DISTINCT` days). Bounded selects (`take: 10/15/20`) back
every list. No endpoint loads full tables into Node. New indexes
(§29): `activity_events(spaceId, createdAt)`,
`ai_usage(provider|status, createdAt)`,
`document_jobs(status, createdAt)`,
`mastery_events(sourceType, sourceId)` unique idempotency support,
`recommendations.updatedAt` lifecycle timestamp.

## Failure visibility (Sentry + structured logging)

Analytics failures need no separate integration: API 5xx responses flow
through the existing error boundary (`Sentry.captureException` with
`requestId`), and worker job failures capture with job context. New
structured logs use safe fields only (`requestId`, `userId`/`projectId`
where the row is user-scoped, `feature`, `eventType`, `jobType`,
`provider`, `model`, `duration`) — never passwords, cookies, auth
headers, API keys, session secrets, or raw prompts.

## Known limitations

- Worker liveness is inferred from recent job history (`unknown` when
  idle with no history — honest, not a fake "healthy").
- Redis/AI keys report presence, never live probes or values.
- Home "improving" is a mean-delta proxy (documented in the UI copy).
- Evaluation covers quality snapshots, not causal claims.


