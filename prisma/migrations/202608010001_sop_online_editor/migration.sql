CREATE TABLE "sop_documents" (
  "id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "current_published_version_id" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sop_versions" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "content_schema_version" INTEGER NOT NULL DEFAULT 1,
  "based_on_version_id" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "published_by_id" TEXT,
  "published_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sop_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sop_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "sop_versions_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "sop_versions_schema_check" CHECK ("content_schema_version" > 0),
  CONSTRAINT "sop_versions_status_check" CHECK ("status" IN ('draft', 'published'))
);

CREATE TABLE "sop_assets" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "display_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "object_key" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "uploaded_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sop_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sop_assets_size_check" CHECK ("size" >= 0)
);

ALTER TABLE "drawing_library_files"
  ADD COLUMN "source_sop_version_id" TEXT;

CREATE UNIQUE INDEX "sop_documents_drawing_library_item_id_key"
  ON "sop_documents"("drawing_library_item_id");
CREATE UNIQUE INDEX "sop_documents_current_published_version_id_key"
  ON "sop_documents"("current_published_version_id");
CREATE INDEX "sop_documents_deleted_at_idx" ON "sop_documents"("deleted_at");
CREATE INDEX "sop_documents_updated_at_idx" ON "sop_documents"("updated_at");

CREATE UNIQUE INDEX "sop_versions_document_id_version_key"
  ON "sop_versions"("document_id", "version");
CREATE UNIQUE INDEX "sop_versions_one_active_draft_per_document_idx"
  ON "sop_versions"("document_id")
  WHERE "deleted_at" IS NULL AND "status" = 'draft';
CREATE INDEX "sop_versions_document_id_status_deleted_at_idx"
  ON "sop_versions"("document_id", "status", "deleted_at");
CREATE INDEX "sop_versions_based_on_version_id_idx" ON "sop_versions"("based_on_version_id");
CREATE INDEX "sop_versions_published_at_idx" ON "sop_versions"("published_at");
CREATE INDEX "sop_versions_updated_at_idx" ON "sop_versions"("updated_at");

CREATE INDEX "sop_assets_document_id_deleted_at_idx" ON "sop_assets"("document_id", "deleted_at");
CREATE INDEX "sop_assets_object_key_idx" ON "sop_assets"("object_key");
CREATE INDEX "sop_assets_file_hash_idx" ON "sop_assets"("file_hash");
CREATE INDEX "sop_assets_deleted_at_idx" ON "sop_assets"("deleted_at");

CREATE UNIQUE INDEX "drawing_library_files_source_sop_version_id_key"
  ON "drawing_library_files"("source_sop_version_id");

ALTER TABLE "sop_documents"
  ADD CONSTRAINT "sop_documents_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sop_documents"
  ADD CONSTRAINT "sop_documents_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sop_documents"
  ADD CONSTRAINT "sop_documents_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sop_versions"
  ADD CONSTRAINT "sop_versions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "sop_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sop_versions"
  ADD CONSTRAINT "sop_versions_based_on_version_id_fkey"
  FOREIGN KEY ("based_on_version_id") REFERENCES "sop_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sop_versions"
  ADD CONSTRAINT "sop_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sop_versions"
  ADD CONSTRAINT "sop_versions_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sop_versions"
  ADD CONSTRAINT "sop_versions_published_by_id_fkey"
  FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sop_documents"
  ADD CONSTRAINT "sop_documents_current_published_version_id_fkey"
  FOREIGN KEY ("current_published_version_id") REFERENCES "sop_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sop_assets"
  ADD CONSTRAINT "sop_assets_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "sop_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sop_assets"
  ADD CONSTRAINT "sop_assets_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "drawing_library_files"
  ADD CONSTRAINT "drawing_library_files_source_sop_version_id_fkey"
  FOREIGN KEY ("source_sop_version_id") REFERENCES "sop_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
