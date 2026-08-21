ALTER TABLE "issues"
  ADD COLUMN "requester_confirmed_by_id" TEXT,
  ADD COLUMN "requester_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "requester_confirmation_note" TEXT;

CREATE INDEX "issues_requester_confirmed_by_id_idx"
  ON "issues"("requester_confirmed_by_id");

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_requester_confirmed_by_id_fkey"
  FOREIGN KEY ("requester_confirmed_by_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "issue_attachments"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "issue_attachments_issue_id_category_created_at_idx"
  ON "issue_attachments"("issue_id", "category", "created_at");

ALTER TABLE "issues"
  DROP CONSTRAINT IF EXISTS "issues_status_check";

ALTER TABLE "issues"
  ADD CONSTRAINT "issues_status_check"
  CHECK ("status" IN ('pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'));

ALTER TABLE "issue_attachments"
  ADD CONSTRAINT "issue_attachments_category_check"
  CHECK ("category" IN ('site_original', 'root_cause', 'processing', 'verification', 'archive', 'other')),
  ADD CONSTRAINT "issue_attachments_stage_check"
  CHECK ("stage" IN ('pending', 'processing', 'verifying', 'awaiting_confirmation', 'closed'));
