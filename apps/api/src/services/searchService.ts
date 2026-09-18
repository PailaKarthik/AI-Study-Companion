import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import type { PrismaClient } from "@ai-study-companion/db";
import {
  GeminiEmbeddingProvider,
  recordEmbeddingUsage,
  type EmbeddingProvider,
} from "@ai-study-companion/ai";
import type { SearchResponse, SearchResultItem } from "@ai-study-companion/shared";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow } from "./accessService.js";
import { rankHybrid } from "./hybridRanker.js";
import { assertSearchableQuery, normalizeSearchQuery } from "./queryNormalizer.js";
import { getOwnedMaterialOrThrow } from "./materialsService.js";

export interface SearchOptions {
  limit?: number;
  materialId?: string;
  db?: PrismaClient;
  /** Injected in tests; production builds Gemini from config. */
  embedder?: EmbeddingProvider | null;
}

interface LexicalRow {
  id: string;
  materialId: string;
  materialName: string;
  pageId: string | null;
  pageNumber: number | null;
  content: string;
  rank: number;
}

interface SemanticRow {
  id: string;
  materialId: string;
  materialName: string;
  pageId: string | null;
  pageNumber: number | null;
  content: string;
  distance: number;
}

interface CandidateValue {
  materialId: string;
  materialName: string;
  pageId: string | null;
  pageNumber: number | null;
  content: string;
}

/**
 * Test-only embedder override (HTTP tests cannot inject through Express).
 * `undefined` = production behavior; a provider (or null) forces that path.
 * Always reset in afterEach — leaked overrides would poison other suites.
 */
let testEmbedderOverride: EmbeddingProvider | null | "unset" = "unset";

export function __setSearchEmbedderForTests(provider: EmbeddingProvider | null | undefined): void {
  testEmbedderOverride = provider === undefined ? "unset" : provider;
}

function resolveEmbedder(explicit?: EmbeddingProvider | null): EmbeddingProvider | null {
  if (explicit) return explicit;
  if (explicit === null) return null;
  if (testEmbedderOverride !== "unset") return testEmbedderOverride;
  if (!config.GEMINI_API_KEY) return null;
  return new GeminiEmbeddingProvider({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    timeoutMs: config.EMBEDDING_TIMEOUT_MS,
    maxAttempts: config.EMBEDDING_MAX_ATTEMPTS,
  });
}

async function lexicalCandidates(
  db: PrismaClient,
  projectId: string,
  query: string,
  topK: number,
  materialId?: string
): Promise<LexicalRow[]> {
  if (materialId) {
    return db.$queryRaw<LexicalRow[]>`
      WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
      SELECT kc."id" AS "id", kc."materialId" AS "materialId",
             m."filename" AS "materialName",
             kc."pageId" AS "pageId", kc."pageNumber" AS "pageNumber",
             kc."content" AS "content",
             ts_rank_cd(kc."searchVector", (SELECT query FROM q)) AS "rank"
      FROM "knowledge_chunks" kc
      JOIN "materials" m ON m."id" = kc."materialId"
      WHERE kc."projectId" = ${projectId}::uuid
        AND kc."materialId" = ${materialId}::uuid
        AND m."status" = 'READY'
        AND m."knowledgeStatus" = 'READY'
        AND kc."searchVector" @@ (SELECT query FROM q)
      ORDER BY "rank" DESC
      LIMIT ${topK}
    `;
  }
  return db.$queryRaw<LexicalRow[]>`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
    SELECT kc."id" AS "id", kc."materialId" AS "materialId",
           m."filename" AS "materialName",
           kc."pageId" AS "pageId", kc."pageNumber" AS "pageNumber",
           kc."content" AS "content",
           ts_rank_cd(kc."searchVector", (SELECT query FROM q)) AS "rank"
    FROM "knowledge_chunks" kc
    JOIN "materials" m ON m."id" = kc."materialId"
    WHERE kc."projectId" = ${projectId}::uuid
      AND m."status" = 'READY'
      AND m."knowledgeStatus" = 'READY'
      AND kc."searchVector" @@ (SELECT query FROM q)
    ORDER BY "rank" DESC
    LIMIT ${topK}
  `;
}

async function semanticCandidates(
  db: PrismaClient,
  projectId: string,
  vectorLiteral: string,
  topK: number,
  materialId?: string
): Promise<SemanticRow[]> {
  if (materialId) {
    return db.$queryRaw<SemanticRow[]>`
      SELECT kc."id" AS "id", kc."materialId" AS "materialId",
             m."filename" AS "materialName",
             kc."pageId" AS "pageId", kc."pageNumber" AS "pageNumber",
             kc."content" AS "content",
             (kc."embedding" <=> ${vectorLiteral}::vector) AS "distance"
      FROM "knowledge_chunks" kc
      JOIN "materials" m ON m."id" = kc."materialId"
      WHERE kc."projectId" = ${projectId}::uuid
        AND kc."materialId" = ${materialId}::uuid
        AND m."status" = 'READY'
        AND m."knowledgeStatus" = 'READY'
        AND kc."embedding" IS NOT NULL
      ORDER BY "distance" ASC
      LIMIT ${topK}
    `;
  }
  return db.$queryRaw<SemanticRow[]>`
    SELECT kc."id" AS "id", kc."materialId" AS "materialId",
           m."filename" AS "materialName",
           kc."pageId" AS "pageId", kc."pageNumber" AS "pageNumber",
           kc."content" AS "content",
           (kc."embedding" <=> ${vectorLiteral}::vector) AS "distance"
    FROM "knowledge_chunks" kc
    JOIN "materials" m ON m."id" = kc."materialId"
    WHERE kc."projectId" = ${projectId}::uuid
      AND m."status" = 'READY'
      AND m."knowledgeStatus" = 'READY'
      AND kc."embedding" IS NOT NULL
    ORDER BY "distance" ASC
    LIMIT ${topK}
  `;
}

/**
 * Project-scoped hybrid retrieval. Every candidate query carries the
 * project boundary IN the SQL — filtering never happens in JS, so one
 * project can never observe another's chunks.
 *
 * Semantic path degrades gracefully: no key (or a failed embedding call)
 * ⇒ lexical-only results rather than a failed search. An empty corpus
 * yields `results: []`, never fabricated evidence.
 */
export async function searchProject(
  userId: string,
  projectId: string,
  rawQuery: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const totalStarted = Date.now();
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);

  if (options.materialId) {
    await getOwnedMaterialOrThrow(userId, owned.spaceId, options.materialId, db);
  }

  const query = normalizeSearchQuery(rawQuery);
  assertSearchableQuery(query);
  const limit = Math.min(
    Math.max(options.limit ?? config.SEARCH_RESULT_LIMIT, 1),
    config.SEARCH_RESULT_LIMIT
  );

  const lexicalStarted = Date.now();
  const lexical = await lexicalCandidates(
    db,
    owned.id,
    query,
    config.SEARCH_LEXICAL_TOP_K,
    options.materialId
  );
  const lexicalMs = Date.now() - lexicalStarted;

  let semantic: SemanticRow[] = [];
  let semanticMs = 0;
  const embedder = resolveEmbedder(options.embedder);
  if (embedder) {
    const semanticStarted = Date.now();
    try {
      const embedded = await embedder.embedBatch({ texts: [query], taskType: "RETRIEVAL_QUERY" });
      const vector = embedded.vectors[0];
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Query embedding has width ${vector?.length ?? 0}; expected ${EMBEDDING_DIMENSIONS}.`
        );
      }
      semantic = await semanticCandidates(
        db,
        owned.id,
        `[${vector.join(",")}]`,
        config.SEARCH_SEMANTIC_TOP_K,
        options.materialId
      );
      await recordEmbeddingUsage(db, {
        userId,
        projectId: owned.id,
        feature: "EMBEDDING",
        provider: embedder.name === "mock" ? "SYSTEM" : "GEMINI",
        model: embedded.model,
        latencyMs: embedded.latencyMs,
        inputTokens: embedded.inputTokens,
        status: "SUCCESS",
        metadata: { phase: "query-embed" },
      });
    } catch (error) {
      // Degrade to lexical-only: a failed embedding must not fail search.
      await recordEmbeddingUsage(db, {
        userId,
        projectId: owned.id,
        feature: "EMBEDDING",
        provider: embedder.name === "mock" ? "SYSTEM" : "GEMINI",
        model: embedder.model,
        latencyMs: Date.now() - semanticStarted,
        inputTokens: Math.max(1, Math.ceil(query.length / 4)),
        status: "FAILED",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        metadata: { phase: "query-embed" },
      }).catch(() => undefined);
      logger.warn(
        { projectId: owned.id, queryLength: query.length },
        "Query embedding failed; returning lexical-only results"
      );
    } finally {
      semanticMs = Date.now() - semanticStarted;
    }
  }

  const rankingStarted = Date.now();
  const byId = new Map<
    string,
    { value: CandidateValue; semanticDistance: number | null; lexicalRank: number | null }
  >();
  for (const row of lexical) {
    byId.set(row.id, {
      value: {
        materialId: row.materialId,
        materialName: row.materialName,
        pageId: row.pageId,
        pageNumber: row.pageNumber,
        content: row.content,
      },
      semanticDistance: null,
      lexicalRank: Number(row.rank),
    });
  }
  for (const row of semantic) {
    const existing = byId.get(row.id);
    if (existing) {
      existing.semanticDistance = Number(row.distance);
    } else {
      byId.set(row.id, {
        value: {
          materialId: row.materialId,
          materialName: row.materialName,
          pageId: row.pageId,
          pageNumber: row.pageNumber,
          content: row.content,
        },
        semanticDistance: Number(row.distance),
        lexicalRank: null,
      });
    }
  }

  const ranked = rankHybrid(
    [...byId].map(([key, entry]) => ({ key, ...entry })),
    { semanticWeight: config.SEARCH_SEMANTIC_WEIGHT, lexicalWeight: config.SEARCH_LEXICAL_WEIGHT },
    limit
  );

  const results: SearchResultItem[] = ranked.map((c) => ({
    chunkId: c.key,
    materialId: c.value.materialId,
    materialName: c.value.materialName,
    pageId: c.value.pageId,
    pageNumber: c.value.pageNumber,
    content: c.value.content,
    score: c.combined,
    retrieval: { semantic: c.semantic, lexical: c.lexical, combined: c.combined },
  }));
  const rankingMs = Date.now() - rankingStarted;

  const totalMs = Date.now() - totalStarted;
  logger.info(
    {
      projectId: owned.id,
      queryLength: query.length,
      lexicalMs,
      semanticMs,
      rankingMs,
      totalLatencyMs: totalMs,
      resultCount: results.length,
      semanticResults: semantic.length,
      lexicalResults: lexical.length,
    },
    "Hybrid search completed"
  );

  return {
    query,
    projectId: owned.id,
    results,
    meta: { lexicalMs, semanticMs, rankingMs, totalMs, resultCount: results.length },
  };
}
