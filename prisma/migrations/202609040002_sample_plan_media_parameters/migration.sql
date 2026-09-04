ALTER TABLE "sample_tasks"
ADD COLUMN "data_purpose" TEXT NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN "deleted_by_id" TEXT,
ADD COLUMN "deleted_by_name" TEXT,
ADD COLUMN "delete_reason" TEXT,
ADD COLUMN "delete_batch_id" TEXT,
ADD COLUMN "last_delete_mutation_id" TEXT;

CREATE INDEX "sample_tasks_data_purpose_status_idx"
ON "sample_tasks"("data_purpose", "status");

CREATE INDEX "sample_tasks_delete_batch_id_idx"
ON "sample_tasks"("delete_batch_id");

CREATE TABLE "sample_task_cleanup_batches" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "mutation_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'REMOVE_TASK_ONLY',
  "reason" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "result" JSONB,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sample_task_cleanup_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sample_task_cleanup_batches_mutation_id_key"
ON "sample_task_cleanup_batches"("mutation_id");

CREATE INDEX "sample_task_cleanup_batches_created_at_idx"
ON "sample_task_cleanup_batches"("created_at");

CREATE INDEX "sample_task_cleanup_batches_created_by_id_created_at_idx"
ON "sample_task_cleanup_batches"("created_by_id", "created_at");

ALTER TABLE "connector_parameters"
ADD COLUMN "technical_fingerprint" TEXT,
ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN "supersedes_parameter_id" TEXT,
ADD COLUMN "locked_at" TIMESTAMP(3);

CREATE INDEX "connector_parameters_technical_fingerprint_idx"
ON "connector_parameters"("technical_fingerprint");

CREATE INDEX "connector_parameters_supersedes_parameter_id_idx"
ON "connector_parameters"("supersedes_parameter_id");

CREATE INDEX "connector_parameters_status_deleted_at_idx"
ON "connector_parameters"("status", "deleted_at");

ALTER TABLE "product_connector_parameter_bindings"
ADD COLUMN "position_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'SAMPLE_REVIEW',
ADD COLUMN "source_sample_task_id" TEXT,
ADD COLUMN "source_submission_id" TEXT,
ADD COLUMN "source_drawing_file_id" TEXT,
ADD COLUMN "source_payload_hash" TEXT,
ADD COLUMN "parameter_snapshot" JSONB,
ADD COLUMN "supersedes_binding_id" TEXT,
ADD COLUMN "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "effective_to" TIMESTAMP(3),
ADD COLUMN "retired_at" TIMESTAMP(3),
ADD COLUMN "retired_by_id" TEXT,
ADD COLUMN "retire_reason" TEXT;

UPDATE "product_connector_parameter_bindings" AS binding
SET "parameter_snapshot" = jsonb_build_object(
  'model', parameter."model",
  'outerPeelMm', parameter."outer_peel_mm",
  'innerPeelMm', parameter."inner_peel_mm",
  'insertionLengthMm', parameter."insertion_length_mm",
  'remark', parameter."remark",
  'revision', parameter."revision"
)
FROM "connector_parameters" AS parameter
WHERE parameter."id" = binding."connector_parameter_id"
  AND binding."parameter_snapshot" IS NULL;

CREATE INDEX "product_connector_parameter_bindings_item_position_current_idx"
ON "product_connector_parameter_bindings"("drawing_library_item_id", "position_key", "is_current");

CREATE INDEX "product_connector_parameter_bindings_source_sample_task_id_idx"
ON "product_connector_parameter_bindings"("source_sample_task_id");

CREATE INDEX "product_connector_parameter_bindings_source_submission_id_idx"
ON "product_connector_parameter_bindings"("source_submission_id");

CREATE INDEX "product_connector_parameter_bindings_source_drawing_file_id_idx"
ON "product_connector_parameter_bindings"("source_drawing_file_id");

CREATE INDEX "product_connector_parameter_bindings_supersedes_binding_id_idx"
ON "product_connector_parameter_bindings"("supersedes_binding_id");

CREATE TABLE "sample_publication_links" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sample_task_id" TEXT NOT NULL,
  "sample_entry_id" TEXT,
  "sample_photo_id" TEXT,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "target_child_id" TEXT,
  "source_snapshot" JSONB,
  "source_hash" TEXT,
  "publication_status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "retired_at" TIMESTAMP(3),
  "retired_by_id" TEXT,
  "retire_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sample_publication_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sample_publication_links_entry_target_key"
ON "sample_publication_links"("sample_entry_id", "target_type", "target_id");

CREATE UNIQUE INDEX "sample_publication_links_photo_target_key"
ON "sample_publication_links"("sample_photo_id", "target_type", "target_id");

CREATE INDEX "sample_publication_links_task_status_idx"
ON "sample_publication_links"("sample_task_id", "publication_status");

CREATE INDEX "sample_publication_links_target_idx"
ON "sample_publication_links"("target_type", "target_id");

CREATE TABLE "media_assets" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "original_object_key" TEXT NOT NULL,
  "preview_object_key" TEXT,
  "thumbnail_object_key" TEXT,
  "sha256" TEXT,
  "mime_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "original_width" INTEGER,
  "original_height" INTEGER,
  "exif_orientation" INTEGER,
  "metadata_normalized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_original_object_key_key"
ON "media_assets"("original_object_key");

CREATE INDEX "media_assets_sha256_idx" ON "media_assets"("sha256");
CREATE INDEX "media_assets_created_at_idx" ON "media_assets"("created_at");

ALTER TABLE "sample_photos" ADD COLUMN "media_asset_id" TEXT;

ALTER TABLE "drawing_library_files"
ADD COLUMN "media_asset_id" TEXT,
ADD COLUMN "sha256" TEXT,
ADD COLUMN "source_type" TEXT,
ADD COLUMN "source_entity_id" TEXT;

INSERT INTO "media_assets" (
  "original_object_key", "sha256", "mime_type", "byte_size", "created_at", "updated_at"
)
SELECT photo."object_key", photo."sha256", photo."mime_type", photo."size", photo."created_at", photo."updated_at"
FROM "sample_photos" AS photo
ON CONFLICT ("original_object_key") DO NOTHING;

UPDATE "sample_photos" AS photo
SET "media_asset_id" = asset."id"
FROM "media_assets" AS asset
WHERE asset."original_object_key" = photo."object_key";

UPDATE "drawing_library_files" AS file
SET "media_asset_id" = asset."id",
    "sha256" = photo."sha256",
    "source_type" = 'SAMPLE_PHOTO',
    "source_entity_id" = photo."id"
FROM "sample_photos" AS photo
JOIN "media_assets" AS asset ON asset."original_object_key" = photo."object_key"
WHERE photo."published_file_id" = file."id";

CREATE INDEX "sample_photos_media_asset_id_idx" ON "sample_photos"("media_asset_id");
CREATE INDEX "drawing_library_files_media_asset_id_idx" ON "drawing_library_files"("media_asset_id");
CREATE INDEX "drawing_library_files_source_type_source_entity_id_idx"
ON "drawing_library_files"("source_type", "source_entity_id");

ALTER TABLE "sample_photos"
ADD CONSTRAINT "sample_photos_media_asset_id_fkey"
FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "drawing_library_files"
ADD CONSTRAINT "drawing_library_files_media_asset_id_fkey"
FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
