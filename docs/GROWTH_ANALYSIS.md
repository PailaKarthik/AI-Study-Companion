# Growth analysis

Server-side trend classification over `MasteryEvent` history. Pure
function (`growthAnalyzer.ts`), no LLM, no single-score judgments.

## Method

For each concept, take the bounded event window (default last 20),
split into an older half and a recent half, and compare half-means:

- `delta = mean(recent) − mean(older)`
- `trendStrength = |delta| / 0.3`, clamped to [0, 1]

Classification (defaults):

- Fewer than 3 events → **INSUFFICIENT_DATA** (strength 0, confidence 0).
  The UI renders an honest empty state — never a fabricated trend.
- Recent mean < 0.4 **with corroboration** (decline, recent accuracy
  < 50%, or ≥2 recent mistakes) → **NEEDS_ATTENTION**. A lone wrong
  answer on a flat history stays STABLE — one data point is not a
  verdict.
- `delta ≥ +0.05` → **IMPROVING** (e.g. 0.42 → 0.48 → 0.56 → 0.63).
- `delta ≤ −0.05` → **NEEDS_ATTENTION** (real decline).
- Otherwise → **STABLE** (e.g. 0.70 → 0.72 → 0.71 → 0.73).

## Signals consumed

Mastery-event trajectory (primary), recent response accuracy, recent
incorrect count, evidence depth. Concept relations feed the
_recommendation_ layer (prerequisite support), not the trend itself.

## Confidence

`min(0.9, 0.4 + 0.07 × (events − minimum) + 0.1 when the signal is
strong)`. Deeper histories and larger moves score higher. Documented as
an internal product signal — the API contract and UI copy say so
explicitly.

## Explainability

Every classification carries `reasons`: half-mean movement, mistake
counts, recent accuracy — factual strings the concept-detail endpoint
and UI render verbatim ("Why is this flagged?" is answered by data, not
by exposing weights).

## Reads, not writes

Growth is computed on read (`GET /growth`, concept detail, overview
counts) from indexed queries — bounded event windows, no full-history
scans, no persisted trend rows to drift. A `GROWTH_ANALYZED` activity
row is emitted per recommendation refresh for the future analytics
stage.
