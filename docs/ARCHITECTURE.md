# Architecture

## Overview

```text
                    ┌─────────────────────┐
                    │   Next.js web app   │
                    │  apps/web (:3000)   │
                    │  Outfit · Tailwind  │
                    │  shadcn · TanStack  │
                    └─────────┬───────────┘
                              │  lib/api/client (JSON, x-request-id, AbortController)
                              ▼
                    ┌─────────────────────┐
                    │    Express API      │
                    │  apps/api (:4000)   │
                    │ Route→Controller→   │
                    │ Service→Repository  │
                    └────┬──────────┬─────┘
                         │          │
                Prisma   │          │  BullMQ enqueue
                         ▼          ▼
              ┌──────────────┐ ┌──────────────────┐
              │ Neon Postgres│ │  Upstash Redis   │
              │  + pgvector  │ │  (ioredis TCP)   │
              └──────────────┘ └────────┬─────────┘
                                        │ consume
                                        ▼
                              ┌──────────────────┐
                              │  Node.js worker  │
                              │  apps/worker     │
                              └────┬────────┬────┘
                                   │        │
                          Gemini    │        │  Groq
                          embeddings│        │  LLM
                                   ▼        ▼
                              ┌──────────────────┐
                              │ Neon Object    │
                              │ Storage bucket │
                              │ (PDFs + images)│
                              └──────────────────┘
```

## Applications

### apps/web — Next.js 14 frontend

- App Router, TypeScript strict, Tailwind 3 + shadcn/ui + Framer Motion.
- Google Outfit via `next/font/google` (`--font-outfit` CSS variable, `font-sans` default).
- Global TanStack Query provider (`providers/query-provider.tsx`); all server state flows
  through `lib/api/client.ts` — raw `fetch()` in components is forbidden.
- Central query keys in `lib/query/keys.ts` (`home`, `spaces`, `space(id)`,
  `projects(spaceId)`, `project(id)`, `projectOverview(id)`); mutations invalidate
  only affected keys (create project → project list + space + spaces + home).
- Feature-oriented `features/` directory: auth, spaces, projects, home,
  search, materials, tutor, quiz, growth, analytics, and admin — each with
  API client + TanStack Query hooks + components. The project workspace
  composes them as URL-driven tabs (`?tab=`); heavy tab panels and admin
  sections load via `next/dynamic` with skeleton fallbacks, and tab hover
  prefetches the next tab's queries so switches render data, not spinners.
- Safe client-side markdown renderer for tutor answers
  (`lib/markdown.ts` parser + `components/shared/markdown.tsx`): a small
  AST rendered as React elements — never `dangerouslySetInnerHTML`, only
  http(s) links, stray markers pass through as literal text.
- Auth state: `GET /api/auth/me` → `useCurrentUser()`; `getAuthStatus()` maps the
  query to `loading | authenticated | unauthenticated`; `RequireAuth`/`RequireAdmin`
  guard routes (UX only — the API enforces). No tokens in browser storage, ever.
- App shell (`components/layout/app-shell.tsx`): persistent desktop sidebar
  (sectioned nav, dark account card), mobile drawer (`mobile-nav.tsx`, same
  nav config) plus a mobile bottom nav (`mobile-bottom-nav.tsx`) with
  safe-area padding, slim sticky header with data-driven breadcrumbs +
  account menu, skip link. One nav config, three presentations.
- Shared UI (`components/shared/`): page primitives (`PageContainer`, `PageHeader`,
  `PageSection`), state primitives (`EmptyState` + per-section presets, `PageLoading` /
  skeletons / `Spinner`, `ErrorState` mapped from HTTP status), cards (`StatCard`,
  `SectionCard`), `Field` (RHF + Zod + shadcn input), restrained motion primitives
  (`FadeIn`, `SlideUp`, `StaggerGroup/Item`, all reduced-motion aware), and a
  dependency-free toast system (`lib/toast.ts` store + `<Toaster/>` in root layout).
- Project dashboard tabs are URL-driven (`?tab=`): refresh and shared links preserve
  the section; invalid values fall back to Overview.
- Server Components by default; `"use client"` only for interaction, Query, RHF,
  motion, and browser APIs. AI output is treated as untrusted — never rendered as
  raw HTML.
- Routes: `/` (home dashboard shell, protected), `/login`, `/register`,
  `/spaces`, `/spaces/[spaceId]`, `/spaces/[spaceId]/projects/[projectId]`,
  `/admin` (admin-guarded, live API health via Query). Flat routes kept deliberately
  (see DEVELOPMENT_DECISIONS.md) — no route groups, no React Router.

### apps/api — Express backend

- Strict layering: `routes/` → `controllers/` → `services/` → `repositories/` → Prisma.
  Business logic in routes is forbidden. Controllers stay thin (auth → validated
  input → service → envelope).
- Feature modules: `spacesService` (paginated/searchable list with `_count`,
  transactional create/update/delete + activity), `projectsService` (space-scoped
  list, detail with view-tracking, partial updates, cascade delete, lightweight
  `getProjectOverview`), `homeService` (single-aggregation dashboard query),
  `activityService.recordActivity` (transactional audit rows).
- Ownership is encoded in queries (`{ id, ownerId }`), never checked after the
  fact; misses are 404 with no existence oracle. Core mutations run the business
  write + activity row in one Prisma transaction; project-view tracking is the
  deliberate exception (logged, non-blocking).
- Middleware: request ID (`x-request-id`), structured pino-http logging, helmet, CORS,
  1 MB JSON body limit, in-memory rate limiting (generous; Redis-backed later),
  centralized error handler + 404 handler, async wrapper.
- `GET /health` (liveness, always 200), `GET /ready` (dependency-aware, `skipped`
  when credentials absent, 503 only when a configured dependency is down).
- Retrieval: `searchService` (project-scoped hybrid FTS + pgvector, graceful
  lexical-only degradation), `materialsService` (owned-material listing +
  transactional reindex with deterministic BullMQ job ids), API-side lazy
  queue producer (`lib/queues.ts`, enqueue-only). See
  `docs/SEARCH_ARCHITECTURE.md`.
- Tutor: `tutorService` (retrieve → Groq → single-transaction persist of
  both messages + `TutorEvidence`, server-computed citation labels).
- Quizzes: `quizService` (adaptive creation, attempts, responses,
  completion) + `quizAdaptive` (deterministic five-signal selector),
  `questionGenerator` (batched grounded generation), `quizEvaluation`
  (structured open-ended grading), `conceptExtraction` (once-per-project
  bootstrap), `quizLlm` (JSON-mode completion + test seam + usage rows).
  Answer keys join responses only post-answer; evaluations are states, not
  verdicts. See `docs/QUIZZES.md` and `docs/ASSESSMENTS.md`.
- Learning loop: `masteryService` (attempt processing, growth reads,
  recommendation refresh/lifecycle, tutor markers, mistake patterns) +
  pure `masteryCalculator` (EMA update math), `growthAnalyzer`
  (half-mean trends), `recommendationEngine` (ranked candidates).
  Completion hooks `processAttemptMastery` post-commit (queue-ready,
  idempotent); tutor hooks score-neutral exposure markers. Home and
  project overview consume ranked engine output. See `docs/MASTERY.md`,
  `docs/GROWTH_ANALYSIS.md`, `docs/RECOMMENDATIONS.md`,
  `docs/LEARNING_LOOP.md`.
- Analytics: `analyticsService` (project + home aggregates, UTC
  `date_trunc` series, streak math; PostgreSQL does the math) and
  `adminService` (system overview, users/journey, activity explorer,
  learning, AI usage/evaluations, jobs, lightweight health). Admin
  routes enforce server-verified `requireAdmin`. AI costs flow from one
  pricing table (`packages/ai/pricing.ts`) through central
  `recordAIUsage`. See `docs/ANALYTICS.md`.
- Typed central config (`src/config`, Zod-validated); no scattered `process.env`.
- Global error model `AppError` with codes
  (VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED,
  INTERNAL_ERROR, SERVICE_UNAVAILABLE) and envelope
  `{ success: false, error: { code, message, details? }, requestId }`.

### apps/worker — BullMQ background worker

- Node.js + TypeScript + BullMQ 5 + ioredis 5.
- Queue naming: `aistudy.<queue>` (`aistudy.system`, `aistudy.documents`,
  `aistudy.knowledge`, …).
- Default job policy: 3 attempts, exponential 5 s backoff, capped completed/failed retention
  (document jobs: 5 attempts, matching `DocumentJob.maxAttempts`).
- Structured job logs carry `jobId, queue, jobName, attempt, correlationId, duration, status`.
- `document.process` (`jobs/document-processing/`): pdfjs-dist text +
  structure extraction → tesseract.js OCR fallback for low-text pages →
  sharp embedded images → `EXTRACTED_IMAGE` blobs → `DocumentPage` rows
  → material `READY` → chained knowledge job. See
  `docs/KNOWLEDGE_PROCESSING.md` and `docs/BACKGROUND_JOBS.md`.
- `knowledge.process` (`jobs/knowledge-processing/`): normalize → deterministic
  chunk → Gemini-embed changed chunks → persist vectors → mark knowledge
  `READY`. See `docs/KNOWLEDGE_PROCESSING.md` and `docs/BACKGROUND_JOBS.md`.
- `ai.evaluate` (`jobs/ai-evaluation/`): deterministic quality scoring of
  persisted tutor/attempt/quiz/recommendation rows (no LLM calls, null for
  uncomputable metrics); idempotent by deterministic job id + existing-row
  check. `jobs/job-tracking.ts` mirrors knowledge job status into
  `DocumentJob` rows (the durable record admin analytics reads).
- Boots degraded without Redis (warns, stays alive in dev; throws in production).

### packages/db — Prisma + Neon + pgvector

- `prisma/schema.prisma` (PostgreSQL, `DATABASE_URL` + `DIRECT_URL` for Neon pooling),
  placeholder `SchemaVersion` model keeps `generate`/`migrate` working pre-Prompt-2.
- `prisma/migrations/0000_enable_pgvector` creates the `vector` extension now so Prompt 2
  embedding tables only add columns + HNSW/IVFFLAT indexes (Prisma models the column as
  `Unsupported("vector(1536)")` + raw SQL index — documented in schema comments).
- `src/index.ts` singleton: lazy, never throws at import, `checkDatabase()` for `/ready`.

### packages/* — shared code

- `@ai-study-companion/config`: queue names, job names, default retry policy, API error codes.
- `@ai-study-companion/shared`: `ApiResponse`, health/readiness, pagination contracts,
  spaces/projects/home/search shapes, `EMBEDDING_DIMENSIONS` (768).
- `@ai-study-companion/validation`: shared Zod schemas (`paginationSchema`, auth,
  spaces/projects, search/reindex, formatters).
- `@ai-study-companion/ai`: `EmbeddingProvider` interface, Gemini + deterministic
  mock providers, embedding usage logging. Consumed by worker and API — never
  the browser.
- Frontend and backend must reuse these instead of duplicating types.

## Cross-cutting concerns

- **Request correlation:** frontend generates/propagates `x-request-id`; Express echoes it in
  headers, logs and envelopes; worker jobs carry `correlationId` end-to-end.
- **Logging:** pino structured logs; API fields (`timestamp, level, service, requestId, route,
duration, error`), worker fields (`jobId, queue, jobName, attempt, duration, status`).
  Secrets, tokens, bodies and PDF contents are never logged (redaction lists).
- **Sentry:** `@sentry/node` (API/worker) + `@sentry/nextjs` (web); initialized only when
  `SENTRY_DSN` is set; never blocks local boot.
- **Rate limiting:** `express-rate-limit` with a Redis fixed-window store
  and per-key in-memory fallback (Prompt 12); login keyed by IP + email.
  429s use the central envelope + `Retry-After`.
- **No mocks:** no `mock*` data, no `setTimeout` fake APIs, no fake responses anywhere.

## Why a modular monorepo (not microservices)

Three deployables (web, API, worker) share five packages
(`db`, `shared`, `validation`, `config`, `ai`) in one pnpm workspace.
The boundaries that matter — HTTP between web/API, BullMQ between
API/worker, SQL ownership checks at every service — are already
process boundaries where they need to be. Splitting further (a
separate analytics/ML/search service) would add network hops,
versioning, and auth surface without changing any data ownership:
PostgreSQL remains the single source of truth (rows and file bytes in
`material_blobs`), Redis a transport. Independent builds per app (`tsc -p tsconfig.build.json`,
`next build`) keep deploys scoped; see `docs/DEPLOYMENT.md` §10.

## Deployment mapping

Vercel serves `apps/web`; Render runs `apps/api` (`tsx
dist/server.js`, `PORT`-bound, `/health` + `/ready`) and
`apps/worker` (`tsx dist/worker.js`, no port) as separate processes
with separate env (worker needs no `GROQ_API_KEY`, no `PORT`, no
cookie settings). Managed services stay managed: Neon (pooled +
direct URLs, plus an S3-compatible Object Storage bucket for PDFs +
images while PostgreSQL holds only metadata), Upstash
Redis (TLS TCP for BullMQ), Groq + Gemini (server-side),
Sentry (all three processes). Full procedure, env reference, and
smoke tests: `docs/DEPLOYMENT.md`.
