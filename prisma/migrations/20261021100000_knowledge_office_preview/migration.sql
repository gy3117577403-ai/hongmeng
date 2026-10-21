CREATE TABLE "knowledge_attachment_previews" (
  "attachment_id" TEXT NOT NULL PRIMARY KEY,
  "source_object_key" TEXT NOT NULL,
  "renderer_version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "table_status" TEXT NOT NULL DEFAULT 'pending',
  "pdf_status" TEXT NOT NULL DEFAULT 'pending',
  "sheets" JSONB NOT NULL DEFAULT '[]',
  "pdf_key" TEXT,
  "table_error" TEXT,
  "pdf_error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_token" TEXT,
  "lease_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_preview_attachment_fkey" FOREIGN KEY ("attachment_id") REFERENCES "knowledge_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "knowledge_attachment_previews_status_updated_at_idx" ON "knowledge_attachment_previews"("status", "updated_at");
