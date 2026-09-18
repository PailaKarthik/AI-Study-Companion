# Data Flows

End-to-end paths through the system. Service/function names in
backticks are the real implementation.

## PDF flow (upload → queued → extracted → indexed)

```text
POST /api/projects/:projectId/materials (raw PDF bytes + ?filename=)
  → validate (MIME, %PDF- magic, size ceiling, sanitized name)
  → checksum dedup per project → PUT bytes to Neon Object Storage
  → QUEUED Material row + object metadata row + durable documentJob
  row → MATERIAL_UPLOADED
  → BullMQ aistudy.documents (document-<materialId>)
  → Worker document.process: download bytes from bucket → pdfjs text
  (+ headings, table hints) → tesseract OCR fallback for low-text
  pages → sharp embedded images → PUT PNGs to bucket + image metadata
  rows → DocumentPage rows (upsert by material+page) → material READY
  → chained knowledge.process (knowledge-<materialId>)
  → Worker knowledge.process: normalize → chunk (700/100 token targets)
  → KnowledgeChunk rows → Gemini batchEmbedContents (50/batch)
  → embedding vector(768) → knowledgeStatus READY
  → GET …/materials (list, polled live) / …/materials/:id/file
```

Failure anywhere → `FAILED` with persisted error: document failures
retryable via reprocess (re-runs extraction), knowledge failures via
reindex (rebuilds the index). Deterministic job ids collapse
duplicates. The browser never waits: material state is polled. Safe
rebuild — old chunks stay readable until the worker's final
transaction swaps them (reprocess clears stale chunks up front so
citations never outlive their pages).

## Tutor flow

```text
Question → POST …/tutor/ask → ownership check (404 covers foreign)
  → Conversation resolved/created (title from question)
  → history (last 20, capped) + searchProject (hybrid, project-scoped SQL)
  → system prompt (grounding + honesty rules) + user prompt
      (evidence as DATA + history as untrusted context, both truncated)
  → Groq chat (60s timeout, 2 attempts, retryable-only)
  → on failure: AIUsage FAILED|TIMEOUT + TUTOR_RESPONSE_FAILED, persist NOTHING
  → on success, ONE transaction: USER + ASSISTANT messages (sequence-guarded,
      P2002 retried 3×) + TutorEvidence rows + conversation touch + activities
  → score-neutral engagement markers (best-effort) + AIUsage SUCCESS
  → best-effort ai.evaluate enqueue → response with citations
```

## Quiz flow

```text
Create: POST …/quizzes → concept extraction (Groq JSON, sampled chunks)
  → per-concept batched generation (deduped, bounded retries)
  → Quiz + QuizQuestions (PUBLISHED)
Start: POST …/quizzes/:id/attempts (idempotency-key safe, active resumes)
Answer: POST …/attempts/:id/responses → MCQ graded deterministically vs key;
  open-ended graded by Groq rubric (Zod-validated) or EVALUATION_FAILED (kept, retried)
Complete: POST …/attempts/:id/complete → atomic claim (one twin wins)
  → completion activities (per-attempt keys) → result aggregate
  → processAttemptMastery → ConceptMastery EMA + MasteryEvents (dedupe index)
  → refreshRecommendations → growth/recs/analytics read the new state
```

## Analytics flow

```text
Any action → recordActivity (validated type, scrubbed metadata, optional
idempotency key) → ActivityEvent row (user/space/project scoped)
  → GET …/analytics|/home/analytics|/api/admin/* → PostgreSQL aggregation
      (counts, UTC day buckets, streaks, distributions — never table scans
      into memory) → dashboard (ranges switch the server-side window)
AIUsage rows ← every provider call; AIEvaluation rows ← worker pipeline.
```

## Auth flow

```text
Register/login → argon2id verify → HMAC session row (7d) + httpOnly cookie
  → per-request validateSessionToken (expiry + isActive, throttled touch)
  → logout revokes by hash (idempotent). Expired sessions pruned + active
  sessions capped (20) on every login.
```

