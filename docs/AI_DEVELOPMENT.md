# AI in Development (vs AI in the Product)

Two completely different things are both called "AI" in this project.
This document keeps them separate.

## AI used BY the final product (runtime)

The product itself calls AI providers at runtime. This is the complete
list — see `docs/AI_USAGE.md` for the full contract:

| Capability             | Provider | Model (default)        | Where            |
| ---------------------- | -------- | ---------------------- | ---------------- |
| Tutor answers          | Groq     | `openai/gpt-oss-120b`  | API tutorService |
| Quiz concept extract   | Groq     | `GROQ_CHAT_MODEL`      | API quizService  |
| Quiz question gen      | Groq     | `GROQ_CHAT_MODEL`      | API quizService  |
| Open-ended grading     | Groq     | `GROQ_CHAT_MODEL`      | API quizService  |
| Query/chunk embeddings | Gemini   | `gemini-embedding-001` | API + worker     |
| Quality evaluation     | none     | deterministic code     | worker (no LLM)  |

Rules: no AI call runs in the browser, keys never leave the server,
the worker runs no LLM calls, and every call is logged to `AIUsage`
with tokens, latency, and estimated cost.

## AI used to BUILD the product (development-time)

The implementation, debugging, UI redesign, and documentation in this
repository were produced with an **AI coding agent** (OpenCode,
powered by the Muse Spark model family), directed by the human owner
through written prompts. The full prompt record is
`docs/DEVELOPMENT_PROMPTS.md`.

What the agent did:

- **Debugging** — diagnosed a Prisma pooled-transaction failure and a
  retired Groq model from production logs, verified each root cause
  with live probes before fixing.
- **Backend fixes** — uncapped quiz-target selection, generation
  refill/trim, project status filter + counts endpoint, answer-key
  reveal policy for attempt review.
- **Frontend** — welcome experience, monochrome design system,
  tutor history sidebar, quiz history/review, charts, skeletons,
  lazy loading, accessibility and responsive passes.
- **Docs/ops** — README, deployment guide, `render.yaml`, secret
  scrubbing, dead-code removal.

What the agent did **not** do unsupervised:

- Every change was verified by execution, not by assertion:
  `tsc --noEmit` per package, Vitest suites, `next build`, and
  Playwright specs where runnable without a live backend.
- Database-backed suites auto-skip without `TEST_DATABASE_URL`; the
  agent reported skips explicitly instead of claiming coverage.
- Pre-existing failures (e.g. a stale nav test) were investigated and
  either fixed with evidence or reported as pre-existing — never
  silently edited to pass.
- Secrets were never committed: live keys were scrubbed from
  `.env.example`, and local `.env` files are gitignored.

## How to tell them apart in the repo

- Product AI: `packages/ai/`, `apps/api/src/services/{tutorService,quizService,questionGenerator,quizLlm}.ts`,
  `docs/AI_USAGE.md`, `docs/EVALUATION.md`.
- Development AI: this file + `docs/DEVELOPMENT_PROMPTS.md`. No
  development-agent output ships in the runtime bundle.
