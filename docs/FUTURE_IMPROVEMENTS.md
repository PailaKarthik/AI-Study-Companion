# Future Improvements

Ideas only — **none of this is implemented**. Listed so reviewers can
distinguish roadmap from reality. Ordered roughly by value per effort.

## Retrieval & tutor quality

- **Streaming tutor responses** — token-stream the answer into the
  existing thinking card (the API currently returns one JSON payload).
- **Gold evaluation dataset** — a fixed set of materials + questions
  with expected citations/answers, so `docs/EVALUATION.md` metrics get
  published baselines before any model or prompt tuning.
- **Reranking** — cross-encoder rerank over the hybrid candidate set;
  measure with the gold set above, not by gut feel.
- **Follow-up suggestions** — grounded follow-up chips derived from
  retrieved (not invented) content.

## Documents

- **Page rasterization** — canvas-based rendering for scanned PDFs
  without embedded images (currently an honest FAILED).
- **Multilingual OCR** — additional `traineddata` languages beyond the
  vendored English set.
- **Multimodal tutor context** — page-image regions for diagrams and
  chart questions, with region citations.

## Product

- **Notifications** — processing-complete and recommendation nudges
  (email or in-app inbox).
- **Spaced repetition** — schedule reviews from mastery half-life
  instead of only listing weak concepts.
- **Share/export** — quiz/result PDF export, read-only project links.
- **Reconnect backoff** — wrap first-query failures so Neon idle
  wake-ups never surface as 500s.

## Platform

- **Horizontal worker scaling** — queue sharding + autoscaling policy
  beyond single-instance `WORKER_CONCURRENCY`.
- **Retention controls** — configurable job/activity retention windows.
- **Multi-region reads** — only if latency data justifies it; the
  current single-region design is deliberate for a 512 MB budget.
