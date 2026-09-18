# Learning loop

The complete evidence flow, every stage persisted and idempotent:

```text
Quiz completed
  ↓  (post-commit hook in completeAttempt; re-complete reconciles)
Responses evaluated (precondition — unevaluated answers carry no signal)
  ↓
Concept evidence (MCQ correctness / open-ended score × confidence)
  ↓
Mastery update (EMA per concept, one transaction, idempotent events)
  ↓
Growth analysis (computed on read from event windows)
  ↓
Repeated-mistake detection (threshold → LearnerContext, deleted on resolve)
  ↓
Recommendation refresh (rank → dedupe → expire/complete → persist)
  ↓
Learner acts (quiz / material / dismiss) → new evidence → loop repeats
```

Tutor turns feed the loop as score-neutral exposure markers when the
chat cites quizzed material (chunk → question-source → concept trace);
they touch `lastActivityAt` and history only — never scores.

## Hook points

- `quizService.completeAttempt` → `processAttemptMastery` (post-commit,
  loud on failure; the idempotent re-complete path reconciles, so
  nothing is silently lost).
- `tutorService.askTutor` → `linkChunksToConcepts` +
  `recordTutorEngagement` (best-effort: display-only markers must never
  500 a delivered chat turn; logged on skip).
- `useCompleteAttempt` (web) invalidates attempt, quiz, overview,
  growth, recommendations, and home caches.

## Queue-ready, not queue-mandatory

`processAttemptMastery` is a plain service: deterministic math, bounded
reads, short transactions, zero AI/network calls. It runs synchronously
today because it is fast and reliable; moving it to BullMQ later means
adding a producer call plus a worker handler around the unchanged
function — no rewrite. No new queue infrastructure was created for this
stage (the knowledge queue in `lib/queues.ts` is untouched).

## Events (all via existing ActivityEvent)

`MASTERY_UPDATED` (one per processed attempt), `GROWTH_ANALYZED` (one
per refresh), `RECOMMENDATION_CREATED` (per new row),
`RECOMMENDATION_COMPLETED` (learner action, mastered goal, or
superseded), `RECOMMENDATION_DISMISSED` (learner action). No per-event
spam: growth emits nothing per read, tutor markers emit no activity.

## Performance

- Writes: one transaction per attempt; reads bounded (200 recent
  responses, 20 events/concept, capped relations/questions).
- Reads: indexed filters on every query; growth computed from bounded
  windows; no full-history scans; no per-request mastery recalculation
  (mastery is maintained incrementally, growth derives from events).
- Indexes: migration 0004 adds `(sourceType, sourceId)` on
  `mastery_events` for the idempotency check; existing
  `(userId, projectId[, conceptId])` and `(projectId, status)` indexes
  cover the rest — no other index changes.
