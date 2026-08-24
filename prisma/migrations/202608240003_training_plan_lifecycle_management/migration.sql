-- Keep business completion/cancellation separate from records management.
-- Deletion stays reversible and records who performed it and why.
ALTER TABLE "training_plans"
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" TEXT,
  ADD COLUMN "archive_reason" TEXT,
  ADD COLUMN "deleted_by_id" TEXT,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "restored_at" TIMESTAMP(3),
  ADD COLUMN "restored_by_id" TEXT,
  ADD COLUMN "restore_reason" TEXT;

CREATE INDEX "training_plans_archived_at_status_deleted_at_idx"
  ON "training_plans"("archived_at", "status", "deleted_at");
