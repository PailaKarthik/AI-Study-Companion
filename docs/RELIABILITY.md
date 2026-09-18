# Reliability

How the AI Study Companion behaves under invalid input, duplicate
requests, retries, concurrency, failed externals, and restarts.
Written from the Prompt 12 hardening pass; every claim has a test or a
named honest limitation.

## 1. Retry policies

| Operation              | Policy                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Groq chat              | `TUTOR_MAX_ATTEMPTS` (2) / `QUIZ_LLM_MAX_ATTEMPTS` (2), exponential backoff, only on retryable statuses (408/429/5xx) + transport errors. Permanent 4xx, empty completions, schema failures abort immediately. |
| Gemini embeddings      | `EMBEDDING_MAX_ATTEMPTS` (4), same retryable-only rule.                                                                                                                                                        |
| Document enqueue       | `ENQUEUE_TIMEOUT_MS` (10s) — a stalled Redis becomes a deferred `QUEUED` (upload, recoverable via reprocess) or a 503 (reprocess/reindex), never a hang                                                        |     |
| BullMQ document jobs   | 5 attempts, exponential backoff 5s — matches `DocumentJob.maxAttempts` (schema default 5) so the durable row and the transport agree.                                                                          |
| BullMQ knowledge jobs  | 3 attempts, exponential backoff 5s (shared `defaultJobOptions`; durable row mirrored via `job-tracking.ts`).                                                                                                   |
| BullMQ evaluation jobs | 3 attempts, exponential backoff 5s (no durable row; processor skips existing).                                                                                                                                 |
| Tutor persist          | Up to 3 attempts on P2002 sequence race only, with a fresh max-sequence read per attempt.                                                                                                                      |
| Frontend queries       | Global retry-once, but ONLY for retryable failures (network/5xx/429 via `isRetryable`); 4xx never retries. Feature hooks needing stricter behavior set `retry: false`. Mutations never retry.                  |

No blind retries: invalid requests, validation failures, and
unrecoverable worker errors (`UnrecoverableError`) never requeue.

Rate-limit budgets are namespaced per limiter in Redis
(`ratelimit:<limiter>:<key>`): limiters sharing a key shape (global IP
vs register IP) increment separate counters, so ordinary traffic can
never burn the credential-endpoint budgets (regression covered in
`middleware/rateLimit.test.ts`).

## 2. Timeouts

| Call                      | Timeout                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Groq chat (tutor)         | `TUTOR_TIMEOUT_MS` (60s) via `AbortSignal.timeout`                                                                                                      |
| Groq chat (quiz LLM)      | `QUIZ_LLM_TIMEOUT_MS` (90s)                                                                                                                             |
| Gemini embeddings         | `EMBEDDING_TIMEOUT_MS` (30s)                                                                                                                            |
| Document enqueue          | `ENQUEUE_TIMEOUT_MS` (10s) — a stalled Redis becomes a deferred `QUEUED` (upload, recoverable via reprocess) or a 503 (reprocess/reindex), never a hang |
| Knowledge enqueue         | `ENQUEUE_TIMEOUT_MS` (10s) — a stalled Redis becomes a 503, never a hang                                                                                |
| Tutor persist transaction | 15s Prisma `timeout`                                                                                                                                    |

Timeouts are recorded as `AIUsageStatus.TIMEOUT`, never lumped into
`FAILED` (previously undercounted; fixed with `isTimeoutError` +
`hardening.test.ts`). Timeouts from providers are retryable; the client
sees 503 with a retry-safe message.

## 3. Idempotency (strategy per operation)

- **Activity events**: optional `idempotencyKey` (unique). `recordActivity`
  returns the existing row on conflict; `recordMany` uses
  `skipDuplicates` and reports `{ count, duplicatesSkipped }`.
- **Quiz attempt start**: client `idempotencyKey` (global unique).
  Replays return the winner's attempt; cross-user/cross-quiz replays get
  404 (never another user's attempt).
- **Quiz completion**: atomic claim (`updateMany … completedAt: null`).
  Exactly one twin completes; losers rebuild the result + reconcile
  mastery (same as idempotent re-complete). Completion activities carry
  per-attempt keys (`quiz-attempt-completed:<id>` etc.).
- **Mastery events**: DB-enforced partial unique index
  `mastery_events_source_dedupe_idx` on
  `(sourceType, sourceId, conceptId) WHERE sourceId IS NOT NULL`
  (migration 0006). Concurrent twins: loser catches P2002 → no-op.
  App-level `seen` check remains the fast path.
- **AI evaluations**: DB-enforced partial unique index
  `ai_evaluations_target_dedupe_idx` + deterministic BullMQ jobIds
  (`ai-eval-<type>-<id>`); processor maps P2002 → `skipped-existing`.
- **Knowledge jobs**: deterministic jobId (`knowledge-<materialId>`)
  collapses double-clicks/retries; `DocumentJob` upserted by `jobId`.
- **Tutor turns**: fail-closed (LLM runs before any write; failure
  persists nothing but `AIUsage` + `TUTOR_RESPONSE_FAILED` activity).
  Sequence races retry with fresh numbers (max 3).
- **Auth**: logout is idempotent (unknown tokens → 200 + cleared cookie).

## 4. Failure states (jobs)

`QUEUED → PROCESSING → COMPLETED | FAILED`. Unrecoverable conditions
(no DB/key, material gone, page limit, zero chunks, malformed job data)
throw `UnrecoverableError` (no retry); transient conditions retry with
backoff; attempts exhausted → `FAILED` with persisted error text.
`markJob*` transitions are log-guarded and never throw. The worker boot
self-test uses a deterministic jobId so autoscale boots collapse into
one health job.

Recovery expectations: a worker crash mid-job redelivers via BullMQ;
processing is idempotent (deterministic jobIds + dedupe indexes), so
redelivery never duplicates state. A browser closing never cancels
server-side processing.

## 5. External service failures

- **Groq/Gemini down or slow**: bounded attempts + timeouts → 503 with a
  safe message; `AIUsage` row (`FAILED`/`TIMEOUT`) + structured warn log;
  no partial persistence (tutor), answers preserved (quiz eval retry).
- **Redis down**: enqueue paths throw → 503 (materials) or best-effort
  skip (AI evaluation); rate limiting falls back to in-memory per key.
  The API boots without Redis (queue-gated paths 503); the worker
  refuses production boot without Redis, degrades visibly in dev.
- **Database down**: API throws 503 via `requireDb`; worker marks jobs
  failed (retryable) or `UnrecoverableError` when unconfigured.
- **Storage (Neon Object Storage bucket)**: bucket writes are
  checksum-bound (`ChecksumSHA256`); downloads re-verify SHA-256 and
  refuse mismatches loudly instead of serving corrupt bytes; missing
  objects resolve to honest 404s (re-upload), auth/permission failures
  throw permanent errors (never misread as missing files); deletes
  remove metadata first, then objects tolerantly, with orphan
  leftovers logged with keys.

Raw infrastructure errors never reach clients: the error boundary maps
known Prisma codes (P2002→409, P2025→404, P2003/P2014→400) and renders
generic 500s otherwise, with `requestId` correlation and dev-only
stacks.

## 6. Database transactions

Multi-step writes use short Prisma interactive transactions with NO
network/AI calls inside (LLM/embedding/enqueue always run before the
transaction opens). Ownership checks run inside the same transaction as
mutating Space/Project writes. The tutor persist transaction carries an
explicit 15s timeout.

## 7. Concurrency strategy

Unique constraints + idempotency keys + atomic conditional updates
(`updateMany … completedAt: null`), never in-memory locks (multi-process
unsafe). Proven by concurrency tests that caught real bugs during this
pass: `hardening.test.ts` (twin completions, twin tutor turns),
worker `processor.test.ts` (twin evaluations).

## 8. Resource limits

- JSON bodies: 1 MB. Tutor questions ≤8000 chars, quiz answers ≤8000,
  search ≤500 chars (Zod, client + server).
- Prompt bounds: evidence excerpts ≤1500 chars, history turns ≤2000
  chars, history depth `TUTOR_HISTORY_LIMIT` (20), retrieval
  `TUTOR_RETRIEVAL_LIMIT` (6) / `QUIZ_EVIDENCE_CHUNKS` (6) — all with
  explicit `[…truncated]` markers and untrusted-context framing.
- Reads: every list endpoint is paginated or take-capped (materials
  paginated; conversations ≤50; quizzes ≤50; concepts ≤100;
  conversation detail = most-recent 500 messages + `messagesTruncated`
  flag + true `messageCount`).
- Knowledge worker: `KNOWLEDGE_MAX_PAGES_PER_JOB` (500) fails loudly
  instead of truncating.
- Sessions: 20 active per user max (pruned on login) + expiry enforced
  server-side.
- Pagination: `pageSize` clamped to 100 (`parsePagination`); Zod
  validation rejects absurd values with 400 before any query runs.
- File uploads (`POST …/materials`): declared MIME allowlist +
  `%PDF-` magic bytes + `STORAGE_MAX_UPLOAD_BYTES` ceiling + filename
  sanitization + per-project checksum dedup + provider-neutral keys;
  failures store nothing (400 before any write).

## 9. Cache behavior

There is deliberately no Redis read cache yet (every search re-embeds +
reruns SQL; mastery/growth recompute per request). Query-cost control
comes from bounded takes, aggregation in PostgreSQL, and the prompt
bounds above — not from caching. When a cache is added, keys MUST
include `userId`/`projectId` scope (never global), carry TTLs, and
invalidate on mutation; TanStack client keys already encode scope
(`lib/query/keys.ts`, locked by `keys.test.ts`), and analytics ranges
are hour-truncated for stable keys (`lib/query/range.ts`).

## 10. Monitoring

Structured pino logs with `requestId` (+ `userId`/`projectId`/
`materialId`/`feature`/`jobId`/`provider`/`model`/`duration` where
relevant); 5xx → Sentry with `beforeSend` scrubbing (auth headers,
cookies, and user PII stripped — `scrubSentryEvent`, unit-tested).
Admin `/admin` explorers (activity, AI usage/evals, jobs, health) read
persisted rows only — no live-provider probing, no secrets in output.

## 10b. Measured API latency (local dev, honest numbers)

Measured 2026-09-17 against the tsx dev server + local pgvector test
DB, small project (medians, n=5): `/health` 2ms, `GET /api/spaces` 5ms,
project detail 14ms, project overview 15ms, project analytics 17ms,
home analytics 11ms, lexical search 8ms. These are smoke numbers, not
benchmarks: dev server, warm cache, tiny dataset, no AI calls. Tutor /
quiz-generation latency is dominated by Groq and was not measured
locally (no provider key in CI); retrieval latency under corpus scale
and analytics under large event tables remain to be profiled against
production-like data.

## 11. Known limitations (honest)

- Rate limiting degrades to per-instance when Redis is down.
- Worker liveness in admin health is inferred from recent job history.
- Unpriced models report null cost (never invented).
- `recordActivity`'s conflict fallback cannot run inside a caller
  transaction (aborted-tx reads fail); keyed writes in transactions are
  therefore claim-once by construction.
- Long tutor threads return the most-recent 500 messages (flagged).
- E2E runs the full journey against honest empty states; AI-dependent
  flows are proven by API suites with routed LLM stubs, not in the
  browser (no mock data in production code paths either way).
