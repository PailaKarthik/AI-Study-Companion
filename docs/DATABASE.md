# Database architecture

Neon PostgreSQL (+ pgvector) accessed exclusively through Prisma. The only
server-side consumers are `apps/api` and `apps/worker` via
`@ai-study-companion/db`.

```text
Next.js → Express API → services → Prisma → Neon PostgreSQL + pgvector
Worker  → Prisma ─────────────────────────↗
```

The browser must never import `@prisma/client` or `@ai-study-companion/db`.
Frontend-safe enum mirrors live in `@ai-study-companion/shared` (`src/db.ts`).

## 1. Entity relationships

```mermaid
erDiagram
  User ||--o{ Space : owns
  User ||--o{ Project : owns
  User ||--o{ Session : has
  Space ||--o{ Project : contains
  Project ||--o{ Material : has
  Project ||--o{ DocumentPage : has
  Project ||--o{ KnowledgeChunk : has
  Project ||--o{ Concept : has
  Project ||--o{ Conversation : has
  Project ||--o{ Quiz : has
  Project ||--o{ QuizAttempt : has
  Project ||--o{ ConceptMastery : has
  Project ||--o{ Recommendation : has
  Project ||--o{ ActivityEvent : logs
  Material ||--o{ DocumentJob : processed-by
  Material ||--o{ DocumentPage : extracted-to
  Material ||--o{ MaterialBlob : references-objects
  Material ||--o{ KnowledgeChunk : chunked-to
  DocumentPage ||--o{ KnowledgeChunk : sources
  Concept ||--o{ ConceptRelation : from
  Concept ||--o{ ConceptRelation : to
  Conversation ||--o{ Message : contains
  Message ||--o{ TutorEvidence : cites
  KnowledgeChunk ||--o{ TutorEvidence : evidences
  Quiz ||--o{ QuizQuestion : contains
  Quiz ||--o{ QuizAttempt : attempted-as
  QuizAttempt ||--o{ QuizResponse : answers
  QuizResponse ||--o| Assessment : evaluated-by
  User ||--o{ LearnerContext : remembers
  User ||--o{ ConceptMastery : tracks
  Concept ||--o{ ConceptMastery : measured-by
  ConceptMastery ||--o{ MasteryEvent : history
```

Core tables: `users`, `sessions`, `learner_contexts`, `spaces`, `projects`, `materials`,
`document_jobs`, `document_pages`, `knowledge_chunks`, `concepts`,
`concept_relations`, `conversations`, `messages`, `tutor_evidence`, `quizzes`,
`quiz_questions`, `quiz_attempts`, `quiz_responses`, `assessments`,
`concept_mastery`, `mastery_events`, `recommendations`, `activity_events`,
`ai_usage`, `ai_evaluations` (25 models — see
`packages/db/prisma/schema.prisma`).

Auth additions (Prompt 3, migration `0002_auth_sessions`): `users.passwordHash`
(nullable Argon2id hash) and `users.isActive` (admin kill-switch); new
`sessions` table storing only `HMAC-SHA256(token, SESSION_SECRET)` as
`tokenHash` (unique) plus `expiresAt`/`lastUsedAt`/`userAgent`/`ipAddress`,
indexed on `userId` and `expiresAt`, cascade-deleted with the user.

## 2. Project isolation strategy

Every project-owned row carries a `projectId`, and `Project` itself carries a
denormalized `ownerId` so the service layer can authorize in one lookup:

```text
authenticated user → owns Space → owns Project → may access resources
```

Rules for the next (auth) stage:

1. Load the `Space`/`Project` row first; check ownership with the pure
   helpers in `packages/db/src/isolation.ts` (`canAccessSpace`,
   `canAccessProject`, `canAccessProjectInSpace`).
2. Scope every downstream query with `projectId` (`projectScope()` helper) —
   never trust a bare `WHERE id = projectId` from route params.
3. `TutorEvidence` must never reference another project's chunk/material
   (`isSameProjectEvidence()` guard; enforced at the service layer).
4. Message `metadata` stores retrieval _params_ only, never full context.

## 3. Important indexes

- Ownership lookups: `spaces(ownerId)`, `projects(spaceId)`,
  `projects(ownerId)`, `projects(status)`, `projects(lastActivityAt)`.
- Hierarchy traversal: `materials(projectId)`, `concepts(projectId)`,
  `conversations(projectId, updatedAt)`, `quiz_attempts(userId, createdAt)`.
- Pipeline: `document_jobs(materialId, status)`, `materials(status)`,
  `materials(checksum)` (re-upload dedupe).
- Evidence: `tutor_evidence(messageId)`, `messages(conversationId)`.
- Analytics: composite `(userId, createdAt)` / `(projectId, createdAt)` /
  `(eventType, createdAt)` / `(spaceId, createdAt)` on `activity_events`;
  same user/project/feature pattern on `ai_usage` plus
  `(provider, createdAt)` / `(status, createdAt)` for ledger filters;
  `(conceptId, createdAt)` on `mastery_events`;
  `(status, createdAt)` on `document_jobs` for failure/duration scans.
- Uniqueness (also the idempotency backbone — see §7):
  `users(email)`, `spaces(ownerId, name)`, `projects(spaceId, name)`,
  `concepts(projectId, name)`, `document_pages(materialId, pageNumber)`,
  `knowledge_chunks(materialId, chunkIndex)`,
  `messages(conversationId, sequence)`,
  `quiz_responses(attemptId, questionId)`,
  `concept_mastery(userId, projectId, conceptId)`,
  `materials(storageKey)`, `material_blobs(storageKey)`,
  `document_jobs(jobId)`,
  `quiz_attempts(idempotencyKey)`, `assessments(responseId)`,
  `activity_events(idempotencyKey)` (nullable unique — NULLs unlimited).

## 4. pgvector strategy

- Prisma 5.22 has no native `vector` type → the column is declared as
  `Unsupported("vector(768)")` on `knowledge_chunks.embedding`
  (768 = Gemini `text-embedding-004` dimensions; also exported as
  `EMBEDDING_DIMENSIONS` from `@ai-study-companion/shared`).
- Never fake embeddings with JSON arrays.
- The extension (`CREATE EXTENSION IF NOT EXISTS "vector"`) and the HNSW
  cosine index (`knowledge_chunks_embedding_hnsw_idx`, `vector_cosine_ops`)
  are hand-written raw SQL in `0001_domain_foundation/migration.sql` because
  `prisma migrate diff` cannot emit them.
- HNSW (pgvector ≥ 0.7, provided by Neon) is preferred over IVFFLAT: no
  training step and better recall/latency. Fallback if HNSW is unavailable:
  `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`
  (requires table rows at build time).
- Changing embedding dimensions later requires a new migration that rewrites
  the column type (e.g. `ALTER TABLE ... ALTER COLUMN embedding TYPE
vector(3072)`); all rows must be re-embedded.

## 5. Migration strategy

- `0000_enable_pgvector` — extension only (Prompt 1).
- `0001_domain_foundation` — all enums, tables, FKs, indexes (generated via
  `prisma migrate diff --from-empty --to-schema-datamodel`, so SQL is
  guaranteed in sync with the schema; header/footer SQL added manually).
- Apply with `pnpm db:migrate` (`migrate dev`, needs `DIRECT_URL`) locally
  or `migrate:deploy` in CI/production. Never use `db push` as the permanent
  workflow — migrations are the source of truth.
- New model? Add to `schema.prisma`, run `migrate dev --name <change>`,
  review the SQL, keep raw-SQL additions (vector indexes) in the migration.

## 6. Seed strategy

- `packages/db/src/seed.ts`, wired as `prisma.seed` + `pnpm db:seed`.
- Dev-only data: 1 user, 2 spaces, 3 projects, 6 concepts, 2 material
  _metadata_ rows (no PDF bytes), 2 pages, 2 learner-context rows,
  2 mastery rows, 1 mastery event, 3 activity events, 2 recommendations.
- Deterministic UUIDs + insert-if-missing → safe to re-run (proven by
  `seed.test.ts` against a mock; run `pnpm db:seed` twice against Neon to
  confirm zero new rows).
- Never seeds conversations, quiz attempts, or assessments (would look like
  real AI behavior). Refuses production without `ALLOW_SEED_IN_PRODUCTION`.
- No secrets in seed data.

## 7. Idempotency strategy

Prefer unique constraints over a generic idempotency table:

| Operation           | Guarantee                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Material upload     | `storageKey` unique + `checksum` index (re-upload dedupes); blob `putBlob` is idempotent per key+checksum                |
| Document processing | `document_jobs.jobId` unique (BullMQ id); pages/chunks upsert on `(materialId, pageNumber)` / `(materialId, chunkIndex)` |
| Quiz submit         | `quiz_attempts.idempotencyKey` unique (client-generated per submit)                                                      |
| Quiz response save  | `(attemptId, questionId)` unique                                                                                         |
| Assessment          | `responseId` unique (one evaluation per response)                                                                        |
| Mastery write       | `(userId, projectId, conceptId)` unique + transactional update-then-log                                                  |
| Recommendation gen  | `evidence` JSON traces the causing event; dedupe by (project, concept, type, PENDING) at the service layer               |

## 8. Cascade / delete decisions

- Deleting a `Project` cascades to everything project-owned (materials,
  pages, chunks, concepts, conversations, messages, quizzes, attempts,
  mastery, recommendations). No orphaned rows by construction.
- Deleting a `Space` cascades to its projects (and transitively everything).
- Deleting a `User` cascades to owned spaces/projects/materials — **except**
  analytics/observability: `activity_events.userId` and `ai_usage.userId`
  are `SetNull` so aggregate history survives account deletion.
- `SetNull` (history-preserving) also applies to: chunk→page link,
  evidence→chunk link, quiz creator, question→concept, assessment→concept,
  recommendation→concept.
- `MasteryEvent` rows are append-only: inserted, never updated/deleted
  except via cascade when their concept/project/user is removed.

## 9. Trade-offs

- `ActivityEvent.eventType` is a validated string, not a DB enum: new
  product events ship without a migration (validated by Zod in
  `@ai-study-companion/validation`).
- `QuizResponse.userId` and polymorphic refs (`MasteryEvent.sourceId`,
  `AIEvaluation.targetType/targetId`) are intentionally FK-less scalars:
  they record _who/what_ without coupling delete graphs.
- `AIUsage.estimatedCost` is `Decimal(10,6)` computed server-side — never
  accepted from frontend input.
- `LearnerContext` is row-per-fact (not one JSON blob per user) so facts can
  be ranked, refreshed, expired, and project-scoped independently.
- `ConceptRelation` is a minimal edge table, not a knowledge graph.
- File bytes live in the Neon Object Storage bucket, not in
  PostgreSQL: `material_blobs` rows hold only metadata (bucket key,
  MIME, size, checksum, page, dimensions). The bucket is S3-compatible
  and branch-scoped with the database; metadata rows cascade-delete
  with the material while bucket objects are removed explicitly by the
  API (tolerant of already-missing keys). 15 MB default upload ceiling
  keeps single-request PUTs small; objects up to 5 GiB are protocol-
  supported.

## 10. Future feature mapping

- Tutor RAG → `knowledge_chunks` (HNSW cosine search) + `tutor_evidence`
  citations; context persisted in `learner_contexts`.
- Quiz engine → `quizzes`/`quiz_questions` generation, `quiz_attempts`/
  `quiz_responses` collection, `assessments` Groq evaluation.
- Growth analysis → `mastery_events` trend queries over
  `concept_mastery` snapshots.
- Recommendations → `recommendations` with `evidence` back-pointers.
- Admin/observability → `activity_events`, `ai_usage`, `ai_evaluations`.

## 11. Testing without production data

Destructive/live tests must never target the production Neon database.
`packages/db` ships offline-safe Vitest suites (isolation helpers,
pagination, schema-constraint contracts, seed idempotency on a mock).
Live constraint tests run only when `TEST_DATABASE_URL` points at a
throwaway branch/database — see `docs/DEVELOPMENT.md`.
