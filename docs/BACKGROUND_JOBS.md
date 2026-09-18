# Background jobs

Queues live in Redis (Upstash in production, any BullMQ-compatible Redis
locally). Queue names are prefixed `aistudy.*` (see
`QUEUE_NAMES` in `@ai-study-companion/config`).

## Queues

| Queue     | Name                | Jobs                | Producer                                              | Consumer |
| --------- | ------------------- | ------------------- | ----------------------------------------------------- | -------- |
| System    | `aistudy.system`    | `system.health`     | worker bootstrap self-test                            | worker   |
| Documents | `aistudy.documents` | `document.process`  | API upload endpoint + reprocess endpoint              | worker   |
| Knowledge | `aistudy.knowledge` | `knowledge.process` | API reindex endpoint + document worker chain on READY | worker   |

(`embeddings`, `quiz` names are reserved for their stages.)

## document.process

Payload: `{ materialId, correlationId, enqueuedAt, manual }` (Zod-validated
in the processor; invalid payloads fail fast).

- Policy: 5 attempts, exponential 5s backoff (matching
  `DocumentJob.maxAttempts`), capped completed/failed retention.
- Enqueue uses deterministic `jobId = document-<materialId>` so
  duplicate uploads, double-clicks, and retried requests collapse to
  one job in Redis.
- Transient failures (parse blips, OCR engine hiccups, DB deadlocks)
  rethrow for BullMQ retry; permanent ones (`UnrecoverableError`:
  missing material, missing blob, checksum mismatch, encrypted PDF,
  zero extractable text) stop immediately with material `FAILED` +
  `lastError`.
- Processor result (`DocumentProcessJobResult`) carries page/text/OCR/
  image counts + duration for operators.

## knowledge.process

Payload: `{ materialId, correlationId, enqueuedAt, manual }` (Zod-validated
in the processor; invalid payloads fail fast).

- Default policy: 3 attempts, exponential 5s backoff (shared
  `defaultJobOptions`), capped completed/failed retention.
- Enqueue uses deterministic `jobId = knowledge-<materialId>` so
  double-clicks and retried requests collapse to one job in Redis.
- Transient failures (provider 429/5xx, network, timeouts, material not
  yet READY) rethrow for BullMQ retry; permanent ones
  (`UnrecoverableError`: missing material, failed/empty documents,
  dimension mismatch, unconfigured credentials) stop immediately.
- Processor result (`KnowledgeProcessJobResult`) carries chunk/embedding
  counts + duration for operators.

## Local development

Redis on `localhost:6379` (plain `REDIS_URL=redis://localhost:6379`)
plus `DATABASE_URL` pointing at a migrated Postgres is enough to run
the full document loop: upload via the API, consume with
`pnpm dev:worker`. Without Redis the worker boots degraded (no queues
consumed) and uploads stay `QUEUED` with `enqueued: false` (retry via
reprocess once Redis is up); without `GEMINI_API_KEY` knowledge jobs
fail loudly with `UnrecoverableError` — use an injected mock provider
in tests instead of faking success.
