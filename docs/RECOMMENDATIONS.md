# Recommendations

Deterministic next-action engine. The core decision — _what_ to recommend
— is server-side ranking over persisted evidence. Groq is never asked
"what should this learner study"; no LLM call exists anywhere in this
path (no cost, no latency, no unpredictability).

## Candidate rules (all require assessed evidence)

| Situation                                      | Type                                | Priority |
| ---------------------------------------------- | ----------------------------------- | -------- |
| NEEDS_ATTENTION trend + ≥2 recent mistakes     | REVISIT ("Retry X")                 | URGENT   |
| Mastery < 0.4 or NEEDS_ATTENTION               | REVIEW ("Review X")                 | HIGH     |
| Prerequisite of a weak concept, not yet strong | REVIEW ("Strengthen X to unlock Y") | HIGH     |
| Developing (0.4–0.65)                          | PRACTICE ("Practice X")             | MEDIUM   |
| Improving trend                                | PRACTICE ("Keep practicing X")      | LOW      |
| Strong (≥0.8) with related concepts            | EXPLORE ("Explore Y")               | LOW      |
| Concepts exist, none assessed                  | NEXT_STEP ("Take a quiz")           | LOW      |

Strong concepts with nowhere to go, stable mid-range concepts, and
unassessed concepts produce _no_ candidate — silence beats busywork.
This is deliberately not `score < 50 → "study more"`: every rule keys
off multiple corroborating signals.

## Ranking

`priority × 10 + (1 − mastery) × 5 + min(2, recentMistakes) + 1.5 when
supporting a weak concept`, ties by concept id. Deterministic: same
state in, same order out. Home and overview surface the top-ranked
pending row.

## Explanations

Each row persists a factual `reason` ("You've missed 3 recent JOINs
questions and mastery sits at 32%…", prerequisite notes included).
Unsupported claims cannot occur — reasons are stringbuilt from the same
numbers that ranked the candidate.

## Targets are always valid

- REVIEW → the concept's latest question-source material
  (`REVIEW_MATERIAL`), else concept practice.
- REVISIT / PRACTICE → concept practice (quiz tab generates).
- EXPLORE → a related concept that exists.
- NEXT_STEP → the quiz tab.
  Material links trace through server-persisted question sources, never
  client input or model output — no dead links.

## Lifecycle (existing `RecommendationStatus`)

PENDING → COMPLETED (learner acted, or the goal was achieved: mastery
reached STRONG) → terminal; PENDING → DISMISSED (learner choice) →
terminal; PENDING → EXPIRED (evidence moved on: the action is no longer
prescribed). Refresh transitions stale rows automatically and emits
`RECOMMENDATION_*` activity.

## Refresh (`refreshRecommendations`)

Load mastery → analyze growth → map relations/materials → rank
candidates → dedupe against pending `(type, concept)` → expire stale →
complete achieved → persist new (capped). Deterministic end to end.
Staleness is judged against the rebuilt set _before_ dedup, so valid
rows are never expired by their own twin. Double refresh is a no-op.

## UI contract

Reasons render verbatim; CTAs navigate to quiz/materials/project tabs;
complete/dismiss are one tap with targeted cache invalidation. The
result page distinguishes assessment results from long-term mastery,
and the growth board never shows 0% as measured progress.
