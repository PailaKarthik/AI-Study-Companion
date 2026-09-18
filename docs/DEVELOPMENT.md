# Development

## Prerequisites

- Node.js ≥ 20 (`node --version`)
- pnpm ≥ 9 (`pnpm --version`; install with `npm install -g pnpm`)

## First-time setup

```bash
pnpm install
cp .env.example .env
# web: copy apps/web/.env.example to apps/web/.env.local if you need a custom API URL
```

No external credentials are needed to boot the foundation. Missing `DATABASE_URL`,
Redis credentials or AI keys produce `skipped` checks and degraded
modes — never boot failures (except worker in `NODE_ENV=production` without Redis).

## Running (each app independently)

```bash
pnpm dev:web     # Next.js → http://localhost:3000
pnpm dev:api     # Express → http://localhost:4000 (GET /health, GET /ready)
pnpm dev:worker  # BullMQ worker (degraded bootstrap mode without Redis)
```

Run everything concurrently:

```bash
pnpm dev
```

## Useful commands

```bash
pnpm build        # build all apps + packages
pnpm build:web | pnpm build:api | pnpm build:worker
pnpm typecheck    # strict tsc across the monorepo
pnpm lint         # per-package tsc --noEmit
pnpm test         # all Vitest suites
pnpm format       # prettier write
```

Database (needs `DATABASE_URL` + `DIRECT_URL` — Neon):

```bash
pnpm --filter @ai-study-companion/db generate   # Prisma client (works offline)
pnpm db:migrate                                 # migrate dev (needs DIRECT_URL)
pnpm db:seed                                    # dev seed, idempotent re-runs
pnpm --filter @ai-study-companion/db studio
```

Live/destructive DB tests must use a throwaway database: set `TEST_DATABASE_URL`
to a separate Neon branch and never to production. Without it, `packages/db`
runs its offline-safe suites only (isolation helpers, pagination,
schema-constraint contracts, seed idempotency on a mock).

Web E2E (Playwright, Chromium):

```bash
pnpm --filter @ai-study-companion/web test:e2e
```

- `tests/e2e/auth-ui.spec.ts` runs with **no backend**: redirects, form rendering,
  client validation, and error-alert behavior (a failed login shows the alert
  whether the API is down or returns 401).
- `tests/e2e/shell.spec.ts` (register → dashboard → sidebar → tabs → logout),
  `tests/e2e/spaces-projects.spec.ts` (register → home → create space → open
  space → create project → refresh persists → tabs → edit → logout), and
  `tests/e2e/cross-user-isolation.spec.ts` (B sees none of A's content via
  navigation, hand-edited URLs, or query params) need the API + migrated DB
  and are skipped unless `E2E_WITH_BACKEND=1`:

```bash
# terminal 1: pnpm dev:api   (with DATABASE_URL set, migrations applied)
# terminal 2: E2E_WITH_BACKEND=1 pnpm --filter @ai-study-companion/web test:e2e -- --workers=1
```

Backend specs share ONE API process + ONE database (including the API's
rate-limit budgets), so they must run serially (`--workers=1`).
Parallel workers cause cross-spec flakes: a spec can stall on a shared
budget or dev-server compile contention and time out.

No seed data required — the spec registers a fresh user per run.

## Verifying the foundation

1. API: `curl http://localhost:4000/health` → `{ "success": true, "data": { "status": "ok", … } }`
   with an `x-request-id` response header.
2. Readiness: `curl http://localhost:4000/ready` → checks show `skipped` without credentials.
3. Web: open http://localhost:3000 — anonymous users land on `/login`; after register/login
   the home dashboard, `/spaces` and project shells render; `/admin` requires ADMIN role.
4. Worker: `pnpm dev:worker` logs boot + degraded-mode warning without Redis; with Redis
   configured it connects, consumes `aistudy.system`, and processes a bootstrap
   `system.health` job.

## Conventions

- API layering: Route → Controller → Service → Repository. No business logic in routes.
- Web data flow: components → hooks (`hooks/`, `features/*/hooks`) → `lib/api/client`
  → TanStack Query. No raw `fetch()` in components.
- Web UI: compose `components/shared` primitives (page, states, cards, motion, toaster)
  and `components/navigation` (sidebar/drawer/breadcrumbs) — no bespoke shells.
- Query keys live in `lib/query/keys.ts`; only for APIs that exist. Unit tests live
  next to code under `lib/**/*.test.ts`.
- Frontend env: only `NEXT_PUBLIC_*` reaches the browser (`NEXT_PUBLIC_API_URL`);
  secrets (`DATABASE_URL`, `SESSION_SECRET`, AI/Redis keys) never leave the server.
- Shared code goes in `packages/` — do not duplicate types between web and API.
- Structured logging only (pino); never `console.log` in app code paths.
- Never commit `.env`; never hardcode keys; never add mock business data.
