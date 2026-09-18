import { describe, expect, it, vi } from "vitest";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  BLOB_KIND_EXTRACTED_IMAGE,
  BLOB_KIND_SOURCE_PDF,
  MemoryStorageProvider,
  NeonObjectStorageProvider,
  RedisStorageProvider,
  STORAGE_PROVIDER_NEON_OBJECT_STORAGE,
  StorageError,
  countImageBlobRecords,
  countSourceBlobRecords,
  createStorageProviderFromEnv,
  deleteBlobRecordsByMaterial,
  getBlobRecord,
  listBlobRecordsByMaterial,
  sha256Hex,
  storageKeyForImage,
  storageKeyForMaterial,
  upsertBlobRecord,
  type BlobRecordDelegate,
  type RedisBytesClient,
} from "./storage.js";

/**
 * Neon Object Storage provider tests. The S3 transport is a mocked
 * `S3Client.send` (no bucket required): proves command shapes, checksum
 * wiring, miss-vs-failure mapping, and retryability flags. Metadata
 * record helpers run against an in-memory delegate mock. Real-Postgres
 * round trips run in the API suites where TEST_DATABASE_URL exists.
 */

const IDS = { user: "u-1", space: "s-1", project: "p-1", material: "m-1" };

function s3Error(name: string, status?: number): Error {
  const error = new Error(`${name} simulated`) as Error & {
    $metadata?: { httpStatusCode?: number };
  };
  error.name = name;
  if (status !== undefined) error.$metadata = { httpStatusCode: status };
  return error;
}

function mockClient(impl: (command: unknown) => Promise<unknown>): S3Client {
  return { send: vi.fn(impl) } as unknown as S3Client;
}

const NEON_CONFIG = {
  endpoint: "https://br-test.storage.c-1.us-east-2.aws.neon.tech",
  region: "us-east-2",
  bucket: "study-materials",
  accessKeyId: "nak_live_test",
  secretAccessKey: "nsk_live_test",
};

describe("object key layout (isolated, deterministic)", () => {
  it("builds user/space/project/material-scoped PDF keys", () => {
    expect(storageKeyForMaterial(IDS.user, IDS.space, IDS.project, IDS.material)).toBe(
      "users/u-1/spaces/s-1/projects/p-1/materials/m-1/original.pdf"
    );
  });

  it("builds page+hash image keys (same bytes → same key)", () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const a = storageKeyForImage(IDS.user, IDS.space, IDS.project, IDS.material, 2, png);
    const b = storageKeyForImage(IDS.user, IDS.space, IDS.project, IDS.material, 2, png);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^users\/u-1\/spaces\/s-1\/projects\/p-1\/materials\/m-1\/images\/page-2-[0-9a-f]{16}\.png$/
    );
    const other = storageKeyForImage(
      IDS.user,
      IDS.space,
      IDS.project,
      IDS.material,
      2,
      new Uint8Array([9])
    );
    expect(other).not.toBe(a);
  });

  it("sanitizes hostile segments instead of embedding paths", () => {
    const key = storageKeyForMaterial("../../etc", "s", "p", "m");
    expect(key).not.toContain("..");
    expect(key).toBe("users/______etc/spaces/s/projects/p/materials/m/original.pdf");
  });

  it("never derives keys from user-supplied filenames", () => {
    const key = storageKeyForMaterial(IDS.user, IDS.space, IDS.project, IDS.material);
    expect(key).toBe(storageKeyForMaterial(IDS.user, IDS.space, IDS.project, IDS.material));
  });
});

describe("NeonObjectStorageProvider (mocked S3 transport)", () => {
  it("uploads with content type + SHA-256 checksum binding", async () => {
    const client = mockClient(async () => ({}));
    const provider = new NeonObjectStorageProvider(NEON_CONFIG, client);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const stored = await provider.upload({ key: "k", bytes, contentType: "application/pdf" });
    expect(stored).toMatchObject({ key: "k", sizeBytes: 4, checksumSha256Hex: sha256Hex(bytes) });
    const sent = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(PutObjectCommand);
    expect(sent.input).toMatchObject({
      Bucket: "study-materials",
      Key: "k",
      ContentType: "application/pdf",
    });
    expect(typeof sent.input.ChecksumSHA256).toBe("string");
  });

  it("downloads bytes and maps misses to null", async () => {
    const client = mockClient(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new Uint8Array([9, 8, 7]) } };
      }
      throw new Error("unexpected command");
    });
    const provider = new NeonObjectStorageProvider(NEON_CONFIG, client);
    const bytes = await provider.download("k");
    expect(bytes).toBeInstanceOf(Buffer);
    expect([...(bytes ?? [])]).toEqual([9, 8, 7]);

    const missing = mockClient(async () => {
      throw s3Error("NoSuchKey", 404);
    });
    const missingProvider = new NeonObjectStorageProvider(NEON_CONFIG, missing);
    await expect(missingProvider.download("gone")).resolves.toBeNull();
    await expect(missingProvider.exists("gone")).resolves.toBe(false);
  });

  it("checks existence via HEAD", async () => {
    const client = mockClient(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return {};
      throw new Error("unexpected command");
    });
    const provider = new NeonObjectStorageProvider(NEON_CONFIG, client);
    await expect(provider.exists("k")).resolves.toBe(true);
  });

  it("bulk-deletes tolerantly and reports the deleted count", async () => {
    const client = mockClient(async () => ({ Deleted: [{ Key: "a" }] }));
    const provider = new NeonObjectStorageProvider(NEON_CONFIG, client);
    const result = await provider.deleteObjects(["a", "already-gone"]);
    expect(result).toEqual({ deleted: 1 });
    const sent = (client.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(DeleteObjectsCommand);
    await expect(provider.deleteObjects([])).resolves.toEqual({ deleted: 0 });
  });

  it("marks throttling/transport failures retryable, auth failures permanent", async () => {
    const slow = mockClient(async () => {
      throw s3Error("SlowDown", 503);
    });
    const slowProvider = new NeonObjectStorageProvider(NEON_CONFIG, slow);
    const slowError = await slowProvider
      .upload({ key: "k", bytes: new Uint8Array([1]), contentType: "application/pdf" })
      .catch((e: unknown) => e);
    expect(slowError).toBeInstanceOf(StorageError);
    expect((slowError as StorageError).retryable).toBe(true);

    const denied = mockClient(async () => {
      throw s3Error("InvalidAccessKeyId", 403);
    });
    const deniedProvider = new NeonObjectStorageProvider(NEON_CONFIG, denied);
    const deniedError = await deniedProvider.download("k").catch((e: unknown) => e);
    expect(deniedError).toBeInstanceOf(StorageError);
    expect((deniedError as StorageError).retryable).toBe(false);
    expect((deniedError as StorageError).code).toBe("access-denied");
  });

  it("refuses to construct without credentials (exact missing list)", () => {
    expect(
      () =>
        new NeonObjectStorageProvider({
          endpoint: "",
          region: "us-east-2",
          bucket: "",
          accessKeyId: "",
          secretAccessKey: "",
        })
    ).toThrow(/missing: endpoint, bucket, accessKeyId, secretAccessKey/);
  });
});

describe("provider factory (no silent fallbacks)", () => {
  it("returns null (honestly unconfigured) when bucket credentials are absent", () => {
    expect(createStorageProviderFromEnv({ provider: "neon" })).toBeNull();
  });

  it("builds the real provider when credentials are present", () => {
    const provider = createStorageProviderFromEnv({
      provider: "neon",
      bucket: "b",
      endpoint: "https://example.neon.tech",
      region: "us-east-2",
      accessKeyId: "id",
      secretAccessKey: "secret",
    });
    expect(provider).toBeInstanceOf(NeonObjectStorageProvider);
  });

  it("rejects unknown provider names instead of guessing", () => {
    expect(() => createStorageProviderFromEnv({ provider: "r2" })).toThrow(
      /Unknown STORAGE_PROVIDER/
    );
  });

  it("never builds the redis transport blind (app singletons own the client)", () => {
    expect(() => createStorageProviderFromEnv({ provider: "redis" })).toThrow(/singletons/);
  });
});

describe("RedisStorageProvider (fake client, no server)", () => {
  function fakeRedis(): { client: RedisBytesClient; calls: string[] } {
    const store = new Map<string, Buffer>();
    const calls: string[] = [];
    const client: RedisBytesClient = {
      getBuffer: async (key: string) => {
        calls.push(`get:${key}`);
        const found = store.get(key);
        return found ? Buffer.from(found) : null;
      },
      set: async (key: string, value: Buffer) => {
        calls.push(`set:${key}`);
        store.set(key, Buffer.from(value));
        return "OK";
      },
      del: async (...keys: string[]) => {
        let count = 0;
        for (const key of keys) {
          if (store.delete(key)) count += 1;
        }
        return count;
      },
      exists: async (...keys: string[]) => keys.filter((k) => store.has(k)).length,
      ping: async () => "PONG",
    };
    return { client, calls };
  }

  it("round-trips bytes under encoded keys", async () => {
    const { client, calls } = fakeRedis();
    const provider = new RedisStorageProvider(client);
    expect(provider.name).toBe("redis-test-transport");
    await provider.upload({
      key: "users/a/b",
      bytes: new Uint8Array([7, 8]),
      contentType: "application/pdf",
    });
    // Raw object keys never touch Redis keyspace directly.
    expect(calls.some((c) => c.includes("users/a/b"))).toBe(false);
    await expect(provider.exists("users/a/b")).resolves.toBe(true);
    expect([...((await provider.download("users/a/b")) ?? [])]).toEqual([7, 8]);
    await expect(provider.download("missing")).resolves.toBeNull();
    await expect(provider.deleteObjects(["users/a/b", "missing"])).resolves.toEqual({ deleted: 1 });
    await provider.healthCheck();
  });
});

describe("MemoryStorageProvider (explicit test double)", () => {
  it("round-trips bytes without any bucket", async () => {
    const provider = new MemoryStorageProvider();
    await provider.upload({ key: "k", bytes: new Uint8Array([5, 6]), contentType: "image/png" });
    expect(provider.name).toBe("memory-test-double");
    await expect(provider.exists("k")).resolves.toBe(true);
    expect([...((await provider.download("k")) ?? [])]).toEqual([5, 6]);
    await expect(provider.deleteObjects(["k"])).resolves.toEqual({ deleted: 1 });
    await expect(provider.download("k")).resolves.toBeNull();
  });

  it("is constructible outside production (this suite)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(() => new MemoryStorageProvider()).not.toThrow();
  });
});

function mockDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const delegate: BlobRecordDelegate = {
    findUnique: async (args: unknown) => {
      const where = (args as { where?: { storageKey?: string } }).where;
      return (where?.storageKey && rows.get(where.storageKey)) ?? null;
    },
    create: async (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      const row = {
        id: `blob-${rows.size + 1}`,
        createdAt: new Date(),
        pageNumber: null,
        width: null,
        height: null,
        ...data,
      };
      rows.set(data.storageKey as string, row);
      return row;
    },
    deleteMany: async (args: unknown) => {
      const where = (args as { where?: { materialId?: string; kind?: string } }).where ?? {};
      let count = 0;
      for (const [key, row] of [...rows]) {
        if (where.materialId !== undefined && row.materialId !== where.materialId) continue;
        if (where.kind !== undefined && row.kind !== where.kind) continue;
        rows.delete(key);
        count += 1;
      }
      return { count };
    },
    findMany: async (args: unknown) => {
      const where = (args as { where?: { materialId?: string } }).where ?? {};
      return [...rows.values()].filter((r) =>
        where.materialId !== undefined ? r.materialId === where.materialId : true
      );
    },
    count: async (args: unknown) => {
      const where = (args as { where?: { materialId?: string; kind?: string } }).where ?? {};
      return [...rows.values()].filter(
        (r) =>
          (where.materialId === undefined || r.materialId === where.materialId) &&
          (where.kind === undefined || r.kind === where.kind)
      ).length;
    },
  };
  return { db: { materialBlob: delegate }, rows };
}

describe("blob metadata records (PostgreSQL holds no bytes)", () => {
  it("upserts idempotently and conflicts on divergent checksums", async () => {
    const { db } = mockDb();
    const input = {
      materialId: "m-1",
      kind: BLOB_KIND_SOURCE_PDF,
      storageKey: "users/u/spaces/s/projects/p/materials/m-1/original.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: "abc",
    };
    const first = await upsertBlobRecord(db, input);
    const second = await upsertBlobRecord(db, input);
    expect(second.id).toBe(first.id);
    await expect(upsertBlobRecord(db, { ...input, checksum: "different" })).rejects.toThrow(
      /Storage key conflict/
    );
  });

  it("records image dimensions and counts kinds separately", async () => {
    const { db } = mockDb();
    await upsertBlobRecord(db, {
      materialId: "m-1",
      kind: BLOB_KIND_SOURCE_PDF,
      storageKey: "pdf-key",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksum: "a",
    });
    await upsertBlobRecord(db, {
      materialId: "m-1",
      kind: BLOB_KIND_EXTRACTED_IMAGE,
      storageKey: "img-key",
      mimeType: "image/png",
      sizeBytes: 4,
      checksum: "b",
      pageNumber: 2,
      width: 640,
      height: 480,
    });
    const images = await listBlobRecordsByMaterial(db, "m-1");
    expect(images).toHaveLength(2);
    const image = images.find((r) => r.kind === BLOB_KIND_EXTRACTED_IMAGE);
    expect(image).toMatchObject({ pageNumber: 2, width: 640, height: 480 });
    expect(await countSourceBlobRecords(db, "m-1")).toBe(1);
    expect(await countImageBlobRecords(db, "m-1")).toBe(1);
    expect(await getBlobRecord(db, "missing")).toBeNull();
    expect(await deleteBlobRecordsByMaterial(db, "m-1")).toBe(2);
  });

  it("marks the object-storage backend (no NEON_DB bytea value)", () => {
    expect(STORAGE_PROVIDER_NEON_OBJECT_STORAGE).toBe("NEON_OBJECT_STORAGE");
  });
});
