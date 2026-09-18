-- Migration 0003_knowledge_retrieval: knowledge indexing state + FTS support.
--
-- Generated via:
--   prisma migrate diff --from-migrations ./prisma/migrations \
--     --to-schema-datamodel ./prisma/schema.prisma --script
-- with two manual corrections (Prisma cannot model either):
--   1. REMOVED the generated `DROP INDEX knowledge_chunks_embedding_hnsw_idx`.
--      That HNSW index is hand-managed raw SQL from 0001; `migrate diff`
--      sees it as drift because it is absent from the Prisma schema.
--      Dropping it would silently kill vector retrieval — never do this.
--   2. `searchVector` is a GENERATED ALWAYS tsvector column, which Prisma
--      cannot express. The diff output (`ADD COLUMN "searchVector" tsvector`)
--      was rewritten below with the generation expression, and the GIN
--      index was appended by hand.

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "knowledge_chunks" ADD COLUMN "contentHash" TEXT;

-- AlterTable (hand-written): generated tsvector for PostgreSQL full-text
-- search over chunk content. GENERATED ALWAYS keeps it in sync on every
-- INSERT/UPDATE with zero application code; NULL content is impossible
-- (content is NOT NULL) so no COALESCE wrapper is needed.
ALTER TABLE "knowledge_chunks" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "knowledgeError" TEXT,
ADD COLUMN     "knowledgeStatus" "KnowledgeStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "knowledgeUpdatedAt" TIMESTAMP(3);

-- Full-text search index (hand-written; Prisma cannot model GIN indexes).
-- GIN over the generated tsvector gives indexed keyword/phrase lookup
-- (`@@`, `websearch_to_tsquery`, `ts_rank_cd`) without loading chunks
-- into application memory.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_search_gin_idx"
  ON "knowledge_chunks" USING gin ("searchVector");
