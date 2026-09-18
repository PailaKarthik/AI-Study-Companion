-- Move binary file storage from PostgreSQL bytea to Neon Object
-- Storage (S3-compatible bucket, verified at
-- https://neon.com/docs/storage/overview).
--
-- * `material_blobs.data` (BYTEA) is dropped: PDF/image bytes belong in
--   the bucket; PostgreSQL keeps only metadata (key, MIME, size,
--   checksum, page, dimensions). No binary content remains in the DB.
-- * `material_blobs.width/height` record EXTRACTED_IMAGE PNG dimensions
--   (NULL for source PDFs) for the Tutor's future selective use.
-- * `materials.storageProvider` moves to `NEON_OBJECT_STORAGE`.
--
-- DATA SAFETY: dropping `data` destroys bytes stored by the previous
-- implementation. Any environment holding real user bytes MUST run the
-- backfill first: `pnpm --filter @ai-study-companion/db backfill-blobs`
-- (uploads every bytea row to the bucket under the new isolated key
-- layout and repoints `storageKey`). Only then `migrate deploy`.
-- Environments without real bytes (tests, fresh installs) need nothing.
-- Post-migration, downloads for objects missing from the bucket resolve
-- to an honest 404 ("re-upload required") — never an empty file.

-- Record image dimensions (NULL for source PDFs).
ALTER TABLE "material_blobs" ADD COLUMN "width" INTEGER;
ALTER TABLE "material_blobs" ADD COLUMN "height" INTEGER;

-- Drop the bytea payload: binaries live in the bucket from here on.
ALTER TABLE "material_blobs" DROP COLUMN "data";

-- New backend marker for all rows going forward.
ALTER TABLE "materials" ALTER COLUMN "storageProvider" SET DEFAULT 'NEON_OBJECT_STORAGE';
UPDATE "materials" SET "storageProvider" = 'NEON_OBJECT_STORAGE' WHERE "storageProvider" = 'NEON_DB';
