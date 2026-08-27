ALTER TABLE "quality_risk_reports" ADD COLUMN "owner_user_id" TEXT,
  ADD COLUMN "print_photo_layout" TEXT NOT NULL DEFAULT 'PAIR',
  ADD COLUMN "verified_by_id" TEXT, ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_tasks" ADD COLUMN "owner_user_id" TEXT,
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "review_note" TEXT, ADD COLUMN "verified_by_id" TEXT;
ALTER TABLE "quality_risk_tasks" ADD CONSTRAINT "quality_risk_tasks_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "quality_risk_tasks_owner_user_id_status_idx" ON "quality_risk_tasks"("owner_user_id", "status");
ALTER TABLE "quality_risk_attachments" ADD COLUMN "print_included" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "quality_risk_revisions" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;
UPDATE "quality_risk_revisions" r SET "published" = true
 WHERE EXISTS (SELECT 1 FROM "work_order_quality_alerts" a WHERE a."revision_id" = r."id")
 OR EXISTS (SELECT 1 FROM "quality_risk_reports" q WHERE q."current_revision_id" = r."id" AND q."warning_published_at" IS NOT NULL);
CREATE TABLE "quality_warning_employee_links" (
  "id" TEXT NOT NULL, "token_hash" TEXT NOT NULL, "scope_key" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL, "work_order_id" TEXT, "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_warning_employee_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_warning_employee_links_revision_id_fkey" FOREIGN KEY ("revision_id")
    REFERENCES "quality_risk_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "quality_warning_employee_links_token_hash_key" ON "quality_warning_employee_links"("token_hash");
CREATE UNIQUE INDEX "quality_warning_employee_links_scope_key_key" ON "quality_warning_employee_links"("scope_key");
CREATE INDEX "quality_warning_employee_links_revision_id_idx" ON "quality_warning_employee_links"("revision_id");
CREATE TABLE "quality_risk_object_cleanup" (
  "id" TEXT NOT NULL, "object_key" TEXT NOT NULL, "report_id" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_object_cleanup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quality_risk_object_cleanup_object_key_key" ON "quality_risk_object_cleanup"("object_key");
