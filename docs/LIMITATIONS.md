# Known Limitations

Genuine limitations of this implementation — no invented items.

## Product

- **Document pipeline is live**: PDFs upload into the Neon Object
  Storage bucket (validated, deduped) and auto-queue `document.process` — pdfjs text
  extraction, tesseract OCR fallback for image-only pages, embedded
  images stored as bucket objects with `EXTRACTED_IMAGE` metadata — then chain knowledge
  indexing automatically. Upload → Queued → Processing → Ready →
  Searchable works end to end (covered by E2E with the test double;
  production needs bucket credentials).
- **OCR is English-only and image-bound**: language data is the
  vendored `eng.traineddata` (offline, no CDN); OCR runs over each
  low-text page's _embedded_ images — pages are never rasterized via
  canvas, so scanned PDFs without embedded images yield no text, and
  OCR accuracy bounds those that do. Oversized materials (>500 pages,
  > 50 images) fail loudly instead of partial-processing.
- **AI edge cases**: thin corpora produce refusals (by design), but a
  well-written irrelevant document can still ground a
  confidently-cited wrong answer — citations make it checkable, not
  impossible.
- **Estimated costs**: dashboard spend is computed from a versioned
  pricing table (`asOf 2026-09-01`); real bills differ (tiers,
  retries, failures). Unknown models report null, not zero.

## Platform

- **Provider rate limits**: Groq/Gemini 429s surface as 503s; bursts
  (quiz generation) are additionally throttled client-side.
- **No gold evaluation dataset**: automated metrics are structural
  (citations resolve, scores persist); semantic quality needs the
  human procedures in `docs/EVALUATION.md`.
- **Browser/device variance**: verified on desktop Chromium
  (Playwright); mobile Safari/older browsers get responsive layouts
  but no dedicated device testing.
- **Plan constraints**: background processing, cron-like scheduling,
  and retention (Neon point-in-time restore, Upstash persistence)
  depend on the chosen plans — confirm in each console before
  promising RPO/RTO.

## Operations

- **Not yet publicly deployed**: configured and locally verified; no
  public URL is claimed.
- **Worker has no HTTP health endpoint**: liveness is inferred from
  process state + `system.health` completions + `DocumentJob` history.
- **Rate limits degrade per-instance** when Redis is unavailable.
- **Long threads truncate reads** (most-recent 500 messages, flagged).
