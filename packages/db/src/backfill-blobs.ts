/**
 * One-shot backfill: PostgreSQL bytea → Neon Object Storage bucket.
 *
 * RUN BEFORE `migrate deploy` of 0008_neon_object_storage (which drops
 * `material_blobs.data`). Requires bucket credentials in the
 * environment (STORAGE_BUCKET + AWS_*). For each `material_blobs` row
 * still holding `data`, uploads the bytes under the new isolated key
 * layout and repoints `storageKey`/`storageProvider`. Idempotent:
 * rows already repointed (no `data`) are skipped; re-running uploads
 * only missing keys (verified via HEAD before PUT).
 *
 * Usage: pnpm --filter @ai-study-companion/db backfill-blobs
 */
import {
  getPrisma,
  createStorageProviderFromEnv,
  storageKeyForImage,
  storageKeyForMaterial,
} from "./index.js";

interface BlobRow {
  id: string;
  materialId: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pageNumber: number | null;
  userId: string;
  spaceId: string;
  projectId: string;
  data: Buffer | null;
}

async function main(): Promise<void> {
  const db = getPrisma();
  if (!db) throw new Error("DATABASE_URL is not set; refusing to run.");
  const storage = createStorageProviderFromEnv({
    provider: process.env.STORAGE_PROVIDER,
    bucket: process.env.STORAGE_BUCKET,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
  if (!storage) {
    throw new Error(
      "Bucket credentials missing (STORAGE_BUCKET + AWS_*); refusing to backfill into the void."
    );
  }
  const rows = await db.$queryRaw<BlobRow[]>`
    SELECT b."id", b."materialId", b."kind", b."storageKey", b."mimeType",
           b."sizeBytes", b."checksum", b."pageNumber",
           m."ownerId" AS "userId", p."spaceId" AS "spaceId", m."projectId" AS "projectId",
           b."data"
    FROM "material_blobs" b
    JOIN "materials" m ON m."id" = b."materialId"
    JOIN "projects" p ON p."id" = m."projectId"
    WHERE b."data" IS NOT NULL
    ORDER BY b."createdAt" ASC
  `;
  let uploaded = 0;
  let skipped = 0;
  for (const row of rows) {
    const bytes = row.data ? Buffer.from(row.data) : null;
    if (!bytes || bytes.length === 0) {
      skipped += 1;
      continue;
    }
    const key =
      row.kind === "EXTRACTED_IMAGE" && row.pageNumber
        ? storageKeyForImage(
            row.userId,
            row.spaceId,
            row.projectId,
            row.materialId,
            row.pageNumber,
            new Uint8Array(bytes)
          )
        : storageKeyForMaterial(row.userId, row.spaceId, row.projectId, row.materialId);
    if (!(await storage.exists(key))) {
      await storage.upload({ key, bytes: new Uint8Array(bytes), contentType: row.mimeType });
      uploaded += 1;
    }
    await db.materialBlob.update({
      where: { id: row.id },
      data: { storageKey: key },
    });
    if (row.kind === "SOURCE_PDF") {
      await db.material.update({
        where: { id: row.materialId },
        data: { storageKey: key, storageProvider: "NEON_OBJECT_STORAGE" },
      });
    }
  }
  console.log(
    `backfill done: uploaded=${uploaded} already-present=${rows.length - uploaded - skipped} empty-skipped=${skipped}`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
