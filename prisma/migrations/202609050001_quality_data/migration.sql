ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'QUALITY_DATA_OPERATOR';

CREATE TABLE "quality_data_records" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE,
  "work_order_id" TEXT NOT NULL REFERENCES "work_orders"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL, "title" TEXT NOT NULL, "inspected_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "result" TEXT NOT NULL DEFAULT 'PENDING',
  "review_status" TEXT NOT NULL DEFAULT 'UNREVIEWED',
  "data" JSONB NOT NULL, "order_snapshot" JSONB NOT NULL, "search_text" TEXT NOT NULL,
  "template_version" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT NOT NULL, "created_by_name" TEXT NOT NULL, "updated_by_id" TEXT NOT NULL,
  "source_qr_code" TEXT, "supersedes_id" TEXT REFERENCES "quality_data_records"("id") ON DELETE RESTRICT,
  "idempotency_key" TEXT NOT NULL, "request_hash" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3), "reviewed_at" TIMESTAMP(3), "reviewed_by_name" TEXT, "review_note" TEXT,
  "deleted_at" TIMESTAMP(3), "delete_reason" TEXT, "deleted_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_data_records_status_check" CHECK ("status" IN ('DRAFT','SUBMITTED')),
  CONSTRAINT "quality_data_records_result_check" CHECK ("result" IN ('PENDING','PASS','FAIL')),
  CONSTRAINT "quality_data_records_review_check" CHECK ("review_status" IN ('UNREVIEWED','APPROVED','RETURNED')),
  CONSTRAINT "quality_data_records_type_check" CHECK ("type" IN ('CRIMP','PULL','FINAL','FIRST','PATROL')),
  UNIQUE ("created_by_id","idempotency_key")
);
CREATE INDEX "quality_data_date_idx" ON "quality_data_records"("deleted_at","inspected_at");
CREATE INDEX "quality_data_order_idx" ON "quality_data_records"("work_order_id","deleted_at","inspected_at");
CREATE INDEX "quality_data_type_idx" ON "quality_data_records"("type","deleted_at","inspected_at");
CREATE INDEX "quality_data_created_idx" ON "quality_data_records"("created_at");

CREATE TABLE "quality_data_attachments" (
  "id" TEXT PRIMARY KEY, "record_id" TEXT NOT NULL REFERENCES "quality_data_records"("id") ON DELETE RESTRICT,
  "original_name" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "object_key" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL, "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deleted_at" TIMESTAMP(3),
  UNIQUE("record_id","sha256","original_name")
);
CREATE INDEX "quality_data_attachment_record_idx" ON "quality_data_attachments"("record_id","deleted_at");

CREATE TABLE "quality_data_revisions" (
  "id" TEXT PRIMARY KEY, "record_id" TEXT NOT NULL REFERENCES "quality_data_records"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL, "action" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL, "actor_name" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("record_id","version")
);
