# Quizzes (adaptive assessment)

Real adaptive learning assessment: project knowledge → concepts →
learner performance → generated quiz → persisted attempts → deterministic
MCQ scoring + Groq open-ended evaluation → assessment records that feed
the future mastery engine (Prompt 10).

## Flow

```text
POST /api/projects/:projectId/quizzes { questionCount, mode, ... }
  → ensure concepts (extract once from bounded knowledge, else reuse)
  → build per-concept signals (mastery, accuracy, mistakes, history)
  → selectTargets (deterministic, explainable)
  → grounded batch generation per (concept, type), validated + deduped
  → Quiz (PUBLISHED) + QuizQuestions persisted
GET /api/projects/:projectId/quizzes → counts only, no payloads
GET /api/quizzes/:quizId → questions WITHOUT correctAnswer/explanation
POST /api/quizzes/:quizId/attempts → start or resume (restart: true forces new)
GET /api/quiz-attempts/:attemptId → state; keys join ONLY answered questions
POST /api/quiz-attempts/:attemptId/responses → exactly one of selectedOption/responseText
POST /api/quiz-attempts/:attemptId/complete → score + aggregate, assessment records
GET /api/projects/:projectId/concepts → concept list for CONCEPT_FOCUS mode
```

## Modes

- `ADAPTIVE` (default): targets ranked by need across all concepts.
- `MIXED_REVIEW`: same selector, broader coverage intent (recorded in metadata).
- `CONCEPT_FOCUS`: allowlist (`conceptIds` required) + optional explicit difficulty.

`typePreference` (MCQ/OPEN_ENDED) wins outright when set; otherwise types
alternate. `difficulty` overrides the fitted level for focused practice.

## Adaptive selection (`quizAdaptive.ts`)

Pure function `selectTargets` — NOT "correct → harder / wrong → easier":

| Signal | Weight | Source |
|---|---|---|
| Need (1 − mastery, else 1 − accuracy, else 0.55 prior) | 0.35 | ConceptMastery / QuizResponse |
| Recent mistakes (incorrect / 5) | 0.25 | Recent QuizResponses |
| Freshness (unseen = 1, else staleness / 7d) | 0.15 | Response history |
| Prerequisite of a weak concept | 0.15 | ConceptRelation (PREREQUISITE) |
| Recent form (1 − recent accuracy) | 0.10 | Recent window |

Difficulty is fit from **aggregate** evidence (mastery → accuracy →
stated `INTERMEDIATE` default), never from the last answer. Unknown
concepts use a neutral prior recorded in `reasons` — never fake mastery.
Round-robin dealing guarantees diversity before deliberate
`repeated-exposure`. Ties break on `conceptId`: fully deterministic.

## Question generation (`questionGenerator.ts`)

One Groq call per (concept, type) group with bounded concept-scoped
evidence (lexical-first retrieval on the concept name — no whole-corpus
loads, no embedding calls during attempts). MCQ requires exactly 4 unique
options, one correct index, no all/none-of-the-above; open-ended requires
1–6 rubric key points (stored in `metadata`, never served pre-answer).
Every draft is Zod-validated and deduplicated against the batch and the
project's existing prompts (normalized compare), with
`QUIZ_GENERATION_RETRIES` bounded retries. Source chunk/material ids
persist in `metadata.source` for traceability. Empty corpus → 400, never
an empty quiz; unconfigured LLM → 503.

## Concept extraction (`conceptExtraction.ts`)

Runs once per project (skipped when concepts exist): ≤30 sampled chunks →
Groq structured output (≤15 concepts, normalized + case-insensitive
dedup, `upsert` on `(projectId, name)`) → RELATED/PREREQUISITE edges
resolved by name (self/dupes skipped). Project-scoped only.

## Responses & completion

- `QuizResponse @@unique(attemptId, questionId)`: identical resubmission
  is idempotent; changed answers → 409; completed attempts → 409.
- MCQ: `selectedOption` must match a stored option; compared to the stored
  key server-side; `Assessment` row (`system-deterministic`) written at submit.
- Open-ended: answer persists first (`PENDING_EVALUATION`), then
  synchronous Groq evaluation (see `docs/ASSESSMENTS.md`). Failures keep
  the answer as `EVALUATION_FAILED`; identical resubmission retries.
- Complete requires all questions answered (409 lists `missingQuestionIds`),
  evaluates outstanding open-ended answers, then persists
  `score/maxScore` + aggregate metadata and `QUIZ_*`/`ASSESSMENT_COMPLETED`
  activity. Completion is idempotent.

## Security

Ownership is project-chained everywhere (quiz → project → owner); foreign
ids 404 identically. Question ids are verified against the attempt's quiz.
Answer keys, explanations, and rubrics never leave the server before a
question is answered. Generation/evaluation settings come from server
config — strict schemas reject `model`/`temperature` overrides.

## Cost control

Batched generation, bounded retrieval, no per-question LLM calls beyond
the batch, no AI for MCQs, no embeddings during attempts, usage rows
(`QUIZ_GENERATION`, `ASSESSMENT`) on every call.

## Frontend

`features/quiz`: `QuizTab` (list/create) → `QuizTaker` (one question at a
time, server-backed progress `answered/total`, resume via start endpoint,
EVALUATION_FAILED retry) → `QuizResultView` (score, concept performance,
feedback, source refs, "assessment result, not mastery" framing).
