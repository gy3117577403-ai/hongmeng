CREATE SEQUENCE IF NOT EXISTS "material_library_code_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

SELECT setval(
  'material_library_code_seq',
  GREATEST(
    COALESCE((
      SELECT MAX((substring("code" FROM '^MAT-([0-9]+)$'))::BIGINT)
      FROM "material_library_items"
      WHERE "code" ~ '^MAT-[0-9]+$'
    ), 0) + 1,
    1
  ),
  false
);

CREATE TABLE "material_library_supplier_variants" (
  "id" TEXT NOT NULL,
  "material_item_id" TEXT NOT NULL,
  "supplier_name" TEXT,
  "manufacturer_model" TEXT,
  "supplier_part_number" TEXT,
  "specification" TEXT,
  "material_composition" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_supplier_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_supplier_variants_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "material_library_specification_documents" (
  "id" TEXT NOT NULL,
  "supplier_variant_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "object_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "uploaded_by_id" TEXT,
  "uploaded_by_name" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_library_specification_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_library_specification_documents_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "material_library_specification_documents_size_check" CHECK ("size" > 0)
);

ALTER TABLE "material_library_capture_sessions"
  ADD COLUMN "supplier_variant_id" TEXT;

CREATE INDEX "material_library_supplier_variants_material_item_id_deleted_at_is_primary_updated_at_idx"
  ON "material_library_supplier_variants"("material_item_id", "deleted_at", "is_primary", "updated_at");
CREATE INDEX "material_library_supplier_variants_supplier_name_deleted_at_updated_at_idx"
  ON "material_library_supplier_variants"("supplier_name", "deleted_at", "updated_at");
CREATE INDEX "material_library_supplier_variants_manufacturer_model_deleted_at_updated_at_idx"
  ON "material_library_supplier_variants"("manufacturer_model", "deleted_at", "updated_at");
CREATE UNIQUE INDEX "material_library_supplier_variants_one_primary_idx"
  ON "material_library_supplier_variants"("material_item_id")
  WHERE "is_primary" = true AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "material_library_specification_documents_object_key_key"
  ON "material_library_specification_documents"("object_key");
CREATE INDEX "material_library_specification_documents_supplier_variant_id_deleted_at_is_current_revision_idx"
  ON "material_library_specification_documents"("supplier_variant_id", "deleted_at", "is_current", "revision");
CREATE INDEX "material_library_specification_documents_sha256_supplier_variant_id_idx"
  ON "material_library_specification_documents"("sha256", "supplier_variant_id");
CREATE UNIQUE INDEX "material_library_specification_documents_one_current_idx"
  ON "material_library_specification_documents"("supplier_variant_id")
  WHERE "is_current" = true AND "deleted_at" IS NULL;

CREATE INDEX "material_library_capture_sessions_supplier_variant_id_status_updated_at_idx"
  ON "material_library_capture_sessions"("supplier_variant_id", "status", "updated_at");

ALTER TABLE "material_library_supplier_variants"
  ADD CONSTRAINT "material_library_supplier_variants_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_library_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_library_specification_documents"
  ADD CONSTRAINT "material_library_specification_documents_supplier_variant_id_fkey"
  FOREIGN KEY ("supplier_variant_id") REFERENCES "material_library_supplier_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_library_capture_sessions"
  ADD CONSTRAINT "material_library_capture_sessions_supplier_variant_id_fkey"
  FOREIGN KEY ("supplier_variant_id") REFERENCES "material_library_supplier_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "material_library_supplier_variants" (
  "id",
  "material_item_id",
  "supplier_name",
  "manufacturer_model",
  "supplier_part_number",
  "specification",
  "material_composition",
  "is_primary",
  "created_by_id",
  "created_by_name",
  "updated_by_id",
  "updated_by_name",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  item."id",
  item."supplier_name",
  item."manufacturer_model",
  item."supplier_part_number",
  item."specification",
  item."material_composition",
  true,
  item."created_by_id",
  item."created_by_name",
  item."updated_by_id",
  item."updated_by_name",
  item."created_at",
  item."updated_at"
FROM "material_library_items" item
WHERE item."supplier_name" IS NOT NULL
   OR item."manufacturer_model" IS NOT NULL
   OR item."supplier_part_number" IS NOT NULL
   OR item."specification" IS NOT NULL
   OR item."material_composition" IS NOT NULL;

UPDATE "material_library_capture_sessions" session
SET "supplier_variant_id" = variant."id"
FROM "material_library_supplier_variants" variant
WHERE variant."material_item_id" = session."material_item_id"
  AND variant."is_primary" = true
  AND variant."deleted_at" IS NULL;
