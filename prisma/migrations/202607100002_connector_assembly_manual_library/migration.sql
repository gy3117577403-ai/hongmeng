-- CreateTable
CREATE TABLE "connector_assembly_manuals" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "manufacturer" TEXT,
    "family" TEXT,
    "document_no" TEXT,
    "summary" TEXT,
    "keywords" TEXT,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_assembly_manual_versions" (
    "id" TEXT NOT NULL,
    "manual_id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3),
    "page_count" INTEGER,
    "file_mode" TEXT NOT NULL,
    "is_latest" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "toc_json" JSONB,
    "search_text" TEXT,
    "remark" TEXT,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manual_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_assembly_manual_assets" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "display_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "page_no" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manual_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_assembly_manual_bindings" (
    "id" TEXT NOT NULL,
    "manual_id" TEXT NOT NULL,
    "connector_parameter_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_assembly_manual_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_assembly_manuals_title_idx" ON "connector_assembly_manuals"("title");
CREATE INDEX "connector_assembly_manuals_manufacturer_idx" ON "connector_assembly_manuals"("manufacturer");
CREATE INDEX "connector_assembly_manuals_family_idx" ON "connector_assembly_manuals"("family");
CREATE INDEX "connector_assembly_manuals_document_no_idx" ON "connector_assembly_manuals"("document_no");
CREATE INDEX "connector_assembly_manuals_deleted_at_idx" ON "connector_assembly_manuals"("deleted_at");
CREATE INDEX "connector_assembly_manuals_updated_at_idx" ON "connector_assembly_manuals"("updated_at");
CREATE UNIQUE INDEX "connector_assembly_manual_versions_manual_id_revision_key" ON "connector_assembly_manual_versions"("manual_id", "revision");
CREATE INDEX "connector_assembly_manual_versions_manual_id_deleted_at_idx" ON "connector_assembly_manual_versions"("manual_id", "deleted_at");
CREATE INDEX "connector_assembly_manual_versions_is_latest_idx" ON "connector_assembly_manual_versions"("is_latest");
CREATE INDEX "connector_assembly_manual_versions_issued_at_idx" ON "connector_assembly_manual_versions"("issued_at");
CREATE INDEX "connector_assembly_manual_versions_deleted_at_idx" ON "connector_assembly_manual_versions"("deleted_at");
CREATE INDEX "connector_assembly_manual_assets_version_id_deleted_at_idx" ON "connector_assembly_manual_assets"("version_id", "deleted_at");
CREATE INDEX "connector_assembly_manual_assets_sort_order_idx" ON "connector_assembly_manual_assets"("sort_order");
CREATE INDEX "connector_assembly_manual_assets_object_key_idx" ON "connector_assembly_manual_assets"("object_key");
CREATE INDEX "connector_assembly_manual_assets_deleted_at_idx" ON "connector_assembly_manual_assets"("deleted_at");
CREATE UNIQUE INDEX "connector_assembly_manual_bindings_manual_id_connector_parameter_id_key" ON "connector_assembly_manual_bindings"("manual_id", "connector_parameter_id");
CREATE INDEX "connector_assembly_manual_bindings_manual_id_idx" ON "connector_assembly_manual_bindings"("manual_id");
CREATE INDEX "connector_assembly_manual_bindings_connector_parameter_id_idx" ON "connector_assembly_manual_bindings"("connector_parameter_id");

-- AddForeignKey
ALTER TABLE "connector_assembly_manual_versions" ADD CONSTRAINT "connector_assembly_manual_versions_manual_id_fkey" FOREIGN KEY ("manual_id") REFERENCES "connector_assembly_manuals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_assembly_manual_assets" ADD CONSTRAINT "connector_assembly_manual_assets_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "connector_assembly_manual_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_assembly_manual_bindings" ADD CONSTRAINT "connector_assembly_manual_bindings_manual_id_fkey" FOREIGN KEY ("manual_id") REFERENCES "connector_assembly_manuals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_assembly_manual_bindings" ADD CONSTRAINT "connector_assembly_manual_bindings_connector_parameter_id_fkey" FOREIGN KEY ("connector_parameter_id") REFERENCES "connector_parameters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
