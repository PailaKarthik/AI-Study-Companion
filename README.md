<div align="center">

# AI Study Companion

**Learn anything, deeply** — upload your PDFs, chat with a tutor that cites its sources, practice with adaptive quizzes, and watch mastery grow from real evidence.

![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![Express](https://img.shields.io/badge/Express-4-black?logo=express)
![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-336791?logo=postgresql)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm)

_Black-and-white, premium, fully responsive UI · No mock data — every number comes from PostgreSQL_

</div>

---

## Table of contents

- [The learning loop](#the-learning-loop)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Monorepo layout](#monorepo-layout)
- [Quickstart (local)](#quickstart-local)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [Deployment (free-tier, 512 MB)](#deployment-free-tier-512-mb)
- [Docs](#docs)

---

## The learning loop

```text
Upload PDF → Extract + OCR → Chunk + Embed → Ask the Tutor → Take a Quiz
    → Get Graded → Mastery Updates → Growth Trends → Next Best Step → Repeat
```

Everything is grounded in **your** documents. The tutor refuses to guess when evidence is missing — and says so plainly.

## Features

| Area                  | What you get                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Welcome**           | Public intro with the learning loop, feature cards, and login/register CTAs                                                                                                                                                              |
| **Home dashboard**    | Dark continue-learning hero, clickable KPI cards, recent projects, next action with reason + CTA, attention list, 30-day activity chart                                                                                                  |
| **Spaces & projects** | Spaces with identity, server-side All / Active / Completed / Archived filtering with real counts, project cards with status and activity                                                                                                 |
| **Project workspace** | Goal banner, mastery progress, next action, attention, activity, and six tabs with hover-prefetch tab switching                                                                                                                          |
| **Materials**         | Drag-and-drop PDF upload, live two-stage pipeline (Extraction → Knowledge index), page/chunk/image counts, retry, delete, download                                                                                                       |
| **AI Tutor**          | Persistent conversation sidebar (search, date groups, mobile drawer), markdown answers, citation cards with relevance, thinking state, auto-growing composer (Enter to send)                                                             |
| **Adaptive quizzes**  | Stepped creation (5 / 10 / 15 quick-picks, live count), **exactly** the requested number of questions, MCQ + open-ended, quiz history table with scores, full per-question review (your answer / correct answer / explanation / concept) |
| **Growth**            | Mastery distribution, per-concept progress bars, trend badges (↑ improving / → stable / ↓ needs attention), mastery-over-time line chart, concept inspector with history                                                                 |
| **Analytics**         | Icon KPIs, activity bars, mastery + recommendation distributions, event-icon timeline, 7/30/90-day ranges                                                                                                                                |
| **Recommendations**   | Ranked next steps with reasons, priority badges, working CTAs, complete/dismiss lifecycle                                                                                                                                                |
| **Admin**             | Dark status hero with live health dots, clickable KPI cards, users (with cool inspect view), activity stream, learning analytics, AI usage ledger, evaluations, job explorer with retry bars, system health matrix                       |

## Tech stack

| Layer         | Choice                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| Web           | Next.js 14 · TypeScript · Tailwind + shadcn/ui · TanStack Query · Framer Motion · Lucide |
| API           | Express 4 · Zod validation · Argon2id + HMAC sessions · BullMQ producers                 |
| Worker        | BullMQ consumers · pdfjs-dist (text) · Tesseract.js OCR · sharp (images)                 |
| Data          | Neon PostgreSQL + pgvector (HNSW + full-text search) · Prisma 5                          |
| Queue / cache | Upstash Redis (TCP via ioredis)                                                          |
| Files         | Neon Object Storage (S3-compatible; Postgres holds metadata only)                        |
| AI            | Groq chat (`openai/gpt-oss-120b`) · Gemini embeddings (`gemini-embedding-001`, 768-d)    |
| Observability | Sentry (optional) · structured pino logs · `AIUsage` ledger with cost estimates          |

## Architecture

```text
Browser ──HTTPS──▶ Next.js Web
                       │ session cookie + NEXT_PUBLIC_API_URL
                       ▼
                  Express API ──▶ Neon PostgreSQL + pgvector
                       │ ▲                ▲
        enqueue (BullMQ) │ │                │ pgvector writes
                       ▼ │                │
                  Upstash Redis ◀── Worker │
                       PDFs/OCR → chunks → Gemini embeddings
```

- **Synchronous:** CRUD, tutor turns, quiz generation/grading, search (bounded timeouts).
- **Asynchronous:** uploads → `document.process` → `knowledge.process` jobs; the UI polls, the browser never waits.
- **AI calls are server-side only.** The browser never sees a key.

## Monorepo layout

```text
apps/
  web/        Next.js frontend (App Router, features/, TanStack Query hooks)
  api/        Express API (routes → controllers → services → repositories)
  worker/     BullMQ background worker (document + knowledge + AI-eval jobs)
packages/
  db/         Prisma schema, migrations, client singleton, storage helpers
  ai/         Groq/Gemini providers, pricing table, mock providers (tests)
  shared/     Shared TypeScript contracts (API envelopes, quiz/tutor/growth types)
  validation/ Shared Zod schemas (single source for client + server validation)
  config/     Typed env/config helpers
docs/         Product + ops documentation (architecture, API, security, …)
render.yaml   Render Blueprint: API web service + background worker
```

## Quickstart (local)

Prerequisites: **Node ≥ 20**, **pnpm ≥ 9**, plus free accounts for Neon (Postgres + storage), Upstash (Redis), Groq, and Google AI Studio (Gemini).

```powershell
# 1. Install
pnpm install

# 2. Configure — copy and fill in (never commit real values)
copy .env.example .env

# 3. Database
pnpm db:generate
pnpm db:migrate        # or: pnpm db:push for a quick non-migration setup

# 4. Run everything (web :3000, api :4000, worker)
pnpm dev
```

Open `http://localhost:3000`, register, create a space + project, upload a PDF, and ask the tutor a question.

> Local `.env` files (`apps/*/.env`, `packages/*/.env`, root `.env`) are gitignored. Only the scrubbed `.env.example` is committed.

## Environment variables

| Variable                                                     | Where            | Required                         | Notes                          |
| ------------------------------------------------------------ | ---------------- | -------------------------------- | ------------------------------ |
| `DATABASE_URL`                                               | api, worker      | prod: yes                        | Neon **pooled** string         |
| `DIRECT_URL`                                                 | migrate          | prod: yes                        | Neon **direct** string (DDL)   |
| `GROQ_API_KEY`                                               | api              | yes for tutor/quiz               | Server-only                    |
| `GEMINI_API_KEY`                                             | api, worker      | yes for semantic search/indexing | Server-only                    |
| `GROQ_CHAT_MODEL`                                            | api              | no                               | Default `openai/gpt-oss-120b`  |
| `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` (or `REDIS_URL`) | api, worker      | yes for jobs                     | TCP (`rediss://`), not REST    |
| `SESSION_SECRET`                                             | api              | prod: yes                        | 32+ random chars               |
| `NEXT_PUBLIC_API_URL`                                        | web (build-time) | yes                              | Deployed API origin            |
| `STORAGE_*` + `AWS_*`                                        | api, worker      | yes for uploads                  | Neon Object Storage bucket     |
| `SENTRY_DSN`                                                 | all              | no                               | Empty = disabled               |
| `WORKER_CONCURRENCY`                                         | worker           | no                               | Default `2`; use `1` on 512 MB |

Full per-service tables: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Every variable: [`.env.example`](.env.example).

## Scripts

| Command                                                 | What it does                                               |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev` / `dev:web` / `dev:api` / `dev:worker`       | Run services (tsx watch / next dev)                        |
| `pnpm build` / `build:*`                                | Production builds (`next build`, `tsc`, …)                 |
| `pnpm typecheck` / `pnpm lint`                          | `tsc --noEmit` per package                                 |
| `pnpm test`                                             | Vitest suites (DB suites skip without `TEST_DATABASE_URL`) |
| `pnpm db:migrate` / `db:push` / `db:seed` / `db:studio` | Database workflows                                         |

## Testing

- **Unit/integration (Vitest):** parsers, quiz selector + count guarantee, prompts/dedup, validation, API service logic. DB-backed suites auto-skip without `TEST_DATABASE_URL` and run in CI.
- **E2E (Playwright/Chromium):** `apps/web/tests/e2e` — auth UI runs backend-free; backend flows self-skip unless `E2E_WITH_BACKEND=1` with API + migrated DB running.
- **Production build** (`next build` + `tsc`) is part of verification before every push.

## Deployment (free-tier, 512 MB)

Split into **three services** (each gets its own 512 MB): **Vercel** for web, **Render** web service for API, **Render** background worker for jobs. Keep `NODE_OPTIONS=--max-old-space-size=384`, worker concurrency at 1–2, and let BullMQ queue absorb bursts.

Full procedure (platforms, env tables, migrations, smoke test, 512 MB budget rules): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). One-click Render services: [`render.yaml`](render.yaml).

## Docs

Product and ops docs live in [`docs/`](docs/): `ARCHITECTURE`, `API`, `DATABASE`, `DEVELOPMENT`, `DEPLOYMENT`, `SECURITY`, `RELIABILITY`, `LEARNING_LOOP`, `QUIZZES`, `MASTERY`, `SEARCH_ARCHITECTURE`, `EVALUATION`, `LIMITATIONS`, `FUTURE_IMPROVEMENTS`, plus `AI_DEVELOPMENT` (AI used to build vs. AI used by the product) and `DEVELOPMENT_PROMPTS` (the actual AI-assistant prompt record).
