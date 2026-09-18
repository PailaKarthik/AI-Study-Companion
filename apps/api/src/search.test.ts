import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "@ai-study-companion/shared";
import type { EmbeddingProvider } from "@ai-study-companion/ai";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedPost, registerCookie } from "./test/auth.js";
import { __setSearchEmbedderForTests } from "./services/searchService.js";

const DIMS = EMBEDDING_DIMENSIONS;

function unitVector(first: number): string {
  const values = new Array(DIMS).fill(0);
  values[0] = first;
  return `[${(values as number[]).join(",")}]`;
}

/** Canned query embedder: every query embeds to +e0. */
function stubQueryEmbedder(): EmbeddingProvider {
  return {
    name: "mock",
    model: "mock-query-stub",
    dimensions: DIMS,
    embedBatch: async (input) => ({
      vectors: input.texts.map(() => {
        const values = new Array(DIMS).fill(0);
        values[0] = 1;
        return values as number[];
      }),
      inputTokens: 4,
      model: "mock-query-stub",
      latencyMs: 1,
    }),
  };
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe.skipIf(!hasTestDb)("project search API (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  let spaceA = "";
  let projectA = "";
  let projectB = "";

  async function seedChunk(opts: {
    projectId: string;
    materialId: string;
    pageId: string | null;
    pageNumber: number | null;
    chunkIndex: number;
    content: string;
    vector: "close" | "far" | null;
  }): Promise<string> {
    const db = getTestPrisma();
    const row = await db.knowledgeChunk.create({
      data: {
        projectId: opts.projectId,
        materialId: opts.materialId,
        pageId: opts.pageId,
        pageNumber: opts.pageNumber,
        chunkIndex: opts.chunkIndex,
        content: opts.content,
        tokenCount: Math.ceil(opts.content.length / 4),
        contentHash: sha(opts.content),
        metadata: { pageNumber: opts.pageNumber, chunkIndex: opts.chunkIndex, sourceType: "pdf" },
      },
      select: { id: true },
    });
    if (opts.vector) {
      const literal = opts.vector === "close" ? unitVector(1) : unitVector(-1);
      await db.$executeRaw`UPDATE "knowledge_chunks" SET "embedding" = ${literal}::vector WHERE "id" = ${row.id}::uuid`;
    }
    return row.id;
  }

  async function seedMaterial(
    ownerId: string,
    projectId: string,
    filename: string,
    pages: { pageNumber: number; text: string }[]
  ): Promise<{ materialId: string; pageIds: string[] }> {
    const db = getTestPrisma();
    const material = await db.material.create({
      data: {
        projectId,
        ownerId,
        filename,
        originalFilename: filename,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/${filename}-${Math.random().toString(36).slice(2)}`,
        status: "READY",
        knowledgeStatus: "READY",
        pageCount: pages.length,
      },
      select: { id: true },
    });
    const pageIds: string[] = [];
    for (const page of pages) {
      const row = await db.documentPage.create({
        data: {
          materialId: material.id,
          projectId,
          pageNumber: page.pageNumber,
          extractedText: page.text,
        },
        select: { id: true },
      });
      pageIds.push(row.id);
    }
    return { materialId: material.id, pageIds };
  }

  beforeEach(async () => {
    await resetTestDb();
    __setSearchEmbedderForTests(null);
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
    const db = getTestPrisma();
    userA = (await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).id;
    spaceA = (await authedPost(app, "/api/spaces", cookieA, { name: "Space A" }).expect(201)).body
      .data.id as string;
    projectA = (
      await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
        name: "Project A",
      }).expect(201)
    ).body.data.id as string;
    const spaceB = (await authedPost(app, "/api/spaces", cookieB, { name: "Space B" }).expect(201))
      .body.data.id as string;
    projectB = (
      await authedPost(app, `/api/spaces/${spaceB}/projects`, cookieB, {
        name: "Project B",
      }).expect(201)
    ).body.data.id as string;
  });

  afterEach(() => {
    __setSearchEmbedderForTests(undefined);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects unauthenticated search with 401", async () => {
    await request(app)
      .post(`/api/projects/00000000-0000-4000-8000-000000000000/search`)
      .send({ query: "hello" })
      .expect(401);
  });

  it("validates query, limit, and materialId", async () => {
    const post = (body: Record<string, unknown>) =>
      request(app).post(`/api/projects/${projectA}/search`).set("Cookie", cookieA).send(body);
    await post({ query: "" }).expect(400);
    await post({ query: "   " }).expect(400);
    await post({ query: "x".repeat(501) }).expect(400);
    await post({ query: "ok", limit: 0 }).expect(400);
    await post({ query: "ok", limit: 51 }).expect(400);
    await post({ query: "ok", materialId: "nope" }).expect(400);
    await post({ query: "ok", surprise: 1 }).expect(400);
  });

  it("404s unknown and foreign projects identically", async () => {
    const post = (projectId: string) =>
      request(app)
        .post(`/api/projects/${projectId}/search`)
        .set("Cookie", cookieB)
        .send({ query: "x" });
    const missing = await post("00000000-0000-4000-8000-000000000000").expect(404);
    const foreign = await post(projectA).expect(404);
    expect(foreign.body.error).toEqual(missing.body.error);
  });

  it("returns results: [] on an empty corpus (never fabricated)", async () => {
    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "anything at all here" })
      .expect(200);
    expect(res.body.data).toMatchObject({ query: "anything at all here", projectId: projectA });
    expect(res.body.data.results).toEqual([]);
    expect(res.body.data.meta.resultCount).toBe(0);
  });

  it("lexical search ranks multi-term matches above single-term ones", async () => {
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "bio.pdf", [
      { pageNumber: 1, text: "Biology chapter one." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Photosynthesis converts light into chemical energy inside chloroplasts.",
      vector: null,
    });
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 1,
      content: "Light travels fast across the universe and stars shine brightly.",
      vector: null,
    });

    // websearch treats bare spaces as AND; OR matches either term.
    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "photosynthesis OR light" })
      .expect(200);
    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.data.results[0].content).toContain("Photosynthesis");
    expect(res.body.data.results[0].retrieval.lexical).toBeGreaterThan(
      res.body.data.results[1].retrieval.lexical ?? -1
    );
    // Lexical-only degradation: no semantic scores without an embedder.
    expect(res.body.data.results[0].retrieval.semantic).toBeNull();
  });

  it("hybrid search merges paths, dedupes, and ranks deterministically", async () => {
    __setSearchEmbedderForTests(stubQueryEmbedder());
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "bio.pdf", [
      { pageNumber: 1, text: "Biology chapter one." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Photosynthesis converts light into chemical energy inside chloroplasts.",
      vector: "close",
    });
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 1,
      content: "Light travels fast across the universe and stars shine brightly.",
      vector: "far",
    });
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 2,
      content: "Completely unrelated text about pottery wheels and kiln temperatures.",
      vector: "close",
    });

    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "photosynthesis light" })
      .expect(200);
    const results = res.body.data.results as Array<{
      chunkId: string;
      score: number;
      retrieval: { semantic: number | null; lexical: number | null; combined: number };
    }>;
    // Chunk 2 has no lexical terms → only chunks 0 and 1 match lexically,
    // but chunk 2 matches semantically; all three merge without duplicates.
    expect(results).toHaveLength(3);
    const ids = results.map((r) => r.chunkId);
    expect(new Set(ids).size).toBe(3);
    // Best of both worlds ranks first with both scores present.
    expect(results[0]?.retrieval.semantic).toBeGreaterThan(0.99);
    expect(results[0]?.retrieval.lexical).toBeGreaterThan(0);
    expect(results[0]?.score).toBeLessThanOrEqual(1);
    // Scores strictly descend (deterministic order).
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? -1);
    expect(results[1]?.score).toBeGreaterThan(results[2]?.score ?? -1);
    // Traceability for future citations.
    expect(res.body.data.results[0]).toMatchObject({
      materialId,
      materialName: "bio.pdf",
      pageNumber: 1,
    });
  });

  it("retrieves semantically related chunks with zero lexical overlap", async () => {
    __setSearchEmbedderForTests(stubQueryEmbedder());
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "deep.pdf", [
      { pageNumber: 7, text: "Deep chapter." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 7,
      chunkIndex: 0,
      content: "Entirely different words with no shared vocabulary whatsoever.",
      vector: "close",
    });

    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "xylophone zebra quantum" })
      .expect(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0].retrieval.semantic).toBeGreaterThan(0.99);
    expect(res.body.data.results[0].retrieval.lexical).toBeNull();
    expect(res.body.data.results[0].pageNumber).toBe(7);
  });

  it("never returns another user's or another project's chunks", async () => {
    __setSearchEmbedderForTests(stubQueryEmbedder());
    const db = getTestPrisma();
    const userB = (await db.user.findUniqueOrThrow({ where: { email: "b@example.com" } })).id;
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "secret.pdf", [
      { pageNumber: 1, text: "Secret chapter." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Zebra xylophone quantum photosynthesis light energy unique marker.",
      vector: "close",
    });
    const bMat = await seedMaterial(userB, projectB, "b.pdf", [{ pageNumber: 1, text: "B text." }]);
    await seedChunk({
      projectId: projectB,
      materialId: bMat.materialId,
      pageId: bMat.pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Zebra xylophone quantum photosynthesis light energy unique marker.",
      vector: "close",
    });

    const resB = await request(app)
      .post(`/api/projects/${projectB}/search`)
      .set("Cookie", cookieB)
      .send({ query: "zebra xylophone quantum" })
      .expect(200);
    expect(resB.body.data.results).toHaveLength(1);
    expect(resB.body.data.results[0].materialName).toBe("b.pdf");

    // Identical content in A's project must not leak into B's search.
    const flat = JSON.stringify(resB.body.data.results);
    expect(flat).not.toContain("secret.pdf");
  });

  it("honors the material filter", async () => {
    __setSearchEmbedderForTests(stubQueryEmbedder());
    const first = await seedMaterial(userA, projectA, "first.pdf", [
      { pageNumber: 1, text: "First doc." },
    ]);
    const second = await seedMaterial(userA, projectA, "second.pdf", [
      { pageNumber: 1, text: "Second doc." },
    ]);
    for (const [mat, idx] of [
      [first, 0],
      [second, 0],
    ] as const) {
      await seedChunk({
        projectId: projectA,
        materialId: mat.materialId,
        pageId: mat.pageIds[0] ?? null,
        pageNumber: 1,
        chunkIndex: idx,
        content: "Shared zebra content for filtering checks.",
        vector: "close",
      });
    }
    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "zebra filtering", limit: 8, materialId: first.materialId })
      .expect(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0].materialName).toBe("first.pdf");
  });

  it("records query-embedding usage for observability", async () => {
    __setSearchEmbedderForTests(stubQueryEmbedder());
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "obs.pdf", [
      { pageNumber: 1, text: "Observable text." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Observable zebra content.",
      vector: null,
    });
    const db = getTestPrisma();
    const before = await db.aIUsage.count({ where: { feature: "EMBEDDING" } });
    await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "observable zebra" })
      .expect(200);
    const rows = await db.aIUsage.findMany({
      where: { feature: "EMBEDDING" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SUCCESS", model: "mock-query-stub" });
    expect(rows[0]?.inputTokens).toBeGreaterThan(0);
  });

  it("degrades to lexical-only when the embedder throws", async () => {
    const failing: EmbeddingProvider = {
      name: "mock",
      model: "always-fails",
      dimensions: EMBEDDING_DIMENSIONS,
      embedBatch: async () => {
        throw new Error("provider exploded");
      },
    };
    __setSearchEmbedderForTests(failing);
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "deg.pdf", [
      { pageNumber: 1, text: "Degraded chapter." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Graceful zebra degradation content here.",
      vector: null,
    });
    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "graceful zebra" })
      .expect(200);
    expect(res.body.data.results).toHaveLength(1);
    expect(res.body.data.results[0].retrieval.semantic).toBeNull();
    const db = getTestPrisma();
    const failed = await db.aIUsage.findFirst({
      where: { feature: "EMBEDDING", status: "FAILED" },
      orderBy: { createdAt: "desc" },
    });
    expect(failed?.model).toBe("always-fails");
  });

  it("only retrieves from READY knowledge, never stale or failed states", async () => {
    const { materialId, pageIds } = await seedMaterial(userA, projectA, "stale.pdf", [
      { pageNumber: 1, text: "Stale chapter." },
    ]);
    await seedChunk({
      projectId: projectA,
      materialId,
      pageId: pageIds[0] ?? null,
      pageNumber: 1,
      chunkIndex: 0,
      content: "Stale zebra content that must stay invisible.",
      vector: null,
    });
    const db = getTestPrisma();
    await db.material.update({
      where: { id: materialId },
      data: { knowledgeStatus: "PROCESSING" },
    });
    const res = await request(app)
      .post(`/api/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "stale zebra invisible" })
      .expect(200);
    expect(res.body.data.results).toEqual([]);
  });
});
