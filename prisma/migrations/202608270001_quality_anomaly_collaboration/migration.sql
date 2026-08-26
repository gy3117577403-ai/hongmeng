-- Expand the internal quality-risk archive into a collaboration workflow and
-- immutable worker-warning source. Evidence objects remain in S3; this schema
-- stores metadata and preserves soft-deleted records for audit and print replay.
ALTER TYPE "work_order_qr_print_mode" ADD VALUE IF NOT EXISTS 'TRAVELER_QUALITY_WARNING';
ALTER TYPE "work_order_qr_print_material" ADD VALUE IF NOT EXISTS 'QUALITY_WARNING';

ALTER TABLE "quality_risk_reports"
  ADD COLUMN "warning_state" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "warning_summary" TEXT,
  ADD COLUMN "required_action" TEXT,
  ADD COLUMN "inspection_method" TEXT,
  ADD COLUMN "inspection_frequency" TEXT,
  ADD COLUMN "acceptance_criteria" TEXT,
  ADD COLUMN "stop_conditions" TEXT,
  ADD COLUMN "escalation_contact" TEXT,
  ADD COLUMN "print_policy" TEXT NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN "warning_published_at" TIMESTAMP(3),
  ADD COLUMN "warning_revoked_at" TIMESTAMP(3),
  ADD COLUMN "warning_revoke_reason" TEXT;

ALTER TABLE "quality_risk_reports" DROP CONSTRAINT IF EXISTS "quality_risk_reports_status_check";
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'CONTAINMENT', 'COLLABORATING', 'VERIFYING', 'PENDING_CLOSE', 'REVISING', 'ARCHIVED'));
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_warning_state_check"
  CHECK ("warning_state" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'EXPIRED', 'REVOKED'));
ALTER TABLE "quality_risk_reports" ADD CONSTRAINT "quality_risk_reports_print_policy_check"
  CHECK ("print_policy" IN ('REQUIRED', 'OPTIONAL', 'SYSTEM_ONLY'));

ALTER TABLE "quality_risk_work_orders" DROP CONSTRAINT IF EXISTS "quality_risk_work_orders_source_check";
ALTER TABLE "quality_risk_work_orders" ADD CONSTRAINT "quality_risk_work_orders_source_check"
  CHECK ("source" IN ('DIRECT', 'PRODUCT_CONFIRMATION', 'PRODUCT_AUTO'));

ALTER TABLE "work_order_quality_alerts" DROP CONSTRAINT IF EXISTS "work_order_quality_alerts_source_check";
ALTER TABLE "work_order_quality_alerts" ADD CONSTRAINT "work_order_quality_alerts_source_check"
  CHECK ("source" IN ('DIRECT_ARCHIVE', 'PRODUCT_SUGGESTION_CONFIRMED', 'PRODUCT_AUTO_ARCHIVE'));

CREATE INDEX "quality_risk_reports_warning_state_updated_at_idx"
  ON "quality_risk_reports"("warning_state", "updated_at");

CREATE TABLE "quality_risk_tasks" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "task_type" TEXT NOT NULL DEFAULT 'COLLABORATION',
  "title" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "owner_name" TEXT,
  "requirement" TEXT,
  "result" TEXT,
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quality_risk_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risk_tasks_type_check" CHECK ("task_type" IN ('CONTAINMENT', 'CAUSE', 'ACTION', 'VERIFICATION', 'COLLABORATION')),
  CONSTRAINT "quality_risk_tasks_status_check" CHECK ("status" IN ('TODO', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'))
);

CREATE INDEX "quality_risk_tasks_report_id_status_due_at_idx" ON "quality_risk_tasks"("report_id", "status", "due_at");
CREATE INDEX "quality_risk_tasks_department_status_idx" ON "quality_risk_tasks"("department", "status");
ALTER TABLE "quality_risk_tasks" ADD CONSTRAINT "quality_risk_tasks_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "quality_risk_attachments" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "task_id" TEXT,
  "category" TEXT NOT NULL DEFAULT 'EVIDENCE',
  "original_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "object_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "caption" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "uploaded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "quality_risk_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_risk_attachments_category_check" CHECK ("category" IN ('DEFECT', 'CAUSE', 'ACTION', 'VERIFICATION', 'SOLUTION', 'EVIDENCE')),
  CONSTRAINT "quality_risk_attachments_file_size_check" CHECK ("file_size" >= 0)
);

CREATE INDEX "quality_risk_attachments_report_id_category_deleted_at_idx" ON "quality_risk_attachments"("report_id", "category", "deleted_at");
CREATE INDEX "quality_risk_attachments_task_id_deleted_at_idx" ON "quality_risk_attachments"("task_id", "deleted_at");
CREATE INDEX "quality_risk_attachments_uploaded_by_id_idx" ON "quality_risk_attachments"("uploaded_by_id");
CREATE INDEX "quality_risk_attachments_object_key_idx" ON "quality_risk_attachments"("object_key");
ALTER TABLE "quality_risk_attachments" ADD CONSTRAINT "quality_risk_attachments_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "quality_risk_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_attachments" ADD CONSTRAINT "quality_risk_attachments_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "quality_risk_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_risk_attachments" ADD CONSTRAINT "quality_risk_attachments_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A published warning keeps its own product scope and evidence membership.
-- Draft revisions may then change current report links without altering the
-- warning that workers and planners already received.
CREATE TABLE "quality_risk_revision_products" (
  "revision_id" TEXT NOT NULL,
  "drawing_library_item_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_revision_products_pkey" PRIMARY KEY ("revision_id", "drawing_library_item_id")
);
CREATE INDEX "quality_risk_revision_products_drawing_library_item_id_revision_id_idx"
  ON "quality_risk_revision_products"("drawing_library_item_id", "revision_id");
ALTER TABLE "quality_risk_revision_products" ADD CONSTRAINT "quality_risk_revision_products_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "quality_risk_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_revision_products" ADD CONSTRAINT "quality_risk_revision_products_drawing_library_item_id_fkey"
  FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "quality_risk_revision_attachments" (
  "revision_id" TEXT NOT NULL,
  "attachment_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_risk_revision_attachments_pkey" PRIMARY KEY ("revision_id", "attachment_id")
);
CREATE INDEX "quality_risk_revision_attachments_attachment_id_revision_id_idx"
  ON "quality_risk_revision_attachments"("attachment_id", "revision_id");
ALTER TABLE "quality_risk_revision_attachments" ADD CONSTRAINT "quality_risk_revision_attachments_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "quality_risk_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_risk_revision_attachments" ADD CONSTRAINT "quality_risk_revision_attachments_attachment_id_fkey"
  FOREIGN KEY ("attachment_id") REFERENCES "quality_risk_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the product scope of pre-existing archived revisions when this
-- migration is introduced on an existing database.
INSERT INTO "quality_risk_revision_products" ("revision_id", "drawing_library_item_id")
SELECT report."current_revision_id", product."drawing_library_item_id"
FROM "quality_risk_reports" report
JOIN "quality_risk_products" product ON product."report_id" = report."id"
WHERE report."current_revision_id" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "work_order_quality_alerts"
  ADD COLUMN "warning_summary" TEXT,
  ADD COLUMN "required_action" TEXT,
  ADD COLUMN "inspection_method" TEXT,
  ADD COLUMN "inspection_frequency" TEXT,
  ADD COLUMN "acceptance_criteria" TEXT,
  ADD COLUMN "stop_conditions" TEXT,
  ADD COLUMN "escalation_contact" TEXT,
  ADD COLUMN "print_policy" TEXT NOT NULL DEFAULT 'OPTIONAL';

ALTER TABLE "work_order_quality_alerts" ADD CONSTRAINT "work_order_quality_alerts_print_policy_check"
  CHECK ("print_policy" IN ('REQUIRED', 'OPTIONAL', 'SYSTEM_ONLY'));
CREATE INDEX "work_order_quality_alerts_work_order_id_print_policy_state_idx"
  ON "work_order_quality_alerts"("work_order_id", "print_policy", "state");

-- Existing archived reports are already published warnings. Preserve their
-- semantics while leaving drafts/revisions as unpublished warning drafts.
UPDATE "quality_risk_reports"
SET "warning_state" = 'ACTIVE',
    "warning_published_at" = COALESCE("archived_at", "updated_at"),
    "warning_summary" = COALESCE("final_conclusion", "defect_phenomenon"),
    "required_action" = COALESCE("corrective_action", "containment_action")
WHERE "status" = 'ARCHIVED' AND "deleted_at" IS NULL;

UPDATE "work_order_quality_alerts" alert
SET "warning_summary" = COALESCE(report."warning_summary", report."final_conclusion", report."defect_phenomenon"),
    "required_action" = COALESCE(report."required_action", report."corrective_action", report."containment_action"),
    "inspection_method" = report."inspection_method",
    "inspection_frequency" = report."inspection_frequency",
    "acceptance_criteria" = report."acceptance_criteria",
    "stop_conditions" = report."stop_conditions",
    "escalation_contact" = report."escalation_contact",
    "print_policy" = report."print_policy"
FROM "quality_risk_reports" report
WHERE alert."report_id" = report."id";
