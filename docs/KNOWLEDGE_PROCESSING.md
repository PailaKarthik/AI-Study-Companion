# Knowledge processing

Full pipeline: `Upload → QUEUED → document.process (pdfjs text +
tesseract OCR + sharp images → DocumentPages, material READY) →
chained knowledge.process → normalize → chunk → KnowledgeChunk →
Gemini embeddings → pgvector + FTS → knowledge READY`. Every stage is
a BullMQ job, so processing continues with the browser closed; the
material row is the source of truth for progress.

## Triggering

Knowledge work starts from exactly two places, both funneling into
`enqueueKnowledgeProcessing(materialId)` with the deterministic BullMQ
`jobId = knowledge-<materialId>` (duplicate enqueues collapse in Redis):

1. **Document-pipeline chain (primary)** — when the document worker
   marks a material `READY`, it enqueues the knowledge job
   (`manual: false`) on the shared Redis connection. A chaining
   failure never un-readies the document: it records knowledge
   `FAILED` with a "retry indexing" hint instead.
2. **`POST /api/materials/:materialId/reindex`** (manual rebuild) —
   requires auth + project ownership, material document-`READY`, and no
   fresh `QUEUED`/`PROCESSING` work (409 otherwise). Marks `QUEUED`,
   enqueues, returns 202. Rolls back to `FAILED` if enqueue itself fails.

## Document stage (`document.process`, `aistudy.documents`)

Consumed by the worker's document consumer (5 attempts, exponential
5s backoff; permanent failures arrive as `UnrecoverableError`).
Deterministic jobId `document-<materialId>`; durable `DocumentJob`
row (`TEXT_EXTRACTION`) created by the API at upload/reprocess time,
mirrored by the worker.

`processMaterialDocument` (service-testable without Redis):

- loads the material + downloads the source PDF from the Neon Object
  Storage bucket by `storageKey` (missing object
  → `re-upload` Unrecoverable; checksum mismatch → integrity
  Unrecoverable; unconfigured storage → `not configured`
  Unrecoverable); marks `PROCESSING` (attempts +1);
- pdfjs-dist headless text pass: per-page text with newline
  preservation, pattern-detected headings, conservative table hints —
  content is never paraphrased, structure never invented. Encrypted
  PDFs → permanent `FAILED`; per-page failures record that page as
  empty with a warning instead of killing the other pages;
- sharp embedded-image pass: image XObjects resolve via `page.objs`
  (no canvas), convert to PNG in memory, uploaded as bucket objects
  keyed `users/<u>/spaces/<s>/projects/<p>/materials/<m>/images/
  page-<n>-<hash>.png` with metadata rows (key, MIME, size, checksum,
  page, dimensions) in PostgreSQL.
  Images are capped (`DOCUMENT_MAX_IMAGES_PER_MATERIAL`, default 50);
  overflow counts as skipped. Image bytes are never sent to Gemini and
  never embedded into pgvector — they stay associated with their
  material/page so the Tutor can selectively use relevant visuals later;
- tesseract.js OCR fallback: only pages below
  `DOCUMENT_OCR_TEXT_THRESHOLD` chars (default 50), only over that
  page's own embedded images. Language data is the vendored
  `apps/worker/assets/tessdata/eng.traineddata` (offline — no CDN);
  `TESSERACT_LANG_PATH` overrides. Real text always counts; OCR
  supplements it. A disabled/missing engine never fabricates text —
  pages record `source: empty` honestly;
- pages upsert by `(materialId, pageNumber)` with `extractedText`,
  `charCount`, and metadata (`headings`, `possibleTable`, `source`,
  `ocrConfidence`, `imageCount`, `contentHash`); ghost pages/images
  beyond the new page count are deleted; zero extractable text
  anywhere → permanent `FAILED`;
- marks the material `READY` (`pageCount`, `processedAt`) and chains
  the knowledge job.

No temporary files exist anywhere in this flow (all buffers stay in
memory), so there is nothing to clean up on success, retry, or crash.

## Reprocessing

`POST /api/materials/:materialId/reprocess` (202): owned + stored
bytes required (byte-less rows → re-upload 404), 409 on fresh
`QUEUED`/`PROCESSING` work, resets document `QUEUED` + knowledge
`NOT_STARTED`, deletes stale knowledge chunks (citations must not
outlive their pages), refreshes the durable job row, enqueues. The
Materials tab routes Retry by stage: document-`FAILED` →
"Retry extraction" (reprocess), `READY` + knowledge-`FAILED` →
"Retry indexing" (reindex).

## Material state model

`Material.knowledgeStatus` (`NOT_STARTED → QUEUED → PROCESSING →
READY`, `FAILED` on error) is independent of `Material.status`.
A document can be readable (`READY`) while its index is still building,
and embedding failures mark knowledge `FAILED` while the PDF stays
usable. `knowledgeError` (truncated) records the last failure;
`knowledgeUpdatedAt` timestamps transitions.

## Text normalization (source fidelity first)

`DocumentPage.extractedText` is never rewritten. Normalization produces
processing text only:

- collapse whitespace runs, trim, cap runaway blank lines;
- de-hyphenate words broken across lines (`exam-\nple` → `example`);
- strip repeated headers/footers when safely detectable: identical
  trimmed lines (8–120 chars) on ≥3 pages and ≥half of all pages;
- drop pages that normalize to empty (counted as `skippedEmptyPages`).

Content is never paraphrased or "cleaned" beyond this.

## Chunking (deterministic, page-scoped)

`planChunks(pages, { targetTokens: 700, overlapTokens: 100 })`:

- paragraphs split on blank lines; headings detected by pattern only
  (`Chapter N`, numeric outlines, ALL-CAPS) and stored as
  `metadata.sectionTitle` — never invented;
- greedy packing to ~700 tokens (chars/4 approximation, documented);
- oversized paragraphs split on sentences, then words, then chars;
- ~100-token trailing overlap prepended to the next chunk;
- chunks never span pages, so every chunk cites exactly one page;
- `chunkIndex` is a global sequence per material; `contentHash` is
  SHA-256 of the normalized chunk content.

Same pages + same options ⇒ byte-identical plan (unit-tested).

## Embeddings (`gemini-embedding-001`, 768)

Chunk texts embed with `taskType: RETRIEVAL_DOCUMENT` via
`batchEmbedContents` (configurable batch size, default 50). The model
is called with explicit `outputDimensionality: 768` so output always
matches the `vector(768)` column; any width mismatch throws
`EmbeddingDimensionError` (permanent) instead of persisting garbage.

Retry: 429/5xx/network/timeout → exponential backoff with jitter,
bounded attempts (default 4); 400/malformed/dimension errors are
permanent. BullMQ retries transient job failures with its own backoff.

Cost posture: one batched provider call per material (not per chunk),
skip-on-identical-hash on reprocessing, exactly one query embedding
per search, no per-search re-embedding, no LLM calls in this prompt.

## Idempotency

- Deterministic `(materialId, chunkIndex)` unique key + upsert.
- `contentHash` compare: identical hash + existing vector ⇒ skip
  (no re-embed, no rewrite).
- Stale indexes (beyond the new plan) deleted in the final transaction.
- Content upserts + vector writes + stale deletes + READY marking all
  commit in ONE transaction — a crash never leaves half-built knowledge
  behind valid-looking state.
- All decisions derive from the database, never memory: retries,
  restarts, duplicate jobs, and manual reindex are all safe.

## Safe rebuild (reindex)

Existing chunks stay readable until the replacement transaction
commits — reindex never deletes knowledge up front.

## Observability

Processor logs: `jobId, materialId, projectId, attempt, chunkCount,
embeddedChunkCount, skippedChunkCount (implied), failedChunkCount,
durationMs, status`. Every embedding call (ingest batches + query
embeddings) writes an `AIUsage` row (`feature: EMBEDDING`,
model, latency, input tokens, SUCCESS/FAILED). Never logged: API keys,
document contents, vectors, signed URLs. `estimatedCost` stays null:
Gemini reports no per-call spend and hardcoded rates would go stale —
`inputTokens` is recorded so cost can be derived later.

## PDF immutability

PDF bytes are immutable after upload. New PDFs get their own Material
identity/checksum and process independently. Deleting a material
removes metadata (pages + chunks + vectors + object references via
relational `onDelete: Cascade`) and then every referenced bucket
object explicitly (tolerant of already-missing keys).

