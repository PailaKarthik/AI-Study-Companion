# Development decisions

## Next.js (frontend)

Chosen for App Router React, first-class TypeScript, `next/font` (Outfit without
external CSS), and Vercel-friendly deployment while remaining API-agnostic (all data
flows through the Express API client, never Next.js route handlers for business logic).

## Express (backend)

Chosen over Hono because the team/PRD standardized on Express middleware semantics,
its mature ecosystem (helmet, cors, rate-limit, pino-http) and straightforward
Route → Controller → Service → Repository layering. Hono is explicitly out of scope.

## Prisma (ORM)

Typed client, migration workflow and Neon compatibility. Repositories are the only
layer allowed to touch Prisma. (Supabase client tooling is out of scope; Neon is the
PostgreSQL provider.)

## Neon PostgreSQL

Serverless PostgreSQL with pooling (`DATABASE_URL`) + direct (`DIRECT_URL`) connections
for migrations, plus first-class `pgvector` support for Gemini embedding similarity
search. No separate vector database (Pinecone out of scope) — vectors live beside
relational rows.

## pgvector

Keeps embeddings queryable with SQL (`<->`, `<=>`, HNSW/IVFFLAT indexes) inside the
primary database. Enabled now via migration `0000_enable_pgvector`; Prompt 2 adds
embedding tables using `Unsupported("vector(N)")` + raw index SQL because Prisma does
not natively model the `vector` type.

## Upstash Redis

Serverless Redis for BullMQ transport, future distributed rate limiting and caching.
Credentials degrade gracefully: nothing requires Redis to boot locally.

## BullMQ (background processing)

Mature Redis-backed job queues with retries, backoff, priorities and observability —
a better fit than ad-hoc pub/sub for document ingestion, embeddings and quiz jobs.

### BullMQ / Upstash compatibility (important)

BullMQ executes Lua scripts and blocking commands, so it requires a **persistent TCP
Redis connection**. The `@upstash/redis` HTTP/REST client is **incompatible** with
BullMQ. Verified approach implemented in `apps/worker/src/lib/redis.ts`:

- Use **`ioredis`** pointed at the Upstash **TCP endpoint** (`rediss://…:6379`), not the
  HTTPS REST endpoint.
- **Mandatory:** `maxRetriesPerRequest: null` (BullMQ ≥ 5 requirement for blocking
  commands). Without it, BullMQ throws at startup.
- TLS is on (`rediss://`); `enableReadyCheck: false` + `lazyConnect: true` keep boot
  controlled and testable.
- Credential shapes supported: preferred `REDIS_URL=rediss://default:<token>@<host>:6379`;
  fallback composes it from `UPSTASH_REDIS_URL` (https host) + `UPSTASH_REDIS_TOKEN`.
- No credentials → worker boots in degraded mode (no queues consumed) instead of crashing;
  unit tests cover URL resolution, option shape and the `system.health` processor with
  zero external services.

Installed versions at foundation: `bullmq@^5`, `ioredis@^5` (peer-compatible pair).

## Groq (LLM generation)

Fast inference API for tutor responses, quiz generation and summarization. Called from
worker/AI services only — never directly from the browser. Key: `GROQ_API_KEY`.

## Google Gemini (embeddings)

`gemini-embedding-001` with explicit `outputDimensionality: 768` produces the
vectors stored in pgvector for grounded retrieval (768 keeps the existing
`vector(768)` column + HNSW index valid; any width mismatch fails loudly via
`EmbeddingDimensionError` instead of persisting). Key: `GEMINI_API_KEY`.
LLM generation stays on Groq; Gemini is embeddings-only. Called from
worker/AI services only — never directly from the browser.

## Neon Object Storage (file storage — replaces Cloudflare R2 and the interim bytea store)

> Historical note: R2 was originally specified (S3-compatible, presigned
> URLs) but never built. An interim PostgreSQL bytea store
> (`material_blobs.data`, migration 0007) carried the pipeline until
> Neon launched S3-compatible Object Storage — verified at
> https://neon.com/docs/storage — at which point all bytes moved to a
> branch-scoped bucket (migration 0008 drops the bytea column).
> Integration uses the standard `@aws-sdk/client-s3` pointed at the
> branch endpoint (`AWS_ENDPOINT_URL_S3`, `forcePathStyle: true`,
> `requestChecksumCalculation: WHEN_REQUIRED`) with a branch credential
> (`storage:read` + `storage:write` → `AWS_ACCESS_KEY_ID` /
> `AWS_SECRET_ACCESS_KEY`). Uploads are capped by
> `STORAGE_MAX_UPLOAD_BYTES` (default 15 MB); keys isolate by ownership
> (`users/<u>/spaces/<s>/projects/<p>/materials/<m>/…`) with the backend
> recorded on `Material.storageProvider` (`NEON_OBJECT_STORAGE`).
> PostgreSQL holds only metadata — never bytes, base64, or JSON blobs.

## Document pipeline libraries (pdfjs-dist + tesseract.js + sharp)

`pdfjs-dist` (legacy build, headless — no canvas) parses PDFs and
resolves embedded image XObjects; `sharp` converts raw pixels to PNG
in memory; `tesseract.js` OCRs low-text pages over their own embedded
images. No page rasterization, no temp files (all buffers in memory),
no image bytes in pgvector, no auto-generated image descriptions.
Tesseract language data is vendored
(`apps/worker/assets/tessdata/eng.traineddata`, English-only,
offline); `TESSERACT_LANG_PATH` points at a custom install when
needed. Scanned PDFs without embedded images yield no text — an
honest `FAILED`, never fabricated content. Caps
(`DOCUMENT_MAX_PAGES_PER_JOB`, `DOCUMENT_MAX_IMAGES_PER_MATERIAL`)
fail loudly instead of silently truncating.

## Rate limiting foundation

`express-rate-limit` with in-memory store at foundation (generous limits, higher in
dev/test) so local development never depends on Redis. A distributed Upstash-backed
store can replace it later behind the same `rateLimiterMiddleware` interface.

## Logging

`pino` + `pino-http` structured JSON logs with redaction lists; Sentry for error
tracking (optional DSN). No `console.log` in app paths; no secrets/bodies/PDF text in logs.

## Testing

Vitest for unit/integration (API health + error model, worker infra, shared validation,
web API-client helpers, web lib helpers: query keys, auth status, HTTP-status mapping,
toast store, nav config); Playwright for E2E — backend-independent auth-UI specs plus
a backend-gated authenticated shell flow (register → dashboard → tabs → logout).
No fake feature tests.

### Database testing without production data (Prompt 2)

`packages/db` ships offline-safe Vitest suites: isolation-helper behavior
(User A vs User B), pagination, static schema-constraint contracts (mastery
uniqueness, page/chunk idempotency keys, pgvector shape), and seed
idempotency against a mock. Live constraint tests require `TEST_DATABASE_URL`
pointing at a throwaway Neon branch — destructive tests never target
production. See `docs/DATABASE.md §11`.

## Database foundation decisions (Prompt 2)

### LearnerContext: normalized row-per-fact

Chosen over one JSON blob per user so individual facts carry `type`,
`importance`, `lastUsedAt` and optional `projectId` scope — rankable,
refreshable, expirable, and queryable per project. Free-form detail still
lives in `content` + `metadata` where flexibility is genuine; everything
else stays relational.

### pgvector dimension 768

Gemini `text-embedding-004` outputs 768 dimensions, so
`knowledge_chunks.embedding` is `vector(768)` (single source of truth:
`EMBEDDING_DIMENSIONS` in `@ai-study-companion/shared`). The earlier
foundation note mentioning 1536 (an OpenAI dimension) is superseded.

### Idempotency via unique constraints, not a generic table

A blanket idempotency table hides domain semantics; per-operation unique
keys (`storageKey`, `jobId`, `(materialId, pageNumber)`,
`(materialId, chunkIndex)`, `idempotencyKey`, `(attemptId, questionId)`,
`(userId, projectId, conceptId)`) enforce safety at the storage layer where
retries and double-submits actually collide. Full mapping in
`docs/DATABASE.md §7`.

### Denormalized ownership + SetNull analytics

`Project.ownerId` is denormalized so authorization is a single-row check;
audit rows (`activity_events`, `ai_usage`) use `SetNull` on user delete so
analytics survive account deletion while owned learning data cascades away.

## Authentication decisions (Prompt 3)

### Custom server sessions, not a provider

Better Auth / Supabase / Firebase are out per constraints. Chose opaque
server sessions (HMAC-hashed in Postgres) over JWTs: instant revocation,
no client-side token handling, and expiry/active checks on every request.
Cost: a DB lookup per request (indexed `tokenHash`, acceptable).

### Token-HMAC storage

Raw session tokens never touch the DB — only `HMAC-SHA256(token,
SESSION_SECRET)`. A database leak alone yields no usable cookies, and
rotating `SESSION_SECRET` (with re-login) invalidates everything.

### Argon2id over bcrypt

Prompt-preferred and memory-hard; the `argon2` package built cleanly on
Windows/Node 24, so the `bcryptjs` fallback wasn't needed.

### Flat API structure, not modules/

The prompt suggested `modules/auth/` but the repo's established convention
is flat `controllers/ routes/ services/ repositories/ middleware/` dirs —
reused as-is; auth files live alongside (`authController.ts`,
`authService.ts`, `userRepository.ts`, …).

### Test DB via local pgvector container (tooling only)

No Neon credentials exist in this environment, so integration tests run
against a throwaway `pgvector/pgvector:pg16` container via
`TEST_DATABASE_URL` (fail-fast guard against `== DATABASE_URL`, serial
vitest forks, per-test truncate). Docker is test tooling only — not project
infrastructure. Same migrations apply to Neon unchanged.

## Frontend shell decisions (Prompt 4)

### Figma as visual reference only (not fetched live)

The Figma Make URL could not be retrieved in this environment (no browsing
capability), so the visual language was implemented from the prompt's
written spec — calm, spacious learning workspace; Outfit; semantic shadcn
tokens; restrained motion — rather than copied markup. No mock business
logic was ported: every section renders loading/empty/error states over
real (currently empty) state.

### Flat routes kept, no route groups

The prompt sketched `(auth)`/`(app)` groups, but the existing flat routes
already produce the required URLs. Regrouping would churn every page for
zero user-visible benefit, so flat structure stays; the decision is
revisited only if layouts genuinely diverge per section.

### Custom toast + drawer instead of new Radix packages

`sonner` and `@radix-ui/react-toast`/`react-sheet` were deliberately not
installed. The toast is a ~90-line dependency-free external store
(`lib/toast.ts`, fully unit-tested) with a framer-motion viewport; the
mobile drawer reuses AnimatePresence with Escape/scroll-lock/aria-modal.
One nav config drives both desktop sidebar and drawer — a single system,
two presentations.

### URL-driven project tabs

Active tab lives in `?tab=` (validated, defaults to Overview) so refresh
and shared links preserve the section. Local-only tab state was rejected
for exactly that reason.

### Empty states over skeletons for missing features

Sections whose APIs don't exist yet render deliberate empty states with
product copy — never spinners that spin forever, and never fabricated
progress numbers. Skeletons are reserved for genuine in-flight requests.

### E2E split by backend need

`auth-ui.spec.ts` is backend-independent (redirects, validation, error
alert); `shell.spec.ts` runs the full register→dashboard→logout flow but
skips without `E2E_WITH_BACKEND=1` + API + migrated DB, so CI stays green
without infrastructure.

## Spaces / Projects / Home decisions (Prompt 5)

### Flat module files, matching repo convention

The prompt sketched `spaces/{routes,controller,service,schemas,types}.ts`
folders; the repo convention is flat `routes/spacesRoutes.ts`,
`controllers/spacesController.ts`, `services/spacesService.ts` with schemas
in `@ai-study-companion/validation` and types in `@ai-study-companion/shared`
— reused as-is, consistent with the Prompt 3 auth decision.

### Ownership encoded in queries, 404s without oracles

`findFirst({ id, ownerId })` instead of fetch-then-check, so there is no
window for an IDOR slip; missing and foreign ids produce byte-identical 404
bodies (asserted in tests). Malformed UUIDs are 400 via the shared
`validateParams` middleware — format errors leak nothing about existence.

### Transactions for mutation + audit, except view tracking

Create/update/delete run the row write and its `ActivityEvent` in one
Prisma transaction. `GET project` view-tracking (touch + `PROJECT_VIEWED`)
runs in a separate transaction whose failure is logged and swallowed, so a
failing audit write can never break dashboard reads.

### Progress as nullable average, attention threshold 0.7

No invented percentages: `average` is the mean `masteryScore` or `null`
when unassessed; "requiring attention" means assessed (`evidenceCount > 0`)
and scoring under 0.7 (`ATTENTION_THRESHOLD`), lowest first, max 5. Both
are documented heuristics pending real Growth Analysis — a high-scoring
concept must never appear as a weakness.

### Home as one aggregation endpoint

`GET /api/home` does ~10 bounded reads in a single `Promise.all`
(select-only, indexed) instead of five chatty endpoints — one round trip
for the dashboard, no histories or document contents loaded.

### Query-param tabs preserved over nested routes

The prompt's `/projects/:id/materials` example was considered, but the
Prompt 4 `?tab=` design already preserves refresh/shared links with zero
churn, so it stays. Nested routes arrive only if a tab ever needs its own
server layout.

### No optimistic creation/deletion

Mutations follow submit → API → database → invalidate/refetch; dialogs
close only on success. Skeletons cover loads, toasts confirm outcomes.

## Knowledge / retrieval decisions (Prompt 7)

### No Elasticsearch, no vector sidecar — ever

Elasticsearch/OpenSearch/Pinecone/Weaviate/Qdrant/Milvus/Typesense/Algolia/
Meilisearch are all explicitly out: PostgreSQL already provides both halves
of hybrid retrieval natively (FTS `tsvector` + GIN for keywords, pgvector +
HNSW for semantics). One store to operate, back up, and scale. A dedicated
search service remains a documented future high-scale option, not current
architecture.

### Separate knowledge lifecycle from document lifecycle

`Material.knowledgeStatus` (`NOT_STARTED/QUEUED/PROCESSING/READY/FAILED`)
is independent of `MaterialStatus` because they fail independently: a PDF
can be perfectly readable while its index is still building or failed.
Embedding failures must never mark a valid document failed.

### Page-scoped, deterministic chunks

Chunks never span pages (every chunk cites exactly one page — citation
clarity beats cross-page context windows at prototype scale), packing is
greedy to ~700 tokens with ~100 overlap, tokens approximated as chars/4
(no tokenizer dependency in the worker). Same pages + same options ⇒
byte-identical output, which is what makes content-hash idempotency sound.

### Upsert + hash-skip + transactional rebuild

Reprocessing upserts on `(materialId, chunkIndex)`, skips embedding when
the stored hash matches and a vector exists, and deletes stale indexes
plus flips to READY in one final transaction. Existing knowledge stays
readable until the replacement commits — reindex never deletes first.

### Lexical-always, semantic-best-effort search

FTS runs unconditionally; the semantic path degrades to lexical-only when
no key is configured or the call fails. Search never 500s because
embeddings are unavailable. Empty corpus ⇒ `results: []`, never invented
evidence — the future Tutor keys its "not in your materials" behavior
off exactly this.

### No query-embedding cache yet

The API owns no Redis client and prototype query volume doesn't justify
adding one for a single cheap call per search. Revisit with usage data.

### Test seams are explicit, not hidden

`__setSearchEmbedderForTests` (API) and provider injection (services)
are documented test-only hooks. Gemini itself is unit-tested with mocked
fetch; no real API key is ever required to run the suite.

## Tutor chat loop (RAG with evidence citations)

### Retrieval-before-write atomicity

`askTutor` runs search + Groq generation BEFORE any write, then persists
the user message, assistant message, and TutorEvidence rows in one
Prisma transaction. A failed LLM call leaves no dangling user message —
the client retries the whole turn. Message `metadata` stores only the
model, latency, and counts — never the retrieved context.

### Citations are retrieval rows, not model output

`citationLabel` (`Material.pdf — Page N`) is computed server-side from
the retrieval result that produced the evidence row. The model is
instructed to emit `[n]` markers, but the UI's source list comes from
the persisted TutorEvidence rows, so citations can never point at
chunks from another project — retrieval itself is project-scoped SQL.

### No-evidence honesty is a prompt contract + a flag

An empty corpus calls the model with the no-evidence system prompt
("say you could not find relevant material, do not invent") and the
response carries `grounded: false` so the UI can add its own honest
notice. Zero TutorEvidence rows persist in that case.

### Keyless tutor is 503, not a fake answer

Unlike search (lexical-only degradation), the tutor has no meaningful
mode without an LLM, so a missing GROQ_API_KEY returns
SERVICE_UNAVAILABLE with an actionable message. The mock chat provider
exists for tests only and records AIUsage as provider SYSTEM.

## Adaptive quizzes (Prompt 9)

### Flat services, not modules/quizzes/

The prompt suggested `apps/api/src/modules/quizzes/`; the repo's
established convention is flat `services/` + `controllers/` + `routes/`
(Route → Controller → Service). Quiz code follows the repo (`quizService`,
`quizAdaptive`, `questionGenerator`, `quizEvaluation`,
`conceptExtraction`, `quizLlm`) — consistency with the codebase beats
consistency with the prompt's sketch.

### No migration: the schema already covered the domain

`QuizQuestion.metadata` carries rubric key points + source refs,
`QuizResponse.metadata` carries the evaluation state machine,
`Assessment.evaluatorMetadata` carries misconceptions/confidence, and
`QuizAttempt.metadata` carries the completion aggregate. Difficulty reuses
`ConceptDifficulty`; new activity events are validated strings. Nothing
to migrate.

### Selector over naive staircases

Fixed five-signal weights, aggregate-evidence difficulty, round-robin
diversity, deterministic ties, and `reasons[]` per target for
explainability. Unknown concepts get a documented neutral prior — the
code path literally cannot produce a mastery percentage.

### Answer keys are a serving rule, not just an omission

Sanitization is centralized in `toSafeQuestion`/`toAttemptState`: detail
and unanswered questions never include `correctAnswer`/`explanation`;
answered ones do (feedback needs the why). Integration tests assert on
the serialized JSON.

### Evaluation failures are states, not verdicts

`EVALUATION_FAILED` preserves the answer and retries on identical
resubmission; completion gates on resolved evaluations. The answer and
its judgment have independent lifecycles — a principle Prompt 10's
mastery engine will rely on.

## Prompt 11 — analytics, admin, AI observability

### Taxonomy discipline over coverage theater

`ACTIVITY_EVENT_TYPES` only gains types the code actually emits.
Material viewed/deleted and recommendation viewed/started were cut:
no such endpoints or tracking exist, and view-rows would be noise.
`DocumentJob` was dormant (nothing wrote it) — instead of documenting
around the gap, the API now upserts rows at enqueue and the worker
transitions them, making the model genuinely authoritative for history.

### Aggregation in PostgreSQL, honesty at the edges

Counts, averages, and `date_trunc` buckets run server-side; activity
series zero-fill (counts exist per bucket), but mastery trend renders
points only (a day with no assessments has no average — fabricating one
would be fake data). Worker liveness reports `unknown` when idle without
history rather than a comforting "healthy". Unpriced models yield null
cost, never invented numbers.

### Deterministic evaluation instead of LLM-judged-LLM

Quality evaluators are pure functions over persisted rows (marker
resolution, stored scores, FK existence). No second model call means no
cost, no latency on UX, no infinite loops — and `null` for anything not
computable. The BullMQ pipeline exists for durability/scale, not for
intelligence.

### Admin is authorization, not obscurity

`requireAdmin` (server-verified role) gates every `/api/admin/*` route;
`RequireAdmin` only improves UX. Tests hit all eleven routes as USER
(403), logged-out (401), and ADMIN (200). User payloads select safe
columns explicitly — password hashes and tokens cannot leak through a
future `select: *` refactor because no such select exists.

## What was deliberately NOT used

Hono, Supabase, Better Auth, Firebase Auth, Pinecone, Python ML service, Docker
(as project infrastructure — a local container is test tooling only, see above),
Kubernetes, microservices — per PRD constraints.

## Prompt 12 hardening (production-readiness pass)

### Constraints over application checks for race invariants

Concurrent quiz completions and mastery writes passed code review (the
app-level `seen` checks looked airtight) but a real two-request race
test proved otherwise: twins collided on per-attempt activity keys and
one died with a 500 from an aborted-transaction follow-up read. The fix
is layered — atomic conditional claim (`updateMany … completedAt: null`)
for completion, partial unique indexes (migration 0006) for mastery
events and AI evaluations, P2002-aware writers everywhere — with the
concurrency tests kept as regression guards. Lesson recorded: any
"check-then-insert" without a backing constraint gets a race test, and
the test must assert both HTTP outcomes, not just final counts.

### Redis-backed limits that degrade instead of dying

Rate limiting uses Redis fixed-window counters when configured and
per-key in-memory fallback otherwise (plus per-email login keys). The
alternative — hard dependency on Redis — would turn a cache outage into
an auth outage; the other alternative — pure in-memory — silently stops
working the day a second replica boots. Degradation is logged once, not
per request.

### No silent truncation anywhere

Every bound introduced in this pass is either client-visible (paginated
envelopes, `messagesTruncated` + true counts, `[…truncated]` prompt
markers, `duplicatesSkipped` counts) or documented (`docs/RELIABILITY.md`
§11). Silent `take:` caps and swallowed conflicts were treated as bugs,
not optimizations.

### Timeouts are a status, not a failure mode

Lumping timeouts into `FAILED` made timeout analytics structurally
undercount. `isTimeoutError` + `TIMEOUT` status applies the same lesson
as the honesty rules elsewhere: the system must be able to say what
actually happened (timed out vs failed vs refused) or operators cannot
reason about it.
