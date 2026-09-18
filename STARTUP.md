# STARTUP — run AI Study Companion locally

All commands run from the repo root (`AiProf-study-companion/`) in
PowerShell. Verified end-to-end on Windows + Node v24 + pnpm 9.

## 0. Prerequisites

- **Node.js ≥ 20** (`node --version`) and **pnpm ≥ 9** (`pnpm --version`).
  This repo pins `pnpm@9.15.9` (`packageManager` field); Corepack or a
  global pnpm install both work.
- Network access to: **Neon PostgreSQL** (database), **Upstash Redis**
  (job queue), **Neon Object Storage** (PDF/image bytes), Groq + Gemini
  (AI features). No Docker or local Postgres/Redis needed.

## 1. Install

```powershell
pnpm install
```

## 2. Environment files (read this — it bites)

Each process (`api`, `worker`, `prisma CLI`) loads `.env` from **its own
package directory**, not the repo root. So after creating/updating the
root `.env`, copy it into the three package dirs:

```powershell
# First time (or when .env.example changes):
Copy-Item .env.example .env -Force   # then fill in real values

# REQUIRED on every .env change — one copy per process:
Copy-Item .env apps/api/.env -Force
Copy-Item .env apps/worker/.env -Force
Copy-Item .env packages/db/.env -Force
```

> Symptom if you skip this: API boots fine but `GET /ready` reports
> `"database":{"status":"skipped","detail":"DATABASE_URL is not configured"}`.
> The values never reached the process.

`.env`, `apps/*/.env`, and `packages/*/.env` are all gitignored — never
commit them. Note: `.env.example` in this checkout currently contains
live secrets; rotate them if the repo is ever shared or made public.

Optional for web dev (defaults to `http://localhost:4000` when absent):

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

## 3. Database

```powershell
pnpm db:generate
pnpm --filter @ai-study-companion/db migrate:deploy
```

- `migrate:deploy` is non-interactive and safe to re-run (prints
  `No pending migrations to apply` when current).
- Prefer it over `pnpm db:migrate` (`migrate dev`), which can stop at an
  interactive prompt and appear hung in this setup.
- The Neon database only stores **metadata**; PDF/image bytes live in
  the Neon Object Storage bucket (`STORAGE_BUCKET` + `AWS_*` vars).
- Optional demo content (idempotent, dev-only; the seeded demo user has
  no password, so day-to-day use the Register page instead):

```powershell
pnpm db:seed
```

## 4. Run everything

```powershell
pnpm dev
```

This starts all three processes in parallel:

| Process | Command (run individually) | URL / port               |
| ------- | -------------------------- | ------------------------ |
| Web     | `pnpm dev:web`             | http://localhost:3000    |
| API     | `pnpm dev:api`             | http://localhost:4000    |
| Worker  | `pnpm dev:worker`          | no port (queue consumer) |

Open **http://localhost:3000** and Register a new account.

## 5. Verify it works

```powershell
# API alive?
Invoke-WebRequest -Uri http://127.0.0.1:4000/health -UseBasicParsing | Select-Object StatusCode
# → 200

# Database reachable? (must say "up", NOT "skipped")
Invoke-WebRequest -Uri http://127.0.0.1:4000/ready -UseBasicParsing | Select-Object -ExpandProperty Content
# → ..."database":{"status":"up"}...

# Web serving?
Invoke-WebRequest -Uri http://127.0.0.1:3000 -UseBasicParsing | Select-Object StatusCode
# → 200

# Worker: check its terminal shows "Worker ready and consuming queues"
# with no repeating "Redis connection error".
```

Then in the browser: Register → create a Space → create a Project →
Materials tab → upload a PDF → watch it go QUEUED → READY → search it.

## 6. Troubleshooting (issues actually hit in this repo)

1. **`/ready` says database `skipped`** → the per-package `.env`
   copies are missing/stale. Re-run the three `Copy-Item` commands in
   §2 and restart the processes.
2. **Worker loops `read ECONNRESET` on Redis** → `REDIS_URL` must use
   the TLS scheme for Upstash: `rediss://default:<token>@<host>:6379`,
   not `redis://`. (Plain TCP connects, then the server resets it.)
   This is already fixed in the current `.env`.
3. **`pnpm db:migrate` seems hung** → it's `migrate dev` waiting on an
   interactive prompt. Use `migrate:deploy` (§3) instead.
4. **Uploads fail / materials stuck QUEUED** → bucket vars missing:
   `STORAGE_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`. Create a branch credential with
   `storage:read` + `storage:write` scopes
   (Neon Console → branch → Credentials) and re-copy `.env` (§2).
5. **Tutor answers 503** → `GROQ_API_KEY` missing (by design, no
   fallback). Search still works in lexical-only mode without
   `GEMINI_API_KEY`.
6. **`EADDRINUSE :::4000` / crash loops on start** → an older copy is
   still running (`tsx watch` / `next-server` from a previous session —
   each new terminal that ran `pnpm dev` adds another set, and
   duplicates also double-process background jobs). One set only:
   find orphans and kill them, then start fresh:

```powershell
Get-NetTCPConnection -LocalPort 3000,4000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
Stop-Process -Id <pid> -Force   # repeat per orphan, then pnpm dev
```

## 7. Useful extras

```powershell
pnpm build        # build all packages + apps
pnpm typecheck    # strict TS check, all workspaces
pnpm lint         # workspace lint
pnpm test         # unit + integration (needs TEST_DATABASE_URL)
pnpm db:studio    # Prisma Studio DB browser
```
