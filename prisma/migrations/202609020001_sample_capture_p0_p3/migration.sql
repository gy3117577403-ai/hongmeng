-- Sample capture P0-P3: durable section drafts, immutable submission snapshots,
-- explicit withdrawal, and auditable photo ordering/deletion metadata.

ALTER TABLE "sample_tasks"
  ADD COLUMN "submission_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active_submission_id" TEXT,
  ADD COLUMN "last_edited_kind" TEXT,
  ADD COLUMN "last_edited_row_id" TEXT;

ALTER TABLE "sample_data_entries"
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "draft_section_kind" TEXT,
  ADD COLUMN "draft_row_id" TEXT,
  ADD COLUMN "submission_revision" INTEGER;

ALTER TABLE "sample_photos"
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "source_original_name" TEXT,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submission_revision" INTEGER,
  ADD COLUMN "deleted_by_id" TEXT,
  ADD COLUMN "deleted_by_name" TEXT,
  ADD COLUMN "delete_reason" TEXT;

CREATE TABLE "sample_draft_sections" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "last_submitted_revision" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "ui_state" JSONB,
  "last_mutation_id" TEXT,
  "last_request_hash" TEXT,
  "updated_by_id" TEXT,
  "updated_by_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sample_draft_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_draft_sections_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "sample_submissions" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "snapshot" JSONB NOT NULL,
  "submitted_by_id" TEXT,
  "submitted_by_name" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_by_id" TEXT,
  "withdrawn_by_name" TEXT,
  "withdrawn_at" TIMESTAMP(3),
  "withdrawal_reason" TEXT,
  "withdrawal_mutation_id" TEXT,
  "withdrawal_request_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sample_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sample_submissions_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sample_tasks_active_submission_id_key"
  ON "sample_tasks"("active_submission_id");
CREATE UNIQUE INDEX "sample_draft_sections_task_id_kind_key"
  ON "sample_draft_sections"("task_id", "kind");
CREATE INDEX "sample_draft_sections_task_id_updated_at_idx"
  ON "sample_draft_sections"("task_id", "updated_at");
CREATE UNIQUE INDEX "sample_submissions_task_id_revision_key"
  ON "sample_submissions"("task_id", "revision");
CREATE UNIQUE INDEX "sample_submissions_task_id_mutation_id_key"
  ON "sample_submissions"("task_id", "mutation_id");
CREATE UNIQUE INDEX "sample_submissions_task_id_withdrawal_mutation_id_key"
  ON "sample_submissions"("task_id", "withdrawal_mutation_id");
CREATE INDEX "sample_submissions_task_id_status_submitted_at_idx"
  ON "sample_submissions"("task_id", "status", "submitted_at");
CREATE UNIQUE INDEX "sample_entries_draft_row_submission_key"
  ON "sample_data_entries"("task_id", "draft_section_kind", "draft_row_id", "submission_revision");

ALTER TABLE "sample_tasks"
  ADD CONSTRAINT "sample_tasks_active_submission_id_fkey"
  FOREIGN KEY ("active_submission_id") REFERENCES "sample_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
