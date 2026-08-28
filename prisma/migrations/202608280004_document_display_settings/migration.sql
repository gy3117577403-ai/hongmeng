CREATE TABLE "document_display_settings" (
    "id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "page_rotations" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_display_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_display_settings_page_count_check" CHECK ("page_count" BETWEEN 1 AND 2000),
    CONSTRAINT "document_display_settings_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "document_display_settings_object_key_key" ON "document_display_settings"("object_key");
