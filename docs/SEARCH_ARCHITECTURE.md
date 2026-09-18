# Search architecture

> Elasticsearch is intentionally not used because the project should remain
> deployable without requiring a separately hosted search infrastructure
> service. All retrieval lives in the existing Neon PostgreSQL + pgvector
> database. A dedicated search service (OpenSearch, Pinecone, etc.) could be
> introduced in a future high-scale migration if PostgreSQL eventually
> becomes insufficient, but it is not part of the current architecture.

```text
Neon PostgreSQL
├── PostgreSQL Full-Text Search
│   └── GIN index on generated tsvector
│
└── pgvector
    └── HNSW index (cosine)

Hybrid Retrieval
=
Lexical Search (FTS + ts_rank_cd)
+
Semantic Search (pgvector cosine + Gemini query embedding)
+
Deterministic Re-ranking (min-max normalize + weighted blend)
```

## Why this shape

- **One database, zero new services.** Keyword search needs exact-term
  matching (definitions, names, formulas); semantic search needs
  meaning-level matching (paraphrases, questions). PostgreSQL already
  provides both natively — operating, backing up, and scaling one store
  beats running a second system for prototype-to-production scale.
- **Cosine distance** matches Gemini embedding retrieval practice
  (embeddings are used directionally, not by magnitude).
- **HNSW over IVFFLAT**: no training step, better recall/latency
  trade-off, and the index builds without requiring existing rows —
  important for fresh projects with few chunks.

## Data model

`knowledge_chunks` carries both retrieval representations:

| Column         | Type                                       | Maintained by                                            |
| -------------- | ------------------------------------------ | -------------------------------------------------------- |
| `content`      | `text`                                     | worker chunker                                           |
| `contentHash`  | `text` (SHA-256 of normalized content)     | worker, for change detection                             |
| `embedding`    | `vector(768)`                              | worker via Gemini; raw SQL writes (Prisma `Unsupported`) |
| `searchVector` | `tsvector` GENERATED ALWAYS from `content` | PostgreSQL itself, zero app code                         |

Indexes: `knowledge_chunks_embedding_hnsw_idx`
(`USING hnsw (embedding vector_cosine_ops)`) and
`knowledge_chunks_search_gin_idx` (`USING gin (searchVector)`).
Both are hand-written raw SQL — Prisma cannot model vector or GIN
indexes (see migration `0003_knowledge_retrieval`).

## Retrieval flow (`POST /api/projects/:projectId/search`)

1. **Authorize**: project ownership encoded in the lookup (404 covers
   missing + foreign — no oracle).
2. **Normalize** the query (whitespace collapse; validated 1–500 chars).
   The same string feeds both paths unchanged.
3. **Lexical path** (always runs): parameterized `websearch_to_tsquery`
   - `ts_rank_cd`, scoped by `projectId` + READY material states in SQL.
     Never loads chunks into JS; never string-concatenates SQL.
4. **Semantic path** (when a query embedding is available): one Gemini
   `RETRIEVAL_QUERY` embedding → `ORDER BY embedding <=> $1::vector`
   with the same project/READY scoping in SQL, `IS NOT NULL` guard.
   No key or a failed call ⇒ lexical-only degradation, still 200.
5. **Merge**: dedupe by chunk id, min-max normalize each path into
   [0, 1], blend `combined = 0.7·semantic + 0.3·lexical` (configurable
   via `SEARCH_SEMANTIC_WEIGHT` / `SEARCH_LEXICAL_WEIGHT`, normalized to
   sum 1 at runtime), tie-break by chunk id. Top `limit` (default 8).
6. **Respond** with traceable evidence (project → material → page →
   chunk) plus per-path scores and a latency breakdown.

### Why 0.7 / 0.3

Study questions are usually paraphrases of source text, where semantic
search wins; exact terms (names, formulas) are the lexical backstop.
Semantic-first with a meaningful lexical vote is the standard starting
point — explicitly not claimed optimal. Tune with evaluation data
(Prompt 11 hooks: per-search latencies + result counts are logged;
`AIUsage` rows record every query embedding).

### Scores are similarities, not probabilities

`semantic` = `1 − cosineDistance/2` in [0, 1]; `lexical` = min-max
normalized `ts_rank_cd`; `combined` = the weighted blend. The UI labels
them as similarity scores and never as probabilities.

## Project isolation

Both candidate queries filter `projectId = :projectId` **in SQL**,
joined to `materials` constrained to `status = READY` AND
`knowledgeStatus = READY`. Filtering never happens in JavaScript, so one
project can never observe another's chunks — covered by integration
tests (identical content seeded in two projects).

## Performance posture

- Bounded candidates (`SEARCH_*_TOP_K`, default 20+20) → ranked top 8.
- Indexes do the work: GIN for `@@`, HNSW for `<=>`; no full scans,
  no N+1, no in-memory vector math.
- One Gemini call per search (the query embedding), never per chunk;
  chunk embeddings are persisted and reused.
- No query-embedding cache yet: the API owns no Redis client and a
  prototype-scale cache is unjustified complexity. Revisit with usage
  data if repeated queries dominate cost (see `docs/KNOWLEDGE_PROCESSING.md`).
