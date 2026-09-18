# Evaluation Approach

How to judge whether the application works — methodology first, no
fabricated results. Deterministic checks run in CI; human judgment
procedures below are for reviewers with a deployed environment.

## Automated (runs today)

Deterministic evaluators (`EVALUATOR_VERSION =
system-deterministic-v1`, `apps/worker/src/jobs/ai-evaluation/`),
pure functions over persisted rows — no LLM judge, no cost, no loops.
`null` = not computable, never a guess.

**Tutor** (`evaluateTutorMessage`): `groundedness` (cited evidence when
supported, honest disclaimer when not), `citationValidity` (referenced
`[n]` markers resolving to evidence rows), `citationCoverage`
(evidence rows actually cited), `retrievalRelevance` (mean persisted
relevance score).

**Quiz/attempt** (`evaluateAttempt`): correctness (stored scores, not
re-graded), concept alignment (question↔concept links), difficulty
spread, diversity (distinct concepts/prompts), adaptivity (targeting
vs mastery state), plus relevance / concept coverage / evaluator
confidence aggregated from stored assessments.

**Mastery**: consistency (scores stay 0–1 — property-tested),
bounded per-item weight, full evidence traceability
(`MasteryEvent` → response/assessment), update behavior (EMA +
idempotent replays, concurrency-tested).

**Recommendations**: relevance (evidence-derived reasons), actionability
(working CTA targets), alignment (engine ranking vs learner state),
lifecycle validity (409 on illegal transitions — tested).

**Reliability**: job recovery (redelivery without duplication),
idempotency (replay tests), isolation (cross-user suites), error
handling (envelope + requestId). See `docs/RELIABILITY.md`.

Results live in `ai_evaluations` rows and the admin AI-evals explorer
(`scoreKeys`, per-metric scores, evaluator version). Current CI only
asserts the evaluators' unit behavior (17 tests) and pipeline
idempotency — there is **no fixed gold dataset with published scores**;
the first production corpus should baseline the metrics above before
any tuning (see Limitations).

## Manual review procedures

**Tutor groundedness**: seed a project with 2–3 known PDFs; ask (a) a
question answered on a specific page, (b) a question the corpus does
not cover. Expect (a) an answer citing the exact `[n]` source with a
matching evidence row, (b) the honest refusal. Check
`citationValidity = 1`, `citationCoverage > 0` for (a).

**Citation validity**: open any tutor answer, click through each cited
source label, confirm the page/section supports the claim. Spot-check
5 answers; record mismatches as issues, not scores.

**Quiz quality**: generate a 5-question quiz; verify one-correct-key
MCQs (4 unique options), concept tags matching the focus, difficulty
labels plausible, no duplicate prompts across batches. Answer one MCQ
wrong on purpose — feedback must reference the concept, and mastery
must move down for it.

**Assessment**: submit a partially-correct open-ended answer; the
rubric scores (correctness, relevance, concept coverage, reasoning,
confidence) must be in range with non-empty feedback. Kill the Groq
key mid-grading → answer preserved, `EVALUATION_FAILED`, resubmission
retries without data loss.

**Mastery/growth/recs**: complete two quizzes; growth must show
`INSUFFICIENT_DATA` before 3 events and real trends after; dismiss +
complete a recommendation and confirm analytics reflects the outcomes.

## What is NOT claimed

No BLEU/ROUGE/LLM-judge scores, no human-rating study, no comparison
against other tutors. The automated metrics measure structural quality
(citations resolve, scores persist, updates are bounded) — semantic
answer quality still needs human review per the procedures above.
