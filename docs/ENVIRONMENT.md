# Environment

All variables live in `.env.example`. Copy to `.env` (root) and never commit the real file.
Web client variables additionally use `apps/web/.env.local` (see `apps/web/.env.example`).

## Browser boundary

Only `NEXT_PUBLIC_*` variables are inlined into browser JavaScript. The web app
reads exactly one: `NEXT_PUBLIC_API_URL`. These must NEVER be public:
`DATABASE_URL`, `DIRECT_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
`SESSION_SECRET`, `UPSTASH_REDIS_TOKEN`.
(No `NEXT_PUBLIC_` variable beyond the API URL exists in this repo — verified
by the no-mock/no-secret audit in the Prompt 4 report.)

| Variable                       | Used by              | Required at foundation?                             | Where to obtain                                                                                              |
| ------------------------------ | -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                     | all                  | No (defaults `development`)                         | `development` / `test` / `production`                                                                        |
| `WEB_URL`                      | api, docs            | No                                                  | Local frontend origin, default `http://localhost:3000`                                                       |
| `API_URL`                      | docs                 | No                                                  | Local API origin, default `http://localhost:4000`                                                            |
| `PORT`                         | api                  | No                                                  | API listen port, default `4000`                                                                              |
| `NEXT_PUBLIC_API_URL`          | web                  | No                                                  | Same as `API_URL`; set in `apps/web/.env.local`                                                              |
| `E2E_WITH_BACKEND`             | web e2e only         | No (gated specs skip without it)                    | Set to `1` to run the backend-backed flows (needs API + migrated DB; document-processing additionally needs a worker + Redis) |
| `PLAYWRIGHT_BASE_URL`          | web e2e only         | No (default `http://localhost:3000`)                | Override when the web server runs on another port                                                            |
| `DATABASE_URL`                 | api, db package      | No (foundation degrades)                            | Neon dashboard → connection string (pooled)                                                                  |
| `DIRECT_URL`                   | db package           | No                                                  | Neon dashboard → direct connection string (migrations)                                                       |
| `GROQ_API_KEY`                 | future AI service    | No                                                  | https://console.groq.com/keys                                                                                |
| `GEMINI_API_KEY`               | future embeddings    | No                                                  | https://aistudio.google.com/app/apikey                                                                       |
| `UPSTASH_REDIS_URL`            | worker, api (future) | No                                                  | https://console.upstash.com → Redis HTTPS endpoint                                                           |
| `UPSTASH_REDIS_TOKEN`          | worker, api (future) | No                                                  | Upstash console → Redis REST token (also used as TCP password)                                               |
| `REDIS_URL`                    | worker (preferred)   | No                                                  | `rediss://default:<token>@<host>:6379`; compose from the two Upstash values or copy the Upstash TCP endpoint |
| `STORAGE_PROVIDER`            | api, worker           | No (default `neon`)                             | `neon` (Neon Object Storage bucket) or `memory` (explicit test-only double, refused in production)              |
| `STORAGE_BUCKET`               | api, worker           | Yes for file ops (production boot fails without) | Bucket name, e.g. `study-materials` (`neon buckets create`)                                                     |
| `AWS_ENDPOINT_URL_S3`          | api, worker           | Yes for file ops (production boot fails without) | Branch S3 endpoint (`neon deploy` / `neon env pull` writes it)                                                  |
| `AWS_ACCESS_KEY_ID`            | api, worker           | Yes for file ops (production boot fails without) | Branch credential `token_id` (`storage:read` + `storage:write`)                                                 |
| `AWS_SECRET_ACCESS_KEY`        | api, worker           | Yes for file ops (production boot fails without) | Branch credential `s3_secret_access_key` (shown once — store immediately)                                       |
| `AWS_REGION`                   | api, worker           | No (default `us-east-2`)                        | Bucket region from the branch storage state                                                                     |
| `STORAGE_MAX_UPLOAD_BYTES`     | api                  | No (default `15728640` = 15 MB)                     | PDF size ceiling in bytes, `1048576`–`52428800`                                                                 |
| `DOCUMENT_OCR_ENABLED`         | worker               | No (default `true`)                                 | OCR fallback for image-only pages (`false` = record empty honestly)                                          |
| `DOCUMENT_OCR_TEXT_THRESHOLD`  | worker               | No (default `50`)                                   | Pages with fewer chars get OCR supplementation                                                               |
| `DOCUMENT_MAX_PAGES_PER_JOB`   | worker               | No (default `500`)                                  | Oversized documents fail loudly instead of truncating                                                        |
| `DOCUMENT_MAX_IMAGES_PER_MATERIAL` | worker           | No (default `50`)                                   | Embedded-image cap per material (overflow counts as skipped)                                                 |
| `TESSERACT_LANG_PATH`          | worker               | No (default: vendored `apps/worker/assets/tessdata`)| Override dir for `<lang>.traineddata`                                                                        |
| `SESSION_SECRET`               | api                  | Yes in production (boot fails on placeholder/short) | Generate 32+ random chars for production                                                                     |
| `SESSION_COOKIE_NAME`          | api                  | No (default `asc_session`)                          | Cookie name, `[A-Za-z0-9_-]{1,64}`                                                                           |
| `SESSION_TTL_DAYS`             | api                  | No (default `7`)                                    | `1`–`90`                                                                                                     |
| `SESSION_SAMESITE`             | api                  | No (default `lax`)                                  | `lax` / `strict` / `none` (`none` forces `Secure`)                                                           |
| `AUTH_REGISTER_RATE_LIMIT_MAX` | api                  | No (default `20`)                                   | Registrations per window per IP                                                                              |
| `AUTH_LOGIN_RATE_LIMIT_MAX`    | api                  | No (default `30`)                                   | Logins per window per IP                                                                                     |
| `AUTH_RATE_LIMIT_WINDOW_MS`    | api                  | No (default `900000`)                               | Rate-limit window in ms                                                                                      |
| `TEST_DATABASE_URL`            | api tests only       | No (integration suites skip without it)             | Throwaway Postgres+pgvector DB; must NEVER equal `DATABASE_URL`                                              |
| `SENTRY_DSN`                   | api, worker, web     | No (Sentry disabled when empty)                     | Sentry project → DSN                                                                                         |
| `SENTRY_ENVIRONMENT`           | all                  | No                                                  | e.g. `development`, `staging`, `production`                                                                  |
| `SENTRY_TRACES_SAMPLE_RATE`    | api, web             | No                                                  | `0`–`1`, default `0.1`                                                                                       |
| `LOG_LEVEL`                    | api, worker          | No                                                  | `debug` / `info` / `warn` / `error`                                                                          |
| `API_CORS_ORIGIN`              | api                  | No                                                  | Comma-separated allowed origins, default `http://localhost:3000`                                             |
| `WORKER_CONCURRENCY`           | worker               | No                                                  | `1`–`32`, default `5`                                                                                        |

## SDK-correct naming notes

- Upstash's `@upstash/redis` REST client uses `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN`, but **BullMQ cannot use the REST client** — it needs a
  persistent TCP connection via `ioredis`. This repo therefore standardizes on
  `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` (converted internally to
  `rediss://default:<token>@<host>:6379`) with an optional `REDIS_URL` override.
  See `docs/DEVELOPMENT_DECISIONS.md`.
- File storage (Neon Object Storage bucket) requires `STORAGE_BUCKET`
  plus the branch credential (`AWS_ENDPOINT_URL_S3`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`):
  create them via Neon Console → branch → Credentials (storage scopes)
  or `neon deploy` / `neon env pull`. PostgreSQL holds only metadata —
  PDF/image bytes are never stored in the database. `STORAGE_PROVIDER`
  selects `neon` (default, real bucket) or `memory` (explicit
  test-only double, refused in production).
