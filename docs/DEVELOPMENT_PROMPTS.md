# Development Prompts

The actual prompts materially used with the AI development agent
(OpenCode + Muse Spark), organized by area. Verbatim user wording is
quoted; each entry notes what it produced. Scope: the AI-assisted
session covering debugging, the quiz-count fix, the frontend
redesigns, and release preparation. Earlier implementation stages
predate this record.

## Backend

- **Quoted log + "solve this issue"** (Prisma `Transaction not found`
  in `knowledge.process`, failing twice then succeeding).
  Outcome: diagnosed the Neon pooled-connection + 5s interactive
  transaction timeout; rewrote `persistPlan` as pooler-safe sequential
  writes (idempotent retry instead of one giant transaction).
- **"1. literally ui is so worse … 2. … cover every section … 3. tutor
  scroll … 4. white theme only … 5. quiz alignment …"**
  Outcome: semantic status system, pipeline stepper, tutor sidebar,
  quiz history/review, charts, skeletons, lazy tabs.
- **"There is currently a bug where creating a quiz does not correctly
  respond to the requested number of questions … Find the actual source
  … Verify requested count … frontend payload … API schema … backend
  validation … AI generation count … structured output … dedup …
  persistence … final response"** (part of the UX upgrade brief).
  Outcome: root cause (`perConceptCap = 3` → `concepts × 3` ceiling,
  plus silent evidence/retry shortfalls); uncapped selector, refill +
  trim, exposed counts, 5/10/15 tests.
- **"while using the project section, the next js giving errors in the
  web showing the prefetch error"**
  Outcome: destructured `prefetchQuery` had lost its `this` binding;
  fixed with direct calls, failure swallowing, and once-per-tab guard.
- **"after attempting quiz, the attempts quiz not updating quickly"**
  Outcome: missing `quizzes(projectId)` invalidation on start/complete
  mutations — added.
- **"in admin panel, make the cards dynamic which clicking on it"**
  Outcome: overview KPI cards link to their sections.

## Database

- Follow-ups (**"continue above work" ×2**) on the transaction fix.
  Outcome: verification (typecheck/tests) and documentation of the
  residual risk in the document-processing transaction.
- Quiz review needed the answer key post-answer: added conditional
  `correctAnswer` (absent — not null — before answering) to
  `AttemptState`; added `requestedCount`/`generatedCount` to
  `QuizDetail`; added `status` filtering + `projects/counts` endpoint.

## AI / models

- **Tutor log + "solve this issue"** (`INTERNAL_ERROR` after successful
  search). Outcome: live-probed Groq — `llama-3.3-70b-versatile`
  returns 404 (moved to Enterprise); switched default to
  `openai/gpt-oss-120b` (verified 200), updated pricing/tests/docs,
  fixed blind error logging.
- **"can we use that mode for free openai/gpt-oss-120b."**
  Outcome: checked Groq rate-limit docs — free plan covers it
  (30 RPM / 1K req/day / 8K TPM / 200K TPD); reported with the paid
  price attached for context.

## Frontend

- *_"1. here the response of the ai tutor contains … *, ** etc.. so try
  to clean the response. 2. … loading effects. 3. … lazy loading"*_
  Outcome: safe markdown renderer (`lib/markdown.ts` + component,
  8 tests), pipeline stepper + skeletons, lazy tab panels.
- **Full "FRONTEND UX/UI UPGRADE" brief (§1–§28)** — audit, intro,
  visual language, icons, home, project filtering, dashboard,
  materials, tutor history, quiz history/review, charts,
  recommendations, skeletons, empty states, admin, responsive,
  accessibility, performance.
- **"COMPLETE FRONTEND REDESIGN" brief (§1–§40)** — white theme,
  dark content panels, shell + mobile bottom nav, Home hero,
  tutor render-split (composer/sidebar isolation), stepped quiz
  creation, lazy admin sections, memoized charts.
- **Iterative UI direction** (verbatim selections): "change every ui …
  dark gradient cards", "white theme only", "quizs alignment is
  absolutely shit", "left side curved border", "remove those borders …
  use shadows", "remove those shadows", "bottom-left side curved
  shadow" (added, then removed with the borders), "charts … very
  boring", "monochrome black-and-white", "instant tabs with black
  pill selection", "admin cards clickable", "overview cards same
  shape", "user journey cool UI", "skeletons matching page UI",
  "home cards balance", project tabs text-visibility fix.
- **"in home page … add left side curved border"** then
  **"remove those all side borders and just make it clean"** —
  both applied in sequence; final state is clean (no spines).
- **Nine-item punch list**: quiz refresh, count accuracy ("generated
  … 5 but … gave 7" → service-level trim + tests), tab style,
  repo cleanup, composer autoresize + Enter-send, icons, home
  next-action clarity, clickable KPIs, space project-count chip.

## Debugging

- **API log: `Can't reach database server` on login.**
  Outcome: DNS + TCP probes from the machine succeeded — diagnosed
  as transient (Neon idle-suspend wake-up), no code change; offered
  reconnect-backoff as follow-up.
- **PDF pipeline questions** ("which tool", "explain simply",
  "all-images PDF flow", "use of sharp"): answered from
  `imageExtractor.ts` / `service.ts` (pdfjs-dist + sharp + tesseract
  ordering), no code change.

## Testing / verification

- Every fix closed with `tsc --noEmit` per touched package, Vitest
  suites, `next build`, and Playwright `auth-ui` where UI changed.
- DB-gated suites skip locally without `TEST_DATABASE_URL`
  (reported, run in CI); backend E2E specs self-skip without
  `E2E_WITH_BACKEND=1`.
- A stale nav unit test and a stale e2e welcome test were updated to
  the intended behavior, not deleted.

## Documentation / release

- **"make it github ready … gitignore … proper readme … 512 mb …
  deployment md"** Outcome: dep diet (removed Radix leftovers,
  `pino-pretty` → devDeps, `WORKER_CONCURRENCY` 5 → 2), lockfile
  refresh, rewritten README, `render.yaml`, free-tier §14 in
  `docs/DEPLOYMENT.md`, secret scrubbing, dead-code removal.
- **Submission requirements (§3–§9)** — this file plus
  `docs/AI_DEVELOPMENT.md` (build-vs-product AI),
  `docs/FUTURE_IMPROVEMENTS.md` (roadmap), and refreshed
  `docs/LIMITATIONS.md`; `docs/ARCHITECTURE.md` stale passages fixed.
