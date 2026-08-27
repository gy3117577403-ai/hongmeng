-- Retain file metadata in the existing soft-delete store when its training
-- business parent is permanently deleted. No object-storage data is erased.
ALTER TABLE "training_attachments"
  ADD COLUMN "deleted_by_id" TEXT,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "source_snapshot" JSONB;

ALTER TABLE "training_attachments" DROP CONSTRAINT "training_attachments_parent_check";
ALTER TABLE "training_attachments" ADD CONSTRAINT "training_attachments_parent_check" CHECK (
  num_nonnulls("course_id", "plan_id", "session_id", "participant_id") = 1
  OR (
    num_nonnulls("course_id", "plan_id", "session_id", "participant_id") = 0
    AND "deleted_at" IS NOT NULL
    AND "source_snapshot" IS NOT NULL
    AND jsonb_typeof("source_snapshot") = 'object'
    AND "source_snapshot" ? 'planId'
  )
);
