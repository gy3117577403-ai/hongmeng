ALTER TABLE "drawing_library_files"
  ADD COLUMN "source_pdf_overlay_version_id" TEXT,
  ADD COLUMN "supersedes_file_id" TEXT,
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "pdf_overlay_documents" (
  "id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "base_file_id" TEXT NOT NULL,
  "current_file_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "current_published_version_id" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pdf_overlay_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pdf_overlay_versions" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "source_file_id" TEXT NOT NULL,
  "source_sha256" TEXT NOT NULL,
  "source_page_count" INTEGER NOT NULL,
  "source_size" INTEGER NOT NULL,
  "source_updated_at" TIMESTAMP(3) NOT NULL,
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

  CONSTRAINT "pdf_overlay_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdf_overlay_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "pdf_overlay_versions_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "pdf_overlay_versions_schema_check" CHECK ("content_schema_version" > 0),
  CONSTRAINT "pdf_overlay_versions_source_page_count_check" CHECK ("source_page_count" > 0),
  CONSTRAINT "pdf_overlay_versions_source_size_check" CHECK ("source_size" > 0),
  CONSTRAINT "pdf_overlay_versions_status_check" CHECK ("status" IN ('draft', 'published'))
);

CREATE TABLE "pdf_overlay_assets" (
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

  CONSTRAINT "pdf_overlay_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pdf_overlay_assets_size_check" CHECK ("size" >= 0)
);

CREATE UNIQUE INDEX "pdf_overlay_documents_base_file_id_key" ON "pdf_overlay_documents"("base_file_id");
CREATE UNIQUE INDEX "pdf_overlay_documents_current_file_id_key" ON "pdf_overlay_documents"("current_file_id");
CREATE UNIQUE INDEX "pdf_overlay_documents_current_published_version_id_key" ON "pdf_overlay_documents"("current_published_version_id");
CREATE INDEX "pdf_overlay_documents_drawing_library_item_id_deleted_at_idx" ON "pdf_overlay_documents"("drawing_library_item_id", "deleted_at");
CREATE INDEX "pdf_overlay_documents_updated_at_idx" ON "pdf_overlay_documents"("updated_at");

CREATE UNIQUE INDEX "pdf_overlay_versions_document_id_version_key" ON "pdf_overlay_versions"("document_id", "version");
CREATE UNIQUE INDEX "pdf_overlay_versions_one_active_draft_per_document_idx"
  ON "pdf_overlay_versions"("document_id")
  WHERE "deleted_at" IS NULL AND "status" = 'draft';
CREATE INDEX "pdf_overlay_versions_document_id_status_deleted_at_idx" ON "pdf_overlay_versions"("document_id", "status", "deleted_at");
CREATE INDEX "pdf_overlay_versions_source_file_id_idx" ON "pdf_overlay_versions"("source_file_id");
CREATE INDEX "pdf_overlay_versions_based_on_version_id_idx" ON "pdf_overlay_versions"("based_on_version_id");
CREATE INDEX "pdf_overlay_versions_published_at_idx" ON "pdf_overlay_versions"("published_at");
CREATE INDEX "pdf_overlay_versions_updated_at_idx" ON "pdf_overlay_versions"("updated_at");

CREATE INDEX "pdf_overlay_assets_document_id_deleted_at_idx" ON "pdf_overlay_assets"("document_id", "deleted_at");
CREATE INDEX "pdf_overlay_assets_object_key_idx" ON "pdf_overlay_assets"("object_key");
CREATE INDEX "pdf_overlay_assets_file_hash_idx" ON "pdf_overlay_assets"("file_hash");
CREATE INDEX "pdf_overlay_assets_deleted_at_idx" ON "pdf_overlay_assets"("deleted_at");

CREATE UNIQUE INDEX "drawing_library_files_source_pdf_overlay_version_id_key" ON "drawing_library_files"("source_pdf_overlay_version_id");
CREATE UNIQUE INDEX "drawing_library_files_supersedes_file_id_key" ON "drawing_library_files"("supersedes_file_id");
CREATE INDEX "drawing_library_files_library_item_id_category_id_is_current_deleted_at_idx"
  ON "drawing_library_files"("library_item_id", "category_id", "is_current", "deleted_at");

ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_base_file_id_fkey"
  FOREIGN KEY ("base_file_id") REFERENCES "drawing_library_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_current_file_id_fkey"
  FOREIGN KEY ("current_file_id") REFERENCES "drawing_library_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "pdf_overlay_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_source_file_id_fkey"
  FOREIGN KEY ("source_file_id") REFERENCES "drawing_library_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_based_on_version_id_fkey"
  FOREIGN KEY ("based_on_version_id") REFERENCES "pdf_overlay_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_versions"
  ADD CONSTRAINT "pdf_overlay_versions_published_by_id_fkey"
  FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pdf_overlay_documents"
  ADD CONSTRAINT "pdf_overlay_documents_current_published_version_id_fkey"
  FOREIGN KEY ("current_published_version_id") REFERENCES "pdf_overlay_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pdf_overlay_assets"
  ADD CONSTRAINT "pdf_overlay_assets_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "pdf_overlay_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pdf_overlay_assets"
  ADD CONSTRAINT "pdf_overlay_assets_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "drawing_library_files"
  ADD CONSTRAINT "drawing_library_files_source_pdf_overlay_version_id_fkey"
  FOREIGN KEY ("source_pdf_overlay_version_id") REFERENCES "pdf_overlay_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drawing_library_files"
  ADD CONSTRAINT "drawing_library_files_supersedes_file_id_fkey"
  FOREIGN KEY ("supersedes_file_id") REFERENCES "drawing_library_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
