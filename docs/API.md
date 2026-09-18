# API

Base URL: `API_URL` (default `http://localhost:4000`). All responses are JSON.

## Conventions

- Success envelope: `{ "success": true, "data": <payload>, "requestId": "<id>" }`
- Error envelope: `{ "success": false, "error": { "code": "<CODE>", "message": "<human readable>", "details?": <json> }, "requestId": "<id>" }`
- Every response carries an `x-request-id` header (generated with `uuidv4` when the
  client does not supply one). Include it when reporting issues.
- Error codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
  `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500),
  `SERVICE_UNAVAILABLE` (503). Stack traces are never exposed in production.
- Unknown routes return `404 NOT_FOUND` in the same envelope.

## Endpoints (foundation)

### GET /health — liveness

Always `200`, no dependencies required.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "api",
    "version": "0.1.0",
    "uptimeSeconds": 12,
    "timestamp": "2026-09-16T00:00:00.000Z"
  },
  "requestId": "..."
}
```

### GET /ready — readiness

`200` when ready or when dependencies are simply unconfigured (`skipped`);
`503` only when a _configured_ dependency is down.

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "service": "api",
    "version": "0.1.0",
    "timestamp": "2026-09-16T00:00:00.000Z",
    "checks": {
      "database": { "status": "skipped", "detail": "DATABASE_URL is not configured" },
      "redis": { "status": "skipped", "detail": "Redis is not configured" }
    }
  },
  "requestId": "..."
}
```

## Auth

Session-cookie authentication (see `docs/SECURITY.md`):

- `POST /api/auth/register` (201) · `POST /api/auth/login` (200) — validate with
  Zod, set the `httpOnly` session cookie. Login failures are generic 401s.
- `POST /api/auth/logout` (200, always) · `GET /api/auth/me` (200, safe user only).

## Spaces (all require authentication)

- `GET /api/spaces?page=1&pageSize=20&q=` → `{ items, page, pageSize, total }`.
  Only the caller's spaces, newest first, each with `projectCount` (no `userId`
  accepted — identity comes from the session).
- `POST /api/spaces` (201) — `{ name, description?, icon?, color? }`. Trimmed,
  bounded, strict (unknown keys rejected). Duplicate name per owner → 409.
- `GET /api/spaces/:spaceId` (200) — detail + `projectCount`. Missing _or_
  foreign → identical 404 (no existence oracle).
- `PATCH /api/spaces/:spaceId` (200) — partial `name/description/icon/color`
  (nullable to clear); `ownerId` and unknown fields rejected; empty patch → 400.
- `DELETE /api/spaces/:spaceId` (200 `{ id }`) — permanent; cascades to
  projects and all nested learning data per the schema design.

## Projects (all require authentication + ownership)

- `GET /api/spaces/:spaceId/projects?page=&pageSize=&q=` — space ownership
  verified first; projects of that space with `materialCount`/`conceptCount`.
- `POST /api/spaces/:spaceId/projects` (201) — `{ name, description?, goal? }`,
  default status `ACTIVE`. Creation inside a foreign space → 404. No
  `userId`/`ownerId`/`spaceId` accepted from the body.
- `GET /api/projects/:projectId` (200) — detail + owning space ref; records
  `PROJECT_VIEWED` and touches `lastActivityAt` (view tracking never breaks
  the read).
- `PATCH /api/projects/:projectId` (200) — partial `name/description/goal/status`
  only; owner/space/timestamps immutable; empty patch → 400.
- `DELETE /api/projects/:projectId` (200 `{ id }`) — permanent cascade;
  material bytes (`material_blobs`) cascade with their materials.
- `GET /api/projects/:projectId/overview` (200) — lightweight dashboard
  aggregate: project + space, counts (materials/concepts/conversations/
  quizzes/assessments), mastery summary, last 10 activity rows, up to 5
  pending recommendations. No messages, document contents, or histories.

## Home

- `GET /api/home` (200) — per-user aggregation: `continueLearning` (most
  recently active project), `recentProjects` (5), `stats` (spaces/projects/
  active), `progress` (`average` is mean mastery or `null` when unassessed),
  `attention` (assessed concepts under 70%), `nextAction` (oldest pending
  recommendation). Nulls/empties mean "no data yet" — never fabricated.

## Activity events recorded

`USER_REGISTERED|LOGIN|LOGOUT`, `SPACE_CREATED|UPDATED|DELETED|VIEWED`,
`PROJECT_CREATED|UPDATED|DELETED|VIEWED`, `MATERIAL_PROCESSING_*`,
`MATERIAL_RETRY_REQUESTED`, `TUTOR_INTERACTION|CONVERSATION_CREATED|
RESPONSE_FAILED`, `QUIZ_*`, `ASSESSMENT_STARTED|COMPLETED`,
`MASTERY_UPDATED`, `CONCEPT_IMPROVED|NEEDS_ATTENTION`,
`RECOMMENDATION_CREATED|COMPLETED|DISMISSED`, `GROWTH_ANALYZED`
(each with `userId`, `spaceId`/`projectId` where applicable, `entityType`,
`entityId`, optional idempotency key). Core mutations write the event in
the same transaction; view-event logging warns-but-survives so reads stay
up. Full taxonomy + safety rules: `docs/ANALYTICS.md`.

## Progress definition

No single invented percentage exists. `average` = mean `masteryScore`
across the user's `ConceptMastery` rows (per project in overview, global
on home), or `null` when zero rows exist — the UI renders "No progress
yet". Attention uses a documented 0.7 threshold pending real Growth
Analysis. See `docs/ARCHITECTURE.md`.

## Project materials

- `GET /api/projects/:projectId/materials?page&pageSize` (200) — owned
  materials with document status + knowledge state (`knowledgeStatus`,
  `knowledgeUpdatedAt`) + chunk/image counts + `sizeBytes`/`hasFile`,
  as a `Paginated` envelope.
  `pageSize` is clamped server-side (oversized values → 400, never an
  unbounded read). No page contents, no bytes.
- `POST /api/projects/:projectId/materials?filename=` (201) — upload a
  PDF as the raw request body (`Content-Type: application/pdf`).
  Server validates MIME + `%PDF-` magic + size ceiling
  (`STORAGE_MAX_UPLOAD_BYTES`) + sanitized filename, dedupes by
  checksum per project (`deduplicated: true` returns the existing
  material), PUTs the bytes to the Neon Object Storage bucket under an
  isolated key (`users/<u>/spaces/<s>/projects/<p>/materials/<m>/
original.pdf` — never PostgreSQL), creates the
  material as `QUEUED` with a durable `documentJob` row, records
  `MATERIAL_UPLOADED`, and enqueues `document.process` — Upload →
  Queued is automatic. Response carries `enqueued` + `jobId`
  (`enqueued: false` when the queue is unreachable: bytes are stored,
  the material stays `QUEUED`, retry via reprocess). Invalid/
  oversized/non-PDF input → 400.
- `GET /api/materials/:materialId/file` (200) — download/view bytes
  streamed from the bucket (ownership-checked;
  `Content-Disposition: inline`, `ETag` = checksum).
  Unknown/foreign → identical 404; rows without a bucket object → 404
  directing re-upload. Unconfigured storage → 503.
- `GET /api/materials/:materialId/images` (200) — extracted-image
  metadata (id, page, MIME, dimensions, size, checksum; never bytes,
  never bucket keys). Unknown/foreign → identical 404.
- `GET /api/materials/:materialId/images/:imageId/file` (200) — image
  bytes streamed from the bucket (ownership-checked through the
  material → project chain). Unknown/foreign → identical 404; missing
  object → 404 directing reprocess.
- `DELETE /api/materials/:materialId` (200 `{ id, blobsDeleted }`) —
  deletes the material, its stored objects, and cascaded
  pages/chunks/jobs; records `MATERIAL_DELETED`.
- `POST /api/materials/:materialId/reprocess` (202) — re-run
  document extraction (text/OCR/images → `READY` → chained knowledge
  rebuild) for an owned material with stored bytes. Unknown _or_
  foreign → identical 404; byte-less rows → 404 directing re-upload.
  Fresh `QUEUED`/`PROCESSING` work → 409. Resets document `QUEUED` +
  knowledge `NOT_STARTED`, deletes stale knowledge chunks, refreshes
  the durable job row. Unreachable queue → 503 (material marked
  `FAILED`, never stuck).
- `POST /api/materials/:materialId/reindex` (202) — queue knowledge
  (re)build for a document-`READY` material. Unknown _or_ foreign →
  identical 404. Non-READY → 409. Fresh `QUEUED`/`PROCESSING` work → 409. Unconfigured/unreachable queue → 503 (and the material is marked
  `FAILED` with the enqueue error, never left `QUEUED` forever).

## Project search (hybrid retrieval)

- `POST /api/projects/:projectId/search` (200) — body
  `{ "query": "…", "limit"?: 1–50, "materialId"?: "<uuid>" }`
  (strict; query trimmed 1–500 chars). Requires auth + project ownership
  (404 covers foreign). Dedicated rate limiter (search/reindex share it:
  both can trigger embedding work).
- Response: `{ query, projectId, results[], meta }`. Each result carries
  `chunkId`, `materialId`, `materialName`, `pageId`/`pageNumber`,
  `content`, `score`, and `retrieval: { semantic, lexical, combined }`
  (`null` for the path that didn't match). `meta` holds
  `lexicalMs/semanticMs/rankingMs/totalMs/resultCount`.
- Scores are [0, 1] similarities (cosine-derived + min-max normalized
  `ts_rank_cd` blend), not probabilities. Empty corpus → `results: []`,
  never fabricated evidence. Only chunks from document-`READY`,
  knowledge-`READY` materials are retrievable.
- See `docs/SEARCH_ARCHITECTURE.md` for the full design.

## Tutor (grounded chat)

- `POST /api/projects/:projectId/tutor/ask` — body `{ message,
conversationId? }`. Retrieval + Groq generation run before any write;
  one transaction then persists both messages + evidence + activities
  (concurrent turns retry on sequence races, max 3). Failure persists
  nothing (usage `FAILED`/`TIMEOUT` + `TUTOR_RESPONSE_FAILED` only).
- `GET /api/projects/:projectId/conversations` (50 latest) and
  `GET …/conversations/:conversationId` — detail returns the most-recent
  500 messages with `messagesTruncated` + true `messageCount` (threads
  are append-only and unbounded otherwise).

## Future (not yet implemented)

PDF text extraction (bytes → pages) is the remaining pipeline stage;
upload, storage, download, delete, and knowledge indexing are live, and
extraction follows the same envelope, error codes, and layering.

## Analytics

- `GET /api/projects/:projectId/analytics?from&to` (200) — owned-project
  aggregates: totals (activity, streak/activity days, materials by status,
  tutor, quizzes/attempts/completions, assessments + average score,
  concepts, recommendations by outcome), UTC day-bucketed activity series,
  mastery distribution + daily-mean trend, recent activity (10). Defaults
  to trailing 30 days, max 366; inverted/overlong/unparseable ranges → 400.
  Foreign projects → identical 404. Empty states are zeros/nulls.
- `GET /api/home/analytics?from&to` (200) — user-scoped totals, activity
  series, recent activity (15). Complements `GET /api/home` (untouched).

## Admin (all routes require ADMIN — 403 otherwise)

- `GET /api/admin/overview?from&to` — users, spaces/projects, materials,
  learning, AI (calls, success/fail, tokens, estimated USD, latency),
  jobs (status counts, failure rate, mean duration).
- `GET /api/admin/users?q&role&page&pageSize` — safe summaries + counts,
  never password hashes or tokens.
- `GET /api/admin/users/:userId` — journey: account, spaces, activity,
  mastery, recommendations. Unknown id → 404.
- `GET /api/admin/spaces`, `GET /api/admin/projects` — paginated with
  owners and counts.
- `GET /api/admin/activity?...` — event stream with date/user/type/
  space/project filters, asc/desc sort, pagination.
- `GET /api/admin/learning?from&to` — completion, accuracy, assessments,
  mastery distribution, improving/attention, recommendations, repeated
  mistakes, activity series.
- `GET /api/admin/ai-usage?...` — call ledger with feature/provider/
  status filters; costs are estimated USD.
- `GET /api/admin/ai-evaluations?feature` — quality rows with available
  metric keys (values stay server-side).
- `GET /api/admin/jobs?...` — persisted job rows with type/status
  filters, durations, errors.
- `GET /api/admin/system-health` — database (timed), Redis/AI key
  presence, Neon Object Storage bucket reachability (HeadBucket, no
  values read), worker liveness from job history. No secrets, no connection
  strings, no expensive probes.

## Quizzes (adaptive assessment)

- `POST /api/projects/:projectId/quizzes` (201) — body
  `{ "title"?, "description"?, "questionCount"?: 1–20 (default 10), "mode"?: ADAPTIVE |
CONCEPT_FOCUS | MIXED_REVIEW (default ADAPTIVE), "typePreference"?: MCQ | OPEN_ENDED,
"difficulty"?: BEGINNER | INTERMEDIATE | ADVANCED, "conceptIds"?: ["<uuid>", …] }`
  (strict; `CONCEPT_FOCUS` requires non-empty `conceptIds` naming owned
  concepts). Generates grounded questions from project knowledge (concept
  extraction runs once when the project has none) and persists the quiz
  with `PUBLISHED` status. Empty corpus → 400; unconfigured LLM → 503.
  Strict generation limiter (10 / 15 min).
- `GET /api/projects/:projectId/quizzes` (200) — `{ id, title, status,
mode, questionCount, attemptCount, latestAttempt, createdAt }[]`
  (latest attempt is the caller's; no question payloads).
- `GET /api/projects/:projectId/concepts` (200) — concept list for focus
  selection (no mastery values — Prompt 10 owns those).
- `GET /api/quizzes/:quizId` (200) — metadata + questions with options,
  concept, difficulty, order — but NEVER `correctAnswer`, `explanation`,
  or rubric key points. Unknown _or_ foreign → identical 404.
- `POST /api/quizzes/:quizId/attempts` (200) — body `{ "restart"?: bool,
"idempotencyKey"?: string }` (both optional; empty body accepted).
  Returns the active attempt when one exists (resume) unless
  `restart: true`; duplicate `idempotencyKey` replays the winner.
- `GET /api/quiz-attempts/:attemptId` (200) — attempt state with
  per-question `answered/isCorrect/score/feedback/explanation` (keys join
  only answered questions) plus `answeredCount/questionCount`.
- `POST /api/quiz-attempts/:attemptId/responses` (200) — body exactly one
  of `{ "questionId", "selectedOption" }` (MCQ, must match a stored option)
  or `{ "questionId", "responseText" }` (open-ended, 1–4000 chars).
  The question must belong to the attempt's quiz (else 404). Identical
  resubmission is idempotent (and retries failed evaluations); changed
  answers → 409; completed attempts → 409. Open-ended answers evaluate
  synchronously; failures persist the answer with
  `evaluationState: EVALUATION_FAILED`.
- `POST /api/quiz-attempts/:attemptId/complete` (200) — requires all
  questions answered (else 409 with `missingQuestionIds`) and all
  evaluations resolved (else 503, attempt stays open). Returns the
  `QuizResult`: score/maxScore, correct/incorrect/open-ended counts,
  per-concept performance, strengths/weak areas, open-ended reviews with
  server-resolved source refs. Idempotent once completed.
- See `docs/QUIZZES.md` and `docs/ASSESSMENTS.md` for the adaptive
  algorithm, generation constraints, evaluation schema, and failure handling.
