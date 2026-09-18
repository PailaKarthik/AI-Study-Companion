# Deployment

Target state: **deployment-configured, verified locally, not yet
deployed to public URLs** (no deployment credentials are available in
this environment — see [Deployment Status](#deployment-status)).
Everything below is the exact procedure to deploy; builds and
migrations are verified locally.

## 1. Selected platforms and rationale

| Layer           | Choice                                         | Why                                                                                                                                                                       |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (Next.js)   | **Vercel**                                     | First-party Next.js hosting: `next build`/`next start` work unchanged, env vars per environment, no Docker needed.                                                        |
| API (Express)   | **Render** (Web Service, no Docker)            | Native Node runtime (`pnpm build` + `node dist/server.js`), honors `PORT`, free-tier friendly, no container config required.                                              |
| Worker (BullMQ) | **Render** (Background Worker, no Docker)      | Same repo, different start command (`node dist/worker.js`); independent process with its own env.                                                                         |
| Database        | **Neon PostgreSQL** (+ pgvector)               | Already the implementation target; pooled + direct URLs, branching for staging.                                                                                           |
| Redis           | **Upstash Redis** (TCP, TLS)                   | Already the implementation target; BullMQ requires TCP via ioredis (`rediss://`), not the REST client.                                                                    |
| Storage         | **Neon Object Storage** (S3-compatible bucket) | Branch-scoped bucket in the same Neon project — PDFs + extracted images as objects, PostgreSQL holds only metadata. Branch credential (`storage:read` + `storage:write`). |
| AI              | **Groq** (chat) + **Gemini** (embeddings)      | Unchanged.                                                                                                                                                                |
| Observability   | **Sentry** + structured pino logs              | Unchanged.                                                                                                                                                                |

No Kubernetes, no Docker images, no separate ML/analytics services —
three small processes (web, API, worker) plus managed services. Each
process builds from the same monorepo with its own install/build/start
commands (§10).

## 2. Architecture

```text
Browser ──HTTPS──▶ Next.js Web (Vercel)
                        │  NEXT_PUBLIC_API_URL + session cookie
                        ▼
                   Express API (Render) ──▶ Neon PostgreSQL + pgvector
                        │                         ▲
                        │ enqueue (BullMQ)        │ pgvector writes
                        ▼                         │
                   Upstash Redis ◀── Worker (Render)
                        │               │  PDF/OCR → chunks → Gemini
                        │               │  embeddings → pgvector
                        │               ▼
                        │          Neon Object Storage (bucket)

Tutor / Quiz / Assessment ──▶ Groq (server-side only)
Embeddings ──▶ Gemini (server/worker-side only)
Errors/logs ──▶ Sentry + platform logs
```

Paths:

- **Synchronous request path**: Browser → Web → API → PostgreSQL →
  response. Tutor answers, quiz generation/evaluation, search, and all
  CRUD are synchronous (bounded by timeouts; see `docs/RELIABILITY.md`).
- **Asynchronous background path**: API enqueues (`knowledge-*`,
  `ai-eval-*`) → Upstash Redis → Worker consumes → writes results to
  PostgreSQL. The browser never waits for processing; the UI polls
  material/quiz state.
- **AI path**: API/worker → Groq (tutor, question generation,
  open-ended grading) or Gemini (embeddings). Keys never leave the
  server. No AI call runs in the browser.
- **Retrieval path**: query → (Gemini embedding | skip) → PostgreSQL
  hybrid query (pgvector cosine + full-text, project-scoped in SQL) →
  bounded rerank → evidence.
- **Storage path**: browser → API (validated upload: MIME, magic
  bytes, size ceiling, checksum dedup) → bucket object → worker
  downloads bytes for extraction → pages/chunks/embeddings; downloads
  stream server-side after ownership checks.

`API process ≠ Worker process`: the API never executes long-running
PDF/AI jobs synchronously — it enqueues and returns 202/200. The
worker operates independently of any browser session.

## 3. Production environment variables

Conventions: `NEXT_PUBLIC_*` is inlined into browser JS at build time —
only values safe for browsers. Everything else is server-only.
`REQUIRED` = startup fails without it in production.

### Web (Vercel)

| Variable                                 | Scope        | Required | Notes                                                                                                        |
| ---------------------------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL`                    | browser-safe | REQUIRED | Deployed API origin, e.g. `https://api.example.com`. No trailing slash. Must NOT be localhost in production. |
| `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` | browser-safe | optional | Empty = Sentry disabled.                                                                                     |
| `SENTRY_TRACES_SAMPLE_RATE`              | browser-safe | optional | Default 0.1.                                                                                                 |

### API (Render web service)

| Variable                                                                             | Required     | Notes                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                | REQUIRED     | Enables all production guards.                                                                                                                        |
| `PORT`                                                                               | platform-set | Render injects it; the API listens on `config.PORT` (never hardcoded).                                                                                |
| `WEB_URL`                                                                            | REQUIRED     | Deployed web origin, e.g. `https://app.example.com`. Must not be localhost (startup fails otherwise).                                                 |
| `API_URL`                                                                            | REQUIRED     | Deployed API origin. Must not be localhost.                                                                                                           |
| `API_CORS_ORIGIN`                                                                    | REQUIRED     | Deployed web origin(s), comma-separated. `*` or invalid origins fail startup.                                                                         |
| `DATABASE_URL`                                                                       | REQUIRED     | Neon **pooled** connection string. Required in production (fail-fast; dev may boot degraded).                                                         |
| `DIRECT_URL`                                                                         | REQUIRED     | Neon **direct** (non-pooled) string for `migrate deploy` (DDL cannot run reliably on pooled connections).                                             |
| `SESSION_SECRET`                                                                     | REQUIRED     | 32+ unique random chars; placeholders fail startup. Generate: `openssl rand -base64 48`.                                                              |
| `SESSION_COOKIE_NAME`                                                                | optional     | Default `asc_session`.                                                                                                                                |
| `SESSION_TTL_DAYS`                                                                   | optional     | Default 7 (1–90).                                                                                                                                     |
| `SESSION_SAMESITE`                                                                   | optional     | `lax` default. Same-site deployments (see §7) keep `lax`.                                                                                             |
| `TRUST_PROXY_HOPS`                                                                   | optional     | Default 1. Must match the proxy chain in front of the API.                                                                                            |
| `GROQ_API_KEY`                                                                       | REQUIRED     | Without it tutoring/quiz generation 503s. Server-only.                                                                                                |
| `GROQ_CHAT_MODEL`                                                                    | optional     | Default `openai/gpt-oss-120b`.                                                                                                                        |
| `GEMINI_API_KEY`                                                                     | REQUIRED*    | *Required for semantic search/indexing; without it search degrades to lexical-only. Server-only.                                                      |
| `GEMINI_EMBEDDING_MODEL`                                                             | optional     | Default `gemini-embedding-001` (768 dims — must match `vector(768)`).                                                                                 |
| `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN`, or `REDIS_URL`                          | REQUIRED*    | *Required for document + knowledge processing; without it uploads stay QUEUED, reindex/reprocess 503, evaluation skips, rate limits run per-instance. |
| `STORAGE_PROVIDER`                                                                   | optional     | `neon` (default; Neon Object Storage bucket) or `memory` (explicit test-only double, refused in production).                                          |
| `STORAGE_BUCKET`                                                                     | REQUIRED     | Bucket name (e.g. `study-materials`; create via `neon buckets create`).                                                                               |
| `AWS_ENDPOINT_URL_S3` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | REQUIRED     | Branch storage credential (`storage:read` + `storage:write`); `neon deploy`/`neon env pull` writes these. Production boot fails fast when incomplete. |
| `STORAGE_MAX_UPLOAD_BYTES`                                                           | optional     | PDF size ceiling in bytes (1–50 MB, default 15 MB). Oversized uploads get a controlled 400.                                                           |
| `DOCUMENT_OCR_ENABLED` / `DOCUMENT_OCR_TEXT_THRESHOLD`                               | optional     | OCR fallback toggle (default on) + low-text page threshold in chars (default 50).                                                                     |
| `DOCUMENT_MAX_PAGES_PER_JOB` / `DOCUMENT_MAX_IMAGES_PER_MATERIAL`                    | optional     | Loud-failure caps (defaults 500 pages / 50 images).                                                                                                   |
| `TESSERACT_LANG_PATH`                                                                | optional     | Override for `<lang>.traineddata` dir; default is the vendored `apps/worker/assets/tessdata` (offline).                                               |
| `SENTRY_DSN`                                                                         | optional     | Empty = disabled. Server-only.                                                                                                                        |
| `SENTRY_ENVIRONMENT`                                                                 | optional     | Set to `production`.                                                                                                                                  |
| `LOG_LEVEL`                                                                          | optional     | `info` recommended (never `debug` in production).                                                                                                     |

Tuning variables (timeouts, weights, limits, chunking — see
`.env.example`) all have safe defaults; set only to override.

### Worker (Render background worker)

Same as API **minus** `PORT`, `WEB_URL`, `API_URL`, `API_CORS_ORIGIN`,
`SESSION_*`, rate-limit vars. **Plus**:

| Variable                            | Required         | Notes                                                                            |
| ----------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | REQUIRED         | Pooled string; worker fails fast in production without it.                       |
| `WORKER_CONCURRENCY`                | optional         | Default 2 (1–32). Jobs per queue worker. Keep 1–2 on 512 MB instances (see §14). |
| `REDIS_URL` / `UPSTASH_*`           | REQUIRED         | Worker refuses production boot without Redis.                                    |
| `GEMINI_API_KEY`                    | REQUIRED         | Embeddings happen in the worker.                                                 |
| `GROQ_API_KEY`                      | **not required** | The worker runs no LLM calls (evaluation is deterministic). Do not set it here.  |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | optional         | Worker initializes Sentry independently.                                         |

## 4. Startup validation (fail fast, no secret leaks)

Both API and worker validate env with Zod at import time and throw
before listening/consuming. Production (`NODE_ENV=production`)
additionally requires: `SESSION_SECRET` (32+, not placeholder),
`DATABASE_URL`, non-localhost `WEB_URL`/`API_URL`/`API_CORS_ORIGIN`,
and parseable CORS origins. Error messages name the variable, never
its value. Covered by `apps/api/src/config.test.ts`.

## 5. Web deployment (Vercel)

- Root directory: `apps/web` (or monorepo with Vercel's Turborepo
  settings). Install: `pnpm install`. Build: `pnpm --filter
@ai-study-companion/web build` (i.e. `next build`). Start: `next
start` (Vercel handles this).
- `NEXT_PUBLIC_API_URL` must be set at **build** time (inlined).
- `next/font/google` (Outfit) self-hosts at build; no runtime font CDN
  dependency. Static assets served by the platform CDN.
- All pages are client-rendered behind `RequireAuth`; no server-side
  secrets in the bundle (`NEXT_PUBLIC_*` allowlist audited — only the
  API URL and optional Sentry DSN).
- Responsive: verified layouts at desktop/tablet/mobile widths for
  home, spaces, project tabs, and admin (see `docs/RELIABILITY.md` for
  the one known squeeze: 90-day charts scroll horizontally by design).

## 6. API deployment (Render web service)

- Build: `pnpm --filter @ai-study-companion/api build` (`tsc -p
tsconfig.build.json`). Start: `node dist/server.js` (workspace deps
  are compiled into `dist` via project references — no repo copy
  needed beyond the pnpm workspace install).
- Listens on `process.env.PORT` via `config.PORT`. Health: `GET
/health` (liveness, always 200, no dependencies). Readiness: `GET
/ready` (200 `ready` / 503 `not-ready`; database pinged when
  configured, Redis reported as configured/unconfigured — never an
  expensive probe).
- CORS: exact origins from `API_CORS_ORIGIN` + `credentials: true`.
  Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax`,
  `Path=/`, 7-day `Max-Age`. Trust proxy set to `TRUST_PROXY_HOPS`.
- Graceful shutdown (`SIGTERM`/`SIGINT`): stop accepting → drain →
  close rate-limit Redis → close BullMQ queues → disconnect Prisma →
  exit (10s force-exit guard).
- Sentry initialized when `SENTRY_DSN` set; `beforeSend` strips auth
  headers, cookies, and user PII.

## 7. Worker deployment (Render background worker)

- Build: `pnpm --filter @ai-study-companion/worker build`. Start:
  `node dist/worker.js`. No HTTP port needed.
- Connects to Upstash Redis over TLS (`rediss://`) with
  `maxRetriesPerRequest: null` (required by BullMQ). Consumes
  `aistudy.system`, `aistudy.knowledge`, `aistudy.evaluations`.
- Concurrency: `WORKER_CONCURRENCY` (default 2) per queue worker.
- Retries: knowledge 5 attempts / evaluations 3, exponential backoff
  5s; unrecoverable conditions throw `UnrecoverableError` (no retry);
  exhaustion → `FAILED` persisted on `DocumentJob`.
- Graceful shutdown: stop accepting → close workers → close queue →
  disconnect Redis → disconnect Prisma → exit (15s force-exit guard).
  Active jobs redeliver via BullMQ lock expiry; processors are
  idempotent (deterministic jobIds + dedupe indexes).
- Health/heartbeat: no HTTP endpoint (background workers don't serve).
  Liveness = process up + recent `system.health` job completions;
  admin `GET /api/admin/system-health` and the jobs explorer surface
  `DocumentJob` history and failure rates from persisted rows.

## 8. Database (Neon) and migrations

- Two connection strings: `DATABASE_URL` (pooled, runtime) and
  `DIRECT_URL` (direct, migrations). Never run DDL on the pooled URL.
- Development: `prisma migrate dev` (creates + applies migration).
- Production: **only** `prisma migrate deploy` (applies pending,
  never generates, never resets). Order per release:
  1. Deploy code compatible with the migration (additive first).
  2. Run `prisma migrate deploy` against `DIRECT_URL`.
  3. Verify (`prisma migrate status`, spot-check tables).
  4. Start API → verify `/health` + `/ready`.
  5. Start worker → verify `system.health` completes.
  6. Verify frontend login → home.
- Seeds (`packages/db/src/seed.ts`) are development fixtures — **never
  run against production** (no seed step in any deploy command).
- Migration rollback: Prisma has no down-migrations. Roll forward with
  a compensating migration; the 0006 dedupe indexes use `IF NOT
EXISTS` and are safe to re-apply. Hand-managed SQL (pgvector/HNSW/
  FTS in 0000–0003) must be preserved verbatim — see
  `docs/DATABASE.md`; `migrate diff` output touching those objects
  must be stripped by hand.

### pgvector on Neon

- Extension enabled by migration 0000 (`CREATE EXTENSION IF NOT EXISTS
vector`). Neon supports pgvector natively — no extra dashboard step.
- `knowledge_chunks.embedding vector(768)` must match
  `GEMINI_EMBEDDING_MODEL` output width (asserted per response;
  mismatch fails loudly instead of corrupting the index).
- HNSW + FTS indexes are hand-managed raw SQL; deployment never
  recreates them (migrations are additive). Embeddings are never
  deleted except via material/project cascade — a deploy cannot wipe
  them.

### Backups / recovery

- Handled by Neon: point-in-time restore / branching per the Neon
  plan (not verified here — confirm retention in the Neon console for
  the chosen plan; do not claim a specific RPO).
- Application responsibilities: never `migrate reset` outside local
  dev; keep migrations additive; export critical user content before
  risky operations.
- Regenerable (re-materializable from sources): embeddings (re-embed
  chunks), knowledge chunks/pages (re-run worker on the stored PDF),
  analytics aggregates (recomputed from events), AI evaluations
  (re-enqueue). Primary state (treat as authoritative): users,
  sessions, spaces/projects, materials metadata, conversations +
  messages, quizzes + attempts + responses, mastery rows, activity
  events.

## 9. Redis / BullMQ production notes

- Queues (`aistudy.*` prefix): `system` (`system.health`),
  `documents` (`document.process`, deterministic id
  `document-<materialId>`, 5 attempts), `knowledge`
  (`knowledge.process`, deterministic id `knowledge-<materialId>`,
  3 attempts), `evaluations`
  (`ai.evaluate`, deterministic id `ai-eval-<type>-<id>`, 3 attempts).
  (BullMQ rejects `:` in custom ids — all deterministic ids use dashes.)
- TLS required for Upstash (`rediss://`); the API composes it from
  `UPSTASH_REDIS_URL` + token or takes `REDIS_URL` verbatim. No
  credentials in code or logs (presence-only reporting).
- Failed jobs stay in Redis (`removeOnFail: 500`) and on
  `DocumentJob.status=FAILED` — observable via BullMQ dashboard or
  `GET /api/admin/jobs`. No DLQ beyond BullMQ's failed set; exhaustion
  is terminal and visible.

## 10. Neon Object Storage notes

- Credentials: a branch credential with `storage:read` + `storage:write`
  scopes (Neon Console → branch → Credentials), exposed as
  `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION` plus `STORAGE_BUCKET`. Production API/worker boot fails
  fast when any of these is missing. Only `us-east-2`-style regional
  endpoints from `neon deploy`/`neon env pull` are used — never invented
  URLs. Docs: https://neon.com/docs/storage.
- Object-key strategy (isolation by construction):
  `users/<u>/spaces/<s>/projects/<p>/materials/<m>/original.pdf` and
  `…/materials/<m>/images/page-<n>-<hash>.png`. Keys embed only owned
  ids and are never client-supplied; every access re-verifies ownership
  server-side. Downloads stream server-side with checksum verification
  (`ETag`); there are no public objects (presigned URLs exist only as a
  provider capability, unused by current flows). Deletes remove
  metadata in-transaction, then bucket objects (tolerant of missing).
- Admin health probes storage reachability with one HEAD (never values).
- Limits: `STORAGE_MAX_UPLOAD_BYTES` (default 15 MB); bucket objects up
  to 5 GiB protocol-supported.
- Backfill (only for environments holding pre-0008 bytea bytes):
  `pnpm --filter @ai-study-companion/db backfill-blobs` BEFORE
  `migrate deploy` — uploads every `material_blobs.data` row to the
  bucket under the new key layout and repoints `storageKey`. Only then
  deploy 0008 (which drops the bytea column).

## 11. Domain configuration

All URLs are env vars — no domains hardcoded (only `localhost`
dev-defaults, which production refuses to boot with):

| Purpose | Variable                          | Example                   |
| ------- | --------------------------------- | ------------------------- |
| Web     | `WEB_URL` + `NEXT_PUBLIC_API_URL` | `https://app.example.com` |
| API     | `API_URL` + `API_CORS_ORIGIN`     | `https://api.example.com` |

Same-site deployment (API on subdomain or same domain via
reverse proxy) keeps `SESSION_SAMESITE=lax`. True cross-site
deployments need `SESSION_SAMESITE=none` (forces `Secure`) and the
frontend origin in `API_CORS_ORIGIN` — verify login end-to-end after
any domain change; never assume localhost cookie behavior transfers.

## 12. Deployment smoke test (post-deploy, in order)

1. Frontend loads (no console errors).
2. Register works → home loads.
3. Logout → login works.
4. Create space → create project.
5. Upload PDF → bucket object → `document.process` job queued →
   worker picks it up → text/OCR extraction → pages → chained
   knowledge job → chunks → embeddings → material READY. Verify it
   continues with the browser closed.
6. Tutor answers with citations; unsupported question gets the honest
   refusal.
7. Create quiz → answer MCQ + open-ended → complete → evaluation →
   mastery changes → growth updates → recommendation appears →
   analytics reflects activity.
8. Refresh throughout: state persists.
9. Logout; anonymous access redirects to login; foreign ids 404;
   non-admin gets no `/admin`.
10. `GET /health` 200, `GET /ready` ready, admin system-health shows
    database up + jobs flowing.

Do not mark deployment successful unless 1–10 pass. Recovery checks (provider outage, worker/API
restart, material retry) per `docs/RELIABILITY.md` — never destructive
injection against production data.

## 13. Deployment Status

**DEPLOYMENT CONFIGURED BUT NOT DEPLOYED.** No deployment credentials
or accounts are available in this environment, so no public URL is
claimed. All configuration, build/start commands, migration
procedures, and smoke tests above are prepared and locally verified
(builds pass, migrations apply, E2E passes against local services).

## 14. Free-tier 512 MB budget (Render free / equivalent)

Each free instance gets ~512 MB RAM. **Run three separate services —
never all three processes in one box.** Typical idle footprints:

| Service                           | Why it fits 512 MB                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web (Vercel or Render static)     | Next.js standalone; no PDF/AI libs in the bundle                                                                     |
| API (Render web service)          | Express + Prisma + BullMQ producers; no sharp/tesseract/pdfjs                                                        |
| Worker (Render background worker) | The heavy one: sharp (~30 MB native), pdfjs-dist, tesseract.js WASM + language data load **per job, on demand only** |

Rules that keep each process inside the budget:

1. **One service per instance.** `render.yaml` (repo root) declares exactly
   this split — deploy it as a Render Blueprint and set secrets per
   service in the dashboard (never in the YAML).
2. **Cap the Node heap** so the GC acts before the OOM killer does:
   prefix every start command with
   `NODE_OPTIONS=--max-old-space-size=384` (384 leaves headroom for
   native modules outside the V8 heap).
3. **Worker concurrency 1–2.** Default `WORKER_CONCURRENCY=2`; set `1`
   on 512 MB if large PDFs OOM. OCR runs serialized (one tesseract
   worker) and sharp decodes bounded image counts per job, so memory
   scales with concurrency — keep it low, let BullMQ queueing absorb
   bursts (upload → QUEUED → processed in turn; the UI polls).
4. **Install dev dependencies at build time.** Render sets
   `NODE_ENV=production`, which makes `pnpm install` skip dev-only
   packages — but the build needs the Prisma CLI (`prisma generate`,
   `migrate deploy`) and `typescript` (`tsc`), which are devDependencies
   by design. So every `render.yaml` build command starts with
   `pnpm install --frozen-lockfile --prod=false`. They cost disk, not
   RAM (Node only loads what `require`s at runtime), and unused Radix
   packages were still removed from `apps/web`.
5. **Sentry is optional.** Empty `SENTRY_DSN` disables it (saves
   ~20–30 MB resident). Keep it on for the API if you can afford it;
   first to drop on the worker if memory is tight.
6. **Free-tier sleeps.** Render free web services sleep after
   inactivity — first request wakes in ~30–60s. The worker (background)
   does not sleep on the free tier but shares the same Redis/DB.
   Neon free computes also suspend when idle; the first query wakes it
   (a retry succeeds — the API's 5xx path surfaces this honestly).

Suggested `render.yaml` values: API plan `free`, worker plan `free`,
health check path `/health` on the API only. See `render.yaml` at the
repo root.
