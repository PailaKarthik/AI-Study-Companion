import { createHash } from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PrismaClient } from "@prisma/client";

/**
 * Neon Object Storage provider (S3-compatible bucket — replaces both the
 * never-built Cloudflare R2 integration and the interim PostgreSQL bytea
 * store). Verified against the official docs
 * (https://neon.com/docs/storage/overview):
 * standard `@aws-sdk/client-s3` pointed at the branch endpoint
 * (`AWS_ENDPOINT_URL_S3`) with `forcePathStyle: true`, authenticated by
 * the branch credential (`AWS_ACCESS_KEY_ID` = token_id,
 * `AWS_SECRET_ACCESS_KEY` = s3_secret_access_key).
 *
 * Hard boundary: PostgreSQL holds ONLY metadata (`MaterialBlob` rows:
 * key, MIME, size, checksum, page, dimensions). Every byte lives in the
 * bucket. This module never touches `material_blobs.data` — that column
 * no longer exists (migration 0008).
 *
 * Boundaries:
 * - This module is byte mechanics only (upload/download/exists/delete).
 *   All authorization (ownership, project isolation) lives in API
 *   services, which verify first and call here second. Keys are never
 *   client-supplied — services build them from owned ids only.
 * - Failures are typed `StorageError`s carrying `retryable`: 5xx /
 *   throttling / transport errors retry (BullMQ redelivers); missing
 *   credentials/bucket/permissions are permanent configuration errors.
 */

export const STORAGE_PROVIDER_NEON_OBJECT_STORAGE = "NEON_OBJECT_STORAGE" as const;

/** Blob kinds. Images carry pageNumber + dimensions; the source PDF does not. */
export const BLOB_KIND_SOURCE_PDF = "SOURCE_PDF" as const;
export const BLOB_KIND_EXTRACTED_IMAGE = "EXTRACTED_IMAGE" as const;

export type BlobKind = typeof BLOB_KIND_SOURCE_PDF | typeof BLOB_KIND_EXTRACTED_IMAGE;

/** Metadata row (PostgreSQL). No bytes — ever. */
export interface StoredBlobMeta {
  id: string;
  materialId: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pageNumber: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

/** SHA-256 hex of raw bytes. Powers dedup + integrity checks. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Raw SHA-256 digest as base64 (S3 `ChecksumSHA256` wire format). */
function sha256Base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

// ---------------------------------------------------------------------------
// Object key layout (isolated, deterministic, collision-free).
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Source PDF key: users/<u>/spaces/<s>/projects/<p>/materials/<m>/original.pdf */
export function storageKeyForMaterial(
  userId: string,
  spaceId: string,
  projectId: string,
  materialId: string
): string {
  const parts = [
    sanitizeSegment(userId, "user"),
    sanitizeSegment(spaceId, "space"),
    sanitizeSegment(projectId, "project"),
    sanitizeSegment(materialId, "material"),
  ];
  return `users/${parts[0]}/spaces/${parts[1]}/projects/${parts[2]}/materials/${parts[3]}/original.pdf`;
}

/**
 * Extracted-image key: …/materials/<m>/images/page-<n>-<hash>.png.
 * The hash derives from the PNG bytes, so identical images are naturally
 * idempotent (same bytes → same key → same object).
 */
export function storageKeyForImage(
  userId: string,
  spaceId: string,
  projectId: string,
  materialId: string,
  pageNumber: number,
  pngBytes: Uint8Array
): string {
  const parts = [
    sanitizeSegment(userId, "user"),
    sanitizeSegment(spaceId, "space"),
    sanitizeSegment(projectId, "project"),
    sanitizeSegment(materialId, "material"),
  ];
  const hash = sha256Hex(pngBytes).slice(0, 16);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 0;
  return (
    `users/${parts[0]}/spaces/${parts[1]}/projects/${parts[2]}/` +
    `materials/${parts[3]}/images/page-${page}-${hash}.png`
  );
}

// ---------------------------------------------------------------------------
// Provider abstraction.
// ---------------------------------------------------------------------------

export interface UploadObjectInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksumSha256Hex: string;
}

export interface StorageProvider {
  readonly name: string;
  /** Idempotent put (same key + same bytes converges; S3 overwrites). */
  upload(input: UploadObjectInput): Promise<StoredObject>;
  /** Object bytes, or null when the key does not exist. */
  download(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /**
   * Bulk delete. Tolerant by design: already-missing keys count as
   * deleted (cleanup must never crash on partial state).
   */
  deleteObjects(keys: string[]): Promise<{ deleted: number }>;
  /** Short-lived presigned GET (server-side flows prefer `download`). */
  getPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Reachability probe (no values read). Throws StorageError when down. */
  healthCheck(): Promise<void>;
}

export class StorageError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

function toStorageError(error: unknown, operation: string, key?: string): StorageError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
  const where = key ? ` (key ${key})` : "";
  // A genuinely absent object resolves to null/false at the call site —
  // never an exception. Missing buckets, revoked credentials, and denied
  // access are permanent configuration errors and must throw (a 403 is
  // not a missing file).
  if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
    return new StorageError("missing-object", `Storage object not found${where}`, false);
  }
  if (
    name === "NoSuchBucket" ||
    name === "InvalidAccessKeyId" ||
    name === "AccessDenied" ||
    name === "Forbidden" ||
    status === 403
  ) {
    return new StorageError(
      "access-denied",
      `Storage ${operation} denied${where}: ${message} ` +
        `(check bucket name, credential scopes, and branch lineage)`,
      false
    );
  }
  return new StorageError("transient", `Storage ${operation} failed${where}: ${message}`, true);
}

export interface NeonObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Concrete provider for Neon Object Storage: plain AWS SDK v3 against
 * the branch endpoint — exactly the official quickstart shape
 * (https://neon.com/docs/storage/get-started#configure-your-client).
 */
export class NeonObjectStorageProvider implements StorageProvider {
  readonly name = "neon-object-storage";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: NeonObjectStorageConfig, client?: S3Client) {
    const missing = (
      ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"] as const
    ).filter((field) => !config[field] || config[field].trim().length === 0);
    if (missing.length > 0) {
      throw new StorageError(
        "not-configured",
        `Neon Object Storage is not configured (missing: ${missing.join(", ")}). ` +
          `Create a branch credential with storage:read + storage:write scopes and set ` +
          `AWS_ENDPOINT_URL_S3, AWS_REGION, STORAGE_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.`,
        false
      );
    }
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: true,
        // The SDK otherwise presigns/uploads with an empty-body checksum
        // that rejects real content (official docs callout).
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.bytes,
          ContentType: input.contentType,
          ChecksumSHA256: sha256Base64(input.bytes),
        })
      );
      return {
        key: input.key,
        sizeBytes: input.bytes.length,
        checksumSha256Hex: sha256Hex(input.bytes),
      };
    } catch (error) {
      throw toStorageError(error, "upload", input.key);
    }
  }

  async download(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      const mapped = toStorageError(error, "download", key);
      if (mapped.code === "missing-object") return null;
      throw mapped;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const mapped = toStorageError(error, "exists", key);
      if (mapped.code === "missing-object") return false;
      throw mapped;
    }
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: number }> {
    if (keys.length === 0) return { deleted: 0 };
    try {
      // S3 silently skips missing keys — cleanup stays idempotent.
      const response = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
      return { deleted: response.Deleted?.length ?? 0 };
    } catch (error) {
      throw toStorageError(error, "delete");
    }
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expiresInSeconds }
      );
    } catch (error) {
      throw toStorageError(error, "presign", key);
    }
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      throw toStorageError(error, "health-check");
    }
  }
}

/**
 * Explicit in-memory test double. NOT a storage backend: it refuses to
 * construct in production, and nothing production-adjacent may select
 * it. Exists so unit/integration/E2E suites can exercise the
 * metadata↔bytes contract without bucket credentials (the same role
 * MockEmbeddingProvider plays for embeddings).
 */
export class MemoryStorageProvider implements StorageProvider {
  readonly name = "memory-test-double";
  private readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new StorageError(
        "not-configured",
        "The memory storage double is test-only and refused in production.",
        false
      );
    }
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    this.objects.set(input.key, {
      bytes: Buffer.from(input.bytes),
      contentType: input.contentType,
    });
    return {
      key: input.key,
      sizeBytes: input.bytes.length,
      checksumSha256Hex: sha256Hex(input.bytes),
    };
  }

  async download(key: string): Promise<Buffer | null> {
    const found = this.objects.get(key);
    return found ? Buffer.from(found.bytes) : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const key of keys) {
      if (this.objects.delete(key)) deleted += 1;
    }
    return { deleted };
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    if (!this.objects.has(key)) {
      throw new StorageError(
        "missing-object",
        `Storage presign failed (key ${key}): object not found`,
        false
      );
    }
    return `memory://${key}`;
  }

  async healthCheck(): Promise<void> {
    // In-process map: always reachable by construction.
  }
}

/**
 * Explicit Redis test transport. NOT a storage backend: it refuses to
 * construct in production, and nothing production-adjacent may select
 * it. Exists for one reason — the in-memory double cannot cross the
 * API/worker process boundary, so two-process E2E (Upload → worker →
 * Ready → Searchable) without bucket credentials runs against Redis
 * instead. Same role as MockEmbeddingProvider: contract fully
 * exercised, transport swapped in tests only.
 */
export interface RedisBytesClient {
  getBuffer(key: string): Promise<Buffer | null>;
  set(key: string, value: Buffer): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  ping(): Promise<string>;
}

export class RedisStorageProvider implements StorageProvider {
  readonly name = "redis-test-transport";
  private readonly prefix: string;

  constructor(
    private readonly redis: RedisBytesClient,
    prefix = "storage:obj:"
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new StorageError(
        "not-configured",
        "The Redis storage transport is test-only and refused in production.",
        false
      );
    }
    this.prefix = prefix;
  }

  private redisKey(key: string): string {
    return `${this.prefix}${Buffer.from(key, "utf8").toString("base64url")}`;
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    await this.redis.set(this.redisKey(input.key), Buffer.from(input.bytes));
    return {
      key: input.key,
      sizeBytes: input.bytes.length,
      checksumSha256Hex: sha256Hex(input.bytes),
    };
  }

  async download(key: string): Promise<Buffer | null> {
    const found = await this.redis.getBuffer(this.redisKey(key));
    return found ? Buffer.from(found) : null;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(this.redisKey(key))) > 0;
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: number }> {
    if (keys.length === 0) return { deleted: 0 };
    return { deleted: await this.redis.del(...keys.map((k) => this.redisKey(k))) };
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    if (!(await this.exists(key))) {
      throw new StorageError(
        "missing-object",
        `Storage presign failed (key ${key}): object not found`,
        false
      );
    }
    return `redis://${key}`;
  }

  async healthCheck(): Promise<void> {
    await this.redis.ping();
  }
}

export type StorageProviderKind = "neon" | "memory" | "redis";

export interface StorageEnvConfig {
  provider?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  nodeEnv?: string;
}

/**
 * Resolve a provider from environment-shaped config. `memory` is an
 * explicit opt-in test double (refused in production); anything else
 * builds the real Neon Object Storage client and fails fast with the
 * exact missing variables when credentials are absent.
 */
export function createStorageProviderFromEnv(env: StorageEnvConfig): StorageProvider | null {
  const kind = (env.provider ?? "neon").trim().toLowerCase();
  if (kind === "memory") {
    if ((env.nodeEnv ?? process.env.NODE_ENV) === "production") {
      throw new StorageError(
        "not-configured",
        "STORAGE_PROVIDER=memory is test-only and refused in production.",
        false
      );
    }
    return new MemoryStorageProvider();
  }
  if (kind === "redis") {
    // The Redis transport is assembled by the app singletons (they own
    // the ioredis connection); the env factory never builds it blind.
    throw new StorageError(
      "not-configured",
      "STORAGE_PROVIDER=redis is assembled by the API/worker storage singletons, not the env factory.",
      false
    );
  }
  if (kind !== "neon") {
    throw new StorageError(
      "not-configured",
      `Unknown STORAGE_PROVIDER "${env.provider}" (expected "neon", "memory", or "redis").`,
      false
    );
  }
  const missing =
    !env.bucket || !env.endpoint || !env.accessKeyId || !env.secretAccessKey
      ? [
          "STORAGE_BUCKET",
          "AWS_ENDPOINT_URL_S3",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
        ].filter((name) => {
          const value =
            name === "STORAGE_BUCKET"
              ? env.bucket
              : name === "AWS_ENDPOINT_URL_S3"
                ? env.endpoint
                : name === "AWS_ACCESS_KEY_ID"
                  ? env.accessKeyId
                  : env.secretAccessKey;
          return !value || value.trim().length === 0;
        })
      : [];
  if (missing.length > 0) {
    // Null = honestly unconfigured (callers 503/FAILED with a clear
    // message). Never a silent fallback to another store.
    return null;
  }
  return new NeonObjectStorageProvider({
    endpoint: env.endpoint as string,
    region: (env.region ?? "us-east-2").trim() || "us-east-2",
    bucket: env.bucket as string,
    accessKeyId: env.accessKeyId as string,
    secretAccessKey: env.secretAccessKey as string,
  });
}

// ---------------------------------------------------------------------------
// Metadata records (PostgreSQL). Keys, MIME, sizes, checksums, dimensions.
// ---------------------------------------------------------------------------

/** Minimal delegate surface so unit tests can inject a mock. */
export interface BlobRecordDelegate {
  findUnique(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  findMany(args: unknown): Promise<unknown[]>;
  count(args: unknown): Promise<number>;
}

export type BlobRecordDb =
  Pick<PrismaClient, "materialBlob"> | { materialBlob: BlobRecordDelegate };

export interface BlobRecordInput {
  materialId: string;
  kind: BlobKind | string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
}

function toMeta(row: {
  id: string;
  materialId: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pageNumber: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}): StoredBlobMeta {
  return {
    id: row.id,
    materialId: row.materialId,
    kind: row.kind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    pageNumber: row.pageNumber,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  };
}

/**
 * Record a bucket object idempotently: same key returns the existing row
 * (safe retries never duplicate); same key + different checksum is a
 * conflict (never silently repoint at another material's bytes).
 */
export async function upsertBlobRecord(
  db: BlobRecordDb,
  input: BlobRecordInput
): Promise<StoredBlobMeta> {
  const existing = (await db.materialBlob.findUnique({
    where: { storageKey: input.storageKey },
  })) as unknown as (StoredBlobMeta & { checksum: string }) | null;
  if (existing) {
    if (existing.checksum !== input.checksum) {
      throw new Error(
        `Storage key conflict: ${input.storageKey} already references different bytes.`
      );
    }
    return toMeta(existing as unknown as Parameters<typeof toMeta>[0]);
  }
  const created = (await db.materialBlob.create({
    data: {
      materialId: input.materialId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      pageNumber: input.pageNumber ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
    },
  })) as unknown as Parameters<typeof toMeta>[0];
  return toMeta(created);
}

/** Metadata without bytes (the DB never holds bytes). */
export async function getBlobRecord(
  db: BlobRecordDb,
  storageKey: string
): Promise<StoredBlobMeta | null> {
  const row = (await db.materialBlob.findUnique({
    where: { storageKey },
    select: {
      id: true,
      materialId: true,
      kind: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      pageNumber: true,
      width: true,
      height: true,
      createdAt: true,
    },
  })) as unknown as Parameters<typeof toMeta>[0] | null;
  return row ? toMeta(row) : null;
}

/** A material's object metadata (never bytes). */
export async function listBlobRecordsByMaterial(
  db: BlobRecordDb,
  materialId: string
): Promise<StoredBlobMeta[]> {
  const rows = (await db.materialBlob.findMany({
    where: { materialId },
    select: {
      id: true,
      materialId: true,
      kind: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      pageNumber: true,
      width: true,
      height: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as Parameters<typeof toMeta>[0][];
  return rows.map(toMeta);
}

/** Delete a material's metadata rows. Returns the removed count. */
export async function deleteBlobRecordsByMaterial(
  db: BlobRecordDb,
  materialId: string
): Promise<number> {
  const result = await db.materialBlob.deleteMany({ where: { materialId } });
  return result.count;
}

/** Source-PDF metadata rows (drives `hasFile`, never the bytes). */
export async function countSourceBlobRecords(
  db: BlobRecordDb,
  materialId: string
): Promise<number> {
  return db.materialBlob.count({
    where: { materialId, kind: BLOB_KIND_SOURCE_PDF },
  });
}

/** Extracted-image metadata rows for one material. */
export async function countImageBlobRecords(db: BlobRecordDb, materialId: string): Promise<number> {
  return db.materialBlob.count({
    where: { materialId, kind: BLOB_KIND_EXTRACTED_IMAGE },
  });
}
