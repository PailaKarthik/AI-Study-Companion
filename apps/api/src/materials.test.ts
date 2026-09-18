import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { closeTestDb, getTestPrisma, hasTestDb, resetTestDb } from "./test/db.js";
import { authedGet, authedPost, registerCookie } from "./test/auth.js";
import { reindexMaterial } from "./services/materialsService.js";

describe.skipIf(!hasTestDb)("materials reindex API (isolated test DB)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  let spaceA = "";
  let projectA = "";

  async function seedMaterial(ownerId: string, projectId: string, filename: string) {
    const db = getTestPrisma();
    return db.material.create({
      data: {
        projectId,
        ownerId,
        filename,
        originalFilename: filename,
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/${filename}-${Math.random().toString(36).slice(2)}`,
        status: "READY",
        knowledgeStatus: "NOT_STARTED",
        pageCount: 1,
      },
      select: { id: true },
    });
  }

  beforeEach(async () => {
    await resetTestDb();
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
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects unauthenticated reindex with 401", async () => {
    await request(app)
      .post("/api/materials/00000000-0000-4000-8000-000000000000/reindex")
      .expect(401);
  });

  it("validates the material id", async () => {
    const res = await request(app)
      .post("/api/materials/not-a-uuid/reindex")
      .set("Cookie", cookieA)
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("404s unknown and foreign materials identically", async () => {
    const missing = await request(app)
      .post("/api/materials/00000000-0000-4000-8000-000000000000/reindex")
      .set("Cookie", cookieA)
      .expect(404);
    const { id } = await seedMaterial(userA, projectA, "private.pdf");
    const foreign = await request(app)
      .post(`/api/materials/${id}/reindex`)
      .set("Cookie", cookieB)
      .expect(404);
    expect(foreign.body.error).toEqual(missing.body.error);
  });

  it("refuses non-READY materials with 409", async () => {
    const db = getTestPrisma();
    const { id } = await seedMaterial(userA, projectA, "pending.pdf");
    await db.material.update({ where: { id }, data: { status: "PROCESSING" } });
    const res = await request(app)
      .post(`/api/materials/${id}/reindex`)
      .set("Cookie", cookieA)
      .expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("marks QUEUED and enqueues with deterministic job id (service level)", async () => {
    const db = getTestPrisma();
    const { id } = await seedMaterial(userA, projectA, "doc.pdf");
    const enqueue = vi.fn(async (): Promise<string | null> => `knowledge-${id}`);
    const result = await reindexMaterial(userA, projectA, id, db, enqueue);
    expect(result).toMatchObject({ materialId: id, knowledgeStatus: "QUEUED", enqueued: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(id);
    const row = await db.material.findUniqueOrThrow({ where: { id } });
    expect(row.knowledgeStatus).toBe("QUEUED");
    expect(row.knowledgeError).toBeNull();
  });

  it("rolls back to FAILED when enqueue throws (service level)", async () => {
    const db = getTestPrisma();
    const { id } = await seedMaterial(userA, projectA, "doomed.pdf");
    const enqueue = vi.fn(async (): Promise<string | null> => {
      throw new Error("redis down");
    });
    await expect(reindexMaterial(userA, projectA, id, db, enqueue)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    const row = await db.material.findUniqueOrThrow({ where: { id } });
    expect(row.knowledgeStatus).toBe("FAILED");
    expect(row.knowledgeError).toContain("enqueue");
  });

  it("refuses duplicate active work with 409 (service level)", async () => {
    const db = getTestPrisma();
    const { id } = await seedMaterial(userA, projectA, "busy.pdf");
    const enqueue = vi.fn(async (): Promise<string | null> => "job-1");
    await reindexMaterial(userA, projectA, id, db, enqueue);
    await expect(reindexMaterial(userA, projectA, id, db, enqueue)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("lists owned project materials with knowledge state (paginated)", async () => {
    await seedMaterial(userA, projectA, "listed.pdf");
    const res = await authedGet(app, `/api/projects/${projectA}/materials`, cookieA).expect(200);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      filename: "listed.pdf",
      status: "READY",
      knowledgeStatus: "NOT_STARTED",
      chunkCount: 0,
    });
    await authedGet(app, `/api/projects/${projectA}/materials`, cookieB).expect(404);
  });

  it("lists owned project materials with knowledge state (paginated)", async () => {
    await seedMaterial(userA, projectA, "listed.pdf");
    const res = await authedGet(app, `/api/projects/${projectA}/materials`, cookieA).expect(200);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      filename: "listed.pdf",
      status: "READY",
      knowledgeStatus: "NOT_STARTED",
      chunkCount: 0,
      sizeBytes: 1000,
      // Seeded row predates blob storage: no bytes, re-upload required.
      hasFile: false,
    });
    await authedGet(app, `/api/projects/${projectA}/materials`, cookieB).expect(404);
  });

  it("rejects oversized pageSize instead of running an unbounded query", async () => {
    const res = await authedGet(
      app,
      `/api/projects/${projectA}/materials?pageSize=1000000`,
      cookieA
    ).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
);

/** Collect a binary response body into a Buffer (superagent has no PDF parser). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, cb: (err: Error | null, body: unknown) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: unknown) => {
    chunks.push(Buffer.from(chunk as Uint8Array));
  });
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

function upload(
  app: Express,
  cookie: string,
  projectId: string,
  filename: string,
  bytes: Buffer,
  contentType = "application/pdf"
) {
  return request(app)
    .post(`/api/projects/${projectId}/materials?filename=${encodeURIComponent(filename)}`)
    .set("Cookie", cookie)
    .set("Content-Type", contentType)
    .send(bytes);
}

describe.skipIf(!hasTestDb)("material upload/download/delete (Neon Object Storage)", () => {
  let app: Express;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  let projectA = "";

  beforeEach(async () => {
    await resetTestDb();
    app = createApp();
    cookieA = await registerCookie(app, "a@example.com");
    cookieB = await registerCookie(app, "b@example.com");
    const db = getTestPrisma();
    userA = (await db.user.findUniqueOrThrow({ where: { email: "a@example.com" } })).id;
    const spaceA = (await authedPost(app, "/api/spaces", cookieA, { name: "Space A" }).expect(201))
      .body.data.id as string;
    projectA = (
      await authedPost(app, `/api/spaces/${spaceA}/projects`, cookieA, {
        name: "Project A",
      }).expect(201)
    ).body.data.id as string;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("uploads a valid PDF to the bucket and stores metadata + audit event", async () => {
    const res = await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201);
    expect(res.body.data.deduplicated).toBe(false);
    // Upload → Queued is automatic; no Redis in tests so enqueue defers.
    expect(res.body.data.enqueued).toBe(false);
    expect(res.body.data.jobId).toMatch(/^document-/);
    expect(res.body.data.material).toMatchObject({
      projectId: projectA,
      filename: "notes.pdf",
      status: "QUEUED",
      knowledgeStatus: "NOT_STARTED",
      sizeBytes: MINIMAL_PDF.length,
      hasFile: true,
      imageCount: 0,
    });
    const db = getTestPrisma();
    const materialId = res.body.data.material.id as string;
    const blob = await db.materialBlob.findFirst({ where: { materialId } });
    expect(blob).toMatchObject({ mimeType: "application/pdf", sizeBytes: MINIMAL_PDF.length });
    expect(blob?.checksum).toMatch(/^[0-9a-f]{64}$/);
    // Isolated bucket key — never a bare filename, never user input.
    expect(blob?.storageKey).toMatch(
      /^users\/[^/]+\/spaces\/[^/]+\/projects\/[^/]+\/materials\/[^/]+\/original\.pdf$/
    );
    // PostgreSQL holds the reference only: the row is metadata-shaped,
    // with no bytes/base64/payload field of any kind.
    expect(Object.keys(blob ?? {}).sort()).toEqual(
      [
        "checksum",
        "createdAt",
        "height",
        "id",
        "kind",
        "materialId",
        "mimeType",
        "pageNumber",
        "sizeBytes",
        "storageKey",
        "width",
      ].sort()
    );
    const material = await db.material.findUniqueOrThrow({ where: { id: materialId } });
    expect(material.storageProvider).toBe("NEON_OBJECT_STORAGE");
    expect(material.checksum).toBe(blob?.checksum);
    expect(material.storageKey).toBe(blob?.storageKey);
    // Durable document job row exists for the worker + admin explorer.
    const docJob = await db.documentJob.findUniqueOrThrow({
      where: { jobId: `document-${materialId}` },
    });
    expect(docJob.status).toBe("QUEUED");
    expect(docJob.type).toBe("TEXT_EXTRACTION");
    const events = await db.activityEvent.findMany({
      where: { eventType: "MATERIAL_UPLOADED", entityId: materialId },
    });
    expect(events).toHaveLength(1);
  });

  it("refuses uploads when file storage is unconfigured (no PostgreSQL fallback)", async () => {
    const { uploadMaterial } = await import("./services/materialsService.js");
    const db = getTestPrisma();
    await expect(
      uploadMaterial(
        userA,
        projectA,
        { filename: "notes.pdf", contentType: "application/pdf", bytes: MINIMAL_PDF },
        db,
        async () => "document-x",
        null
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(await db.material.count()).toBe(0);
    expect(await db.materialBlob.count()).toBe(0);
  });

  it("refuses uploads when the bucket write fails (no orphan metadata)", async () => {
    const { uploadMaterial } = await import("./services/materialsService.js");
    const { StorageError } = await import("@ai-study-companion/db");
    const db = getTestPrisma();
    const failing = {
      name: "failing",
      upload: async () => {
        throw new StorageError("transient", "bucket down", true);
      },
      download: async () => null,
      exists: async () => false,
      deleteObjects: async () => ({ deleted: 0 }),
      getPresignedDownloadUrl: async () => "",
      healthCheck: async () => undefined,
    };
    await expect(
      uploadMaterial(
        userA,
        projectA,
        { filename: "notes.pdf", contentType: "application/pdf", bytes: MINIMAL_PDF },
        db,
        async () => "document-x",
        failing
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(await db.material.count()).toBe(0);
    expect(await db.materialBlob.count()).toBe(0);
  });

  it("marks enqueued when the queue accepts the document job (service level)", async () => {
    const { uploadMaterial } = await import("./services/materialsService.js");
    const db = getTestPrisma();
    const enqueues: string[] = [];
    const result = await uploadMaterial(
      userA,
      projectA,
      { filename: "queued.pdf", contentType: "application/pdf", bytes: MINIMAL_PDF },
      db,
      async (id: string) => {
        enqueues.push(id);
        return `document-${id}`;
      }
    );
    expect(result.enqueued).toBe(true);
    expect(result.jobId).toBe(`document-${result.material.id}`);
    expect(enqueues).toEqual([result.material.id]);
    expect(result.material.status).toBe("QUEUED");
  });

  it("deduplicates identical bytes within a project (no duplicate objects)", async () => {
    const db = getTestPrisma();
    const first = await upload(app, cookieA, projectA, "a.pdf", MINIMAL_PDF).expect(201);
    const second = await upload(app, cookieA, projectA, "b.pdf", MINIMAL_PDF).expect(201);
    expect(second.body.data.deduplicated).toBe(true);
    expect(second.body.data.material.id).toBe(first.body.data.material.id);
    expect(await db.materialBlob.count()).toBe(1);
    expect(await db.material.count()).toBe(1);
  });

  it("rejects non-PDF content types, bad magic bytes, empty and missing input", async () => {
    await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF, "image/png").expect(400);
    await upload(app, cookieA, projectA, "notes.pdf", Buffer.from("hello world")).expect(400);
    await upload(app, cookieA, projectA, "notes.pdf", Buffer.from([])).expect(400);
    const noName = await request(app)
      .post(`/api/projects/${projectA}/materials`)
      .set("Cookie", cookieA)
      .set("Content-Type", "application/pdf")
      .send(MINIMAL_PDF)
      .expect(400);
    expect(noName.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects oversized files before storing anything", async () => {
    const db = getTestPrisma();
    const big = Buffer.alloc(16_000_000, 0);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
    await upload(app, cookieA, projectA, "big.pdf", big).expect(400);
    expect(await db.material.count()).toBe(0);
    expect(await db.materialBlob.count()).toBe(0);
  });

  it("sanitizes traversal filenames instead of storing paths", async () => {
    const res = await upload(app, cookieA, projectA, "../../etc/passwd", MINIMAL_PDF).expect(201);
    expect(res.body.data.material.filename).toBe("passwd");
    expect(res.body.data.material.filename).not.toContain("/");
  });

  it("downloads owned bytes with integrity headers; rejects foreigners", async () => {
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    const res = await request(app)
      .get(`/api/materials/${id}/file`)
      .set("Cookie", cookieA)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain('filename="notes.pdf"');
    expect(res.headers.etag).toBeDefined();
    expect(Buffer.compare(res.body as Buffer, MINIMAL_PDF)).toBe(0);
    await request(app).get(`/api/materials/${id}/file`).set("Cookie", cookieB).expect(404);
    await request(app)
      .get("/api/materials/00000000-0000-4000-8000-000000000000/file")
      .set("Cookie", cookieA)
      .expect(404);
  });

  it("reports legacy rows without bytes as re-upload-required, never empty files", async () => {
    const db = getTestPrisma();
    const legacy = await db.material.create({
      data: {
        projectId: projectA,
        ownerId: userA,
        filename: "legacy.pdf",
        originalFilename: "legacy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/legacy-${Math.random().toString(36).slice(2)}`,
        status: "READY",
        knowledgeStatus: "NOT_STARTED",
        pageCount: 1,
      },
      select: { id: true },
    });
    const res = await request(app)
      .get(`/api/materials/${legacy.id}/file`)
      .set("Cookie", cookieA)
      .expect(404);
    expect(res.body.error.message).toMatch(/re-upload/);
  });

  it("deletes material + stored objects and audits; foreigners get 404", async () => {
    const db = getTestPrisma();
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    const key = (await db.material.findUniqueOrThrow({ where: { id } })).storageKey;
    await request(app).delete(`/api/materials/${id}`).set("Cookie", cookieB).expect(404);
    const res = await request(app)
      .delete(`/api/materials/${id}`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(res.body.data).toMatchObject({ id, blobsDeleted: 1 });
    expect(await db.material.findUnique({ where: { id } })).toBeNull();
    expect(await db.materialBlob.count({ where: { materialId: id } })).toBe(0);
    // The bucket object is gone too (memory double here; S3 DeleteObjects live).
    const { getApiStorage } = await import("./lib/storage.js");
    await expect(getApiStorage()?.exists(key)).resolves.toBe(false);
    const audit = await db.activityEvent.findMany({
      where: { eventType: "MATERIAL_DELETED", entityId: id },
    });
    expect(audit).toHaveLength(1);
    await request(app).get(`/api/materials/${id}/file`).set("Cookie", cookieA).expect(404);
  });

  it("repeated deletion is a safe 404, never a crash", async () => {
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    await request(app).delete(`/api/materials/${id}`).set("Cookie", cookieA).expect(200);
    await request(app).delete(`/api/materials/${id}`).set("Cookie", cookieA).expect(404);
  });

  it("serves extracted-image metadata + bytes with ownership checks", async () => {
    const db = getTestPrisma();
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    const material = await db.material.findUniqueOrThrow({ where: { id } });
    const image = await db.materialBlob.create({
      data: {
        materialId: id,
        kind: "EXTRACTED_IMAGE",
        storageKey: `${material.storageKey.replace(/original\.pdf$/, "")}images/page-1-test.png`,
        mimeType: "image/png",
        sizeBytes: 4,
        checksum: "img",
        pageNumber: 1,
        width: 640,
        height: 480,
      },
    });
    // Seed the (test-double) bucket object the metadata references.
    const { getApiStorage } = await import("./lib/storage.js");
    await getApiStorage()?.upload({
      key: image.storageKey,
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentType: "image/png",
    });

    const list = await request(app)
      .get(`/api/materials/${id}/images`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: image.id,
      pageNumber: 1,
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
    expect(list.body.data[0]).not.toHaveProperty("storageKey");
    expect(list.body.data[0]).not.toHaveProperty("bytes");

    const file = await request(app)
      .get(`/api/materials/${id}/images/${image.id}/file`)
      .set("Cookie", cookieA)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect([...(file.body as Buffer)]).toEqual([137, 80, 78, 71]);

    // Cross-user + cross-material ids are indistinguishable 404s.
    await request(app).get(`/api/materials/${id}/images`).set("Cookie", cookieB).expect(404);
    await request(app)
      .get(`/api/materials/${id}/images/${image.id}/file`)
      .set("Cookie", cookieB)
      .expect(404);
    await request(app)
      .get(`/api/materials/00000000-0000-4000-8000-000000000000/images/${image.id}/file`)
      .set("Cookie", cookieA)
      .expect(404);
  });

  it("reprocesses a FAILED material: resets to QUEUED, clears stale chunks (service level)", async () => {
    const { reprocessMaterial } = await import("./services/materialsService.js");
    const db = getTestPrisma();
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    // Simulate a failed extraction pass with stale knowledge beside it.
    await db.material.update({
      where: { id },
      data: { status: "FAILED", lastError: "boom", updatedAt: new Date(Date.now() - 7200_000) },
    });
    const page = await db.documentPage.create({
      data: {
        materialId: id,
        projectId: projectA,
        pageNumber: 1,
        extractedText: "stale words",
      },
    });
    await db.knowledgeChunk.create({
      data: {
        projectId: projectA,
        materialId: id,
        pageId: page.id,
        pageNumber: 1,
        chunkIndex: 0,
        content: "stale chunk",
      },
    });
    const enqueues: string[] = [];
    const result = await reprocessMaterial(userA, projectA, id, db, async (mid: string) => {
      enqueues.push(mid);
      return `document-${mid}`;
    });
    expect(result).toMatchObject({ materialId: id, status: "QUEUED", enqueued: true });
    expect(enqueues).toEqual([id]);
    const updated = await db.material.findUniqueOrThrow({ where: { id } });
    expect(updated.status).toBe("QUEUED");
    expect(updated.knowledgeStatus).toBe("NOT_STARTED");
    // Stale citations never outlive their pages.
    expect(await db.knowledgeChunk.count({ where: { materialId: id } })).toBe(0);
    const job = await db.documentJob.findUniqueOrThrow({ where: { jobId: `document-${id}` } });
    expect(job.status).toBe("QUEUED");
  });

  it("reprocess refuses active work (409) and foreign materials (404)", async () => {
    const { reprocessMaterial } = await import("./services/materialsService.js");
    const db = getTestPrisma();
    const id = (await upload(app, cookieA, projectA, "notes.pdf", MINIMAL_PDF).expect(201)).body
      .data.material.id as string;
    // Freshly QUEUED by the upload above → still active.
    await expect(reprocessMaterial(userA, projectA, id, db, async () => "x")).rejects.toMatchObject(
      { status: 409 }
    );
    await expect(
      reprocessMaterial(
        userA,
        projectA,
        "00000000-0000-4000-8000-000000000000",
        db,
        async () => "x"
      )
    ).rejects.toMatchObject({ status: 404 });
    await request(app).post(`/api/materials/${id}/reprocess`).set("Cookie", cookieB).expect(404);
  });

  it("reprocess requires stored bytes (legacy rows get re-upload 404)", async () => {
    const { reprocessMaterial } = await import("./services/materialsService.js");
    const db = getTestPrisma();
    const legacy = await db.material.create({
      data: {
        projectId: projectA,
        ownerId: userA,
        filename: "legacy.pdf",
        originalFilename: "legacy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1000,
        storageKey: `test/legacy-${Math.random().toString(36).slice(2)}`,
        status: "FAILED",
        knowledgeStatus: "NOT_STARTED",
        updatedAt: new Date(Date.now() - 7200_000),
      },
      select: { id: true },
    });
    await expect(
      reprocessMaterial(userA, projectA, legacy.id, db, async () => "x")
    ).rejects.toThrow(/re-upload/);
  });
});
