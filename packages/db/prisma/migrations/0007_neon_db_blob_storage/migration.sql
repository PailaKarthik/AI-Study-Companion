-- Replace Cloudflare R2 object storage with Neon PostgreSQL bytea blob
-- storage (no credit-card-gated storage account required).
--
-- * `materials.storageProvider` records the backend per row (`NEON_DB`
--   for all new uploads; backfilled for existing rows).
-- * `materials.storageUrl` (R2 signed-URL legacy, never populated by any
--   shipped code path) is dropped.
-- * New `material_blobs` table holds source PDFs + extracted page images
--   as bytea, cascade-deleted with the material. `storageKey` values are
--   provider-neutral (`materials/<materialId>/…`); `Material.storageKey`
--   mirrors the source-PDF blob's key.
-- * Existing rows have NO blob bytes (R2 objects were never created by
--   this codebase): they keep working for metadata/knowledge flows, but
--   download/processing paths report "re-upload required" until the file
--   is uploaded through the new endpoint.

-- Add provider column (backfill existing rows to NEON_DB).
ALTER TABLE "materials" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'NEON_DB';

-- Drop the R2 signed-URL legacy column (always NULL in practice).
ALTER TABLE "materials" DROP COLUMN IF EXISTS "storageUrl";

-- CreateTable
CREATE TABLE "material_blobs" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_blobs_storageKey_key" ON "material_blobs"("storageKey");
CREATE INDEX "material_blobs_materialId_idx" ON "material_blobs"("materialId");
CREATE INDEX "material_blobs_checksum_idx" ON "material_blobs"("checksum");

-- AddForeignKey
ALTER TABLE "material_blobs" ADD CONSTRAINT "material_blobs_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
