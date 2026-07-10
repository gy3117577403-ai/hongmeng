-- AlterTable
ALTER TABLE "connector_assembly_manual_versions"
ADD COLUMN "detected_title" TEXT,
ADD COLUMN "parse_status" TEXT,
ADD COLUMN "parse_warnings" JSONB;

-- AlterTable
ALTER TABLE "connector_assembly_manual_assets"
ADD COLUMN "relative_path" TEXT,
ADD COLUMN "file_hash" TEXT;

-- CreateTable
CREATE TABLE "connector_assembly_manual_import_batches" (
    "id" TEXT NOT NULL,
    "source_name" TEXT,
    "total_count" INTEGER NOT NULL,
    "ready_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "created_by" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manual_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_assembly_manual_import_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "relative_path" TEXT,
    "file_mode" TEXT NOT NULL,
    "file_hash" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "revision" TEXT,
    "manual_id" TEXT,
    "version_id" TEXT,
    "page_count" INTEGER,
    "detected_title" TEXT,
    "error_message" TEXT,
    "warnings_json" JSONB,
    "metadata_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manual_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_assembly_manual_versions_parse_status_idx" ON "connector_assembly_manual_versions"("parse_status");
CREATE INDEX "connector_assembly_manual_assets_file_hash_idx" ON "connector_assembly_manual_assets"("file_hash");
CREATE INDEX "connector_assembly_manual_assets_relative_path_idx" ON "connector_assembly_manual_assets"("relative_path");
CREATE INDEX "connector_assembly_manual_import_batches_status_idx" ON "connector_assembly_manual_import_batches"("status");
CREATE INDEX "connector_assembly_manual_import_batches_created_at_idx" ON "connector_assembly_manual_import_batches"("created_at");
CREATE UNIQUE INDEX "connector_assembly_manual_import_items_batch_id_client_id_key" ON "connector_assembly_manual_import_items"("batch_id", "client_id");
CREATE INDEX "connector_assembly_manual_import_items_batch_id_status_idx" ON "connector_assembly_manual_import_items"("batch_id", "status");
CREATE INDEX "connector_assembly_manual_import_items_file_hash_idx" ON "connector_assembly_manual_import_items"("file_hash");
CREATE INDEX "connector_assembly_manual_import_items_manual_id_idx" ON "connector_assembly_manual_import_items"("manual_id");
CREATE INDEX "connector_assembly_manual_import_items_version_id_idx" ON "connector_assembly_manual_import_items"("version_id");

-- AddForeignKey
ALTER TABLE "connector_assembly_manual_import_items" ADD CONSTRAINT "connector_assembly_manual_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "connector_assembly_manual_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_assembly_manual_import_items" ADD CONSTRAINT "connector_assembly_manual_import_items_manual_id_fkey" FOREIGN KEY ("manual_id") REFERENCES "connector_assembly_manuals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "connector_assembly_manual_import_items" ADD CONSTRAINT "connector_assembly_manual_import_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "connector_assembly_manual_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
