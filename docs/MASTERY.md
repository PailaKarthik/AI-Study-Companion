# Concept mastery

Deterministic per-concept learning state from persisted evidence. No ML
service, no Groq calls, no fake percentages — just an understandable
exponential moving average over graded proof.

## The estimate

One `ConceptMastery` row per (user, project, concept): `masteryScore` and
`confidence` in [0, 1], `evidenceCount`, `lastAssessedAt`,
`lastActivityAt`. Same concept names in different projects never share
rows (projectId is part of the key). Every change is journaled as an
append-only `MasteryEvent` with source, previous/new scores, delta,
confidence, and a reason — the audit trail growth analysis reads.

Status bands derive from score (configurable): `[0, 0.4)`
NEEDS_ATTENTION, `[0.4, 0.65)` DEVELOPING, `[0.65, 0.8)` STABLE,
`[0.8, 1]` STRONG. No status column exists on purpose: bands stay a
presentation of evidence, never stored truth that can drift.

## Update rule

```
new = old × (1 − w) + score × w
```

per evidence item (oldest first), with

```
w = min(maxSingle, base(kind) × difficulty × quality × recency)
```

## Weights (starting values, documented as such)

| Source                               | Base weight | Quality                         |
| ------------------------------------ | ----------- | ------------------------------- |
| MCQ (`QUIZ`)                         | 0.45        | 1 (deterministic key)           |
| Open-ended (`OPEN_ENDED_ASSESSMENT`) | 0.35        | evaluator confidence            |
| Learning activity                    | 0.10        | fixed, low                      |
| Grounded tutor engagement            | 0.10        | neutral (score-neutral markers) |

Assessment evidence (0.80 combined) structurally dominates passive
signals: no volume of chat or clicks can overwhelm graded proof.
Uncertain Groq evaluations are discounted by their own confidence —
never treated as equivalent to a deterministic answer key.

## Difficulty factors

Correct: BEGINNER 0.8, INTERMEDIATE 1.0, ADVANCED 1.25 (ungraded: 1.0).
Incorrect: BEGINNER 1.25, INTERMEDIATE 1.0, ADVANCED 0.8. Difficulty
scales the _weight_, never the score: hard-correct moves mastery more,
easy-wrong signals a deeper gap, hard-wrong is discounted as expected
struggle. `MASTERY_MAX_SINGLE_WEIGHT` (0.6) caps any single item.

## Recency

Half-life decay (`0.5^(ageDays/30)`) floored at 0.4: recent evidence
counts most, old evidence still counts, and mere absence never
aggressively decays mastery. Staleness is surfaced by growth analysis,
not by silently draining scores.

## Repeated mistakes and success

EMA is inherently bounded: repeated wrong answers drive scores toward —
but never below — 0, with each step closing a fraction of the remaining
gap (no runaway negatives, no `if correct then +10%`). Repeated success
converges toward 1 with diminishing returns (six easy-corrects land
≈0.9, never instantly 1.0). Separately, ≥3 incorrect responses across
≥2 attempts raises a `REPEATED_MISTAKE` LearnerContext row (deleted on
resolution); single answers never become traits.

## Confidence

Count-based: `min(0.95, 1 − 1/(1 + 0.5n))`. More evidence → surer
estimate. Presented as an internal signal, never statistical certainty.

## Idempotency and transactions

`(sourceType, sourceId=responseId, conceptId)` is checked before writing
(indexed by migration 0004) — re-processing an attempt is a no-op. Each
concept's event + row update commits in one short Prisma transaction;
the whole attempt's concepts commit in one transaction with no AI or
network calls inside. Tutor markers are idempotent on
`(TUTOR_INTERACTION, messageId, conceptId)` and score-neutral by design.
