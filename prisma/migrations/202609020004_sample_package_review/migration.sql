-- Sample review is decided once per submitted product package.  Item review
-- columns remain as publication projections for backward compatibility, while
-- SampleSubmission becomes the authoritative review ledger.

ALTER TABLE "sample_tasks"
  ADD COLUMN "accepted_submission_id" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" TEXT,
  ADD COLUMN "archived_by_name" TEXT,
  ADD COLUMN "archive_reason" TEXT;

ALTER TABLE "sample_submissions"
  ADD COLUMN "content_hash" TEXT,
  ADD COLUMN "decision" TEXT,
  ADD COLUMN "decision_mutation_id" TEXT,
  ADD COLUMN "decision_request_hash" TEXT,
  ADD COLUMN "decision_comment" TEXT,
  ADD COLUMN "review_patch" JSONB,
  ADD COLUMN "reviewed_snapshot" JSONB,
  ADD COLUMN "decided_by_id" TEXT,
  ADD COLUMN "decided_by_name" TEXT,
  ADD COLUMN "decided_at" TIMESTAMP(3);

ALTER TABLE "sample_photos"
  ADD COLUMN "duplicate_of_id" TEXT;

CREATE UNIQUE INDEX "sample_tasks_accepted_submission_id_key"
  ON "sample_tasks"("accepted_submission_id");
CREATE UNIQUE INDEX "sample_submissions_task_id_decision_mutation_id_key"
  ON "sample_submissions"("task_id", "decision_mutation_id");
CREATE INDEX "sample_submissions_task_id_content_hash_idx"
  ON "sample_submissions"("task_id", "content_hash");
CREATE INDEX "sample_data_entries_task_id_request_hash_idx"
  ON "sample_data_entries"("task_id", "request_hash");
CREATE INDEX "sample_photos_task_id_sha256_idx"
  ON "sample_photos"("task_id", "sha256");
CREATE INDEX "sample_photos_duplicate_of_id_idx"
  ON "sample_photos"("duplicate_of_id");

ALTER TABLE "sample_tasks"
  ADD CONSTRAINT "sample_tasks_accepted_submission_id_fkey"
  FOREIGN KEY ("accepted_submission_id") REFERENCES "sample_submissions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Reclassify legacy submission states without rewriting the immutable snapshot.
UPDATE "sample_submissions"
SET
  "content_hash" = COALESCE("content_hash", md5("snapshot"::text)),
  "status" = CASE
    WHEN "status" = 'CHANGES_REQUESTED' THEN 'REJECTED'
    ELSE "status"
  END,
  "decision" = CASE
    WHEN "status" = 'CHANGES_REQUESTED' THEN 'REJECT'
    ELSE "decision"
  END,
  "decided_at" = CASE
    WHEN "status" = 'CHANGES_REQUESTED' THEN COALESCE("decided_at", "updated_at")
    ELSE "decided_at"
  END;

-- Closed legacy tasks did not always have a submission ledger.  Create one so
-- read-only history and package-level audit remain complete after migration.
INSERT INTO "sample_submissions" (
  "id", "task_id", "revision", "mutation_id", "request_hash", "content_hash",
  "status", "snapshot", "decision", "decision_mutation_id",
  "decision_request_hash", "decision_comment", "reviewed_snapshot",
  "decided_by_id", "decided_by_name", "decided_at",
  "submitted_by_id", "submitted_by_name", "submitted_at", "created_at", "updated_at"
)
SELECT
  'legacy-closed-submission-' || task."id",
  task."id",
  GREATEST(task."submission_revision", 1),
  'legacy-closed-migration-' || task."id",
  'legacy-closed-migration-' || task."id",
  md5(task."id" || ':' || task."status" || ':' || COALESCE(task."updated_at"::text, '')),
  CASE WHEN task."status" = 'COMPLETED' THEN 'CONFIRMED' ELSE 'CANCELLED' END,
  jsonb_build_object(
    'schemaVersion', 0,
    'legacyMigration', true,
    'task', jsonb_build_object(
      'id', task."id",
      'code', task."code",
      'taskVersion', task."version",
      'submissionRevision', GREATEST(task."submission_revision", 1),
      'customerName', task."customer_name_snapshot",
      'productName', task."product_name_snapshot",
      'specification', task."specification_snapshot"
    ),
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', entry."id", 'kind', entry."kind", 'label', entry."label",
        'payload', entry."payload", 'version', entry."version"
      ) ORDER BY entry."created_at", entry."id")
      FROM "sample_data_entries" entry
      WHERE entry."task_id" = task."id" AND entry."deleted_at" IS NULL
    ), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', photo."id", 'category', photo."category", 'caption', photo."caption",
        'originalName', photo."original_name", 'mimeType', photo."mime_type",
        'size', photo."size", 'sha256', photo."sha256", 'version', photo."version"
      ) ORDER BY photo."created_at", photo."id")
      FROM "sample_photos" photo
      WHERE photo."task_id" = task."id" AND photo."deleted_at" IS NULL
    ), '[]'::jsonb)
  ),
  CASE WHEN task."status" = 'COMPLETED' THEN 'CONFIRM' ELSE 'CANCEL' END,
  'legacy-closed-decision-' || task."id",
  'legacy-closed-decision-' || task."id",
  CASE WHEN task."status" = 'COMPLETED' THEN '历史完成任务迁移' ELSE '历史取消任务迁移' END,
  jsonb_build_object('legacyMigration', true),
  task."updated_by_id",
  task."updated_by_name",
  COALESCE(task."completed_at", task."cancelled_at", task."updated_at", CURRENT_TIMESTAMP),
  task."updated_by_id",
  task."updated_by_name",
  COALESCE(task."submitted_at", task."started_at", task."created_at", CURRENT_TIMESTAMP),
  task."created_at",
  task."updated_at"
FROM "sample_tasks" task
WHERE task."deleted_at" IS NULL
  AND task."status" IN ('COMPLETED', 'CANCELLED')
  AND NOT EXISTS (
    SELECT 1 FROM "sample_submissions" submission WHERE submission."task_id" = task."id"
  )
ON CONFLICT ("task_id", "revision") DO NOTHING;

-- The latest ledger of a closed task is authoritative for historical status.
WITH latest AS (
  SELECT DISTINCT ON (submission."task_id")
    submission."id", submission."task_id", task."status" AS task_status,
    task."completed_at", task."cancelled_at", task."updated_at",
    task."updated_by_id", task."updated_by_name"
  FROM "sample_submissions" submission
  JOIN "sample_tasks" task ON task."id" = submission."task_id"
  WHERE task."deleted_at" IS NULL AND task."status" IN ('COMPLETED', 'CANCELLED')
  ORDER BY submission."task_id", submission."revision" DESC, submission."submitted_at" DESC
)
UPDATE "sample_submissions" submission
SET
  "status" = CASE WHEN latest.task_status = 'COMPLETED' THEN 'CONFIRMED' ELSE 'CANCELLED' END,
  "decision" = CASE WHEN latest.task_status = 'COMPLETED' THEN 'CONFIRM' ELSE 'CANCEL' END,
  "decision_mutation_id" = COALESCE(submission."decision_mutation_id", 'legacy-closed-decision-' || submission."task_id"),
  "decision_request_hash" = COALESCE(submission."decision_request_hash", 'legacy-closed-decision-' || submission."task_id"),
  "decision_comment" = COALESCE(submission."decision_comment", CASE WHEN latest.task_status = 'COMPLETED' THEN '历史完成任务迁移' ELSE '历史取消任务迁移' END),
  "reviewed_snapshot" = COALESCE(submission."reviewed_snapshot", submission."snapshot"),
  "decided_by_id" = COALESCE(submission."decided_by_id", latest.updated_by_id),
  "decided_by_name" = COALESCE(submission."decided_by_name", latest.updated_by_name),
  "decided_at" = COALESCE(submission."decided_at", latest.completed_at, latest.cancelled_at, latest.updated_at, CURRENT_TIMESTAMP)
FROM latest
WHERE submission."id" = latest."id";

WITH latest AS (
  SELECT DISTINCT ON (submission."task_id") submission."id", submission."task_id"
  FROM "sample_submissions" submission
  JOIN "sample_tasks" task ON task."id" = submission."task_id"
  WHERE task."deleted_at" IS NULL AND task."status" IN ('COMPLETED', 'CANCELLED')
  ORDER BY submission."task_id", submission."revision" DESC, submission."submitted_at" DESC
)
UPDATE "sample_tasks" task
SET
  "accepted_submission_id" = CASE WHEN task."status" = 'COMPLETED' THEN latest."id" ELSE NULL END,
  "active_submission_id" = NULL,
  "submitted_at" = NULL,
  "archived_at" = CASE
    WHEN task."status" = 'COMPLETED' THEN COALESCE(task."completed_at", task."updated_at", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  "archived_by_id" = CASE WHEN task."status" = 'COMPLETED' THEN task."updated_by_id" ELSE NULL END,
  "archived_by_name" = CASE WHEN task."status" = 'COMPLETED' THEN task."updated_by_name" ELSE NULL END,
  "archive_reason" = CASE WHEN task."status" = 'COMPLETED' THEN '历史完成任务迁移' ELSE NULL END
FROM latest
WHERE task."id" = latest."task_id";

-- Keep one visible copy of identical photo content per task.  Duplicates remain
-- in object storage and are only soft-deleted in metadata for audit/recovery.
WITH ranked AS (
  SELECT
    photo."id",
    first_value(photo."id") OVER (
      PARTITION BY photo."task_id", photo."sha256"
      ORDER BY
        CASE WHEN photo."published_file_id" IS NOT NULL OR photo."review_status" = 'PUBLISHED' THEN 0 ELSE 1 END,
        photo."created_at",
        photo."id"
    ) AS keeper_id,
    row_number() OVER (
      PARTITION BY photo."task_id", photo."sha256"
      ORDER BY
        CASE WHEN photo."published_file_id" IS NOT NULL OR photo."review_status" = 'PUBLISHED' THEN 0 ELSE 1 END,
        photo."created_at",
        photo."id"
    ) AS duplicate_rank
  FROM "sample_photos" photo
  WHERE photo."deleted_at" IS NULL
)
UPDATE "sample_photos" photo
SET
  "duplicate_of_id" = ranked.keeper_id,
  "deleted_at" = CURRENT_TIMESTAMP,
  "deleted_by_name" = COALESCE(photo."deleted_by_name", '系统迁移'),
  "delete_reason" = COALESCE(photo."delete_reason", '相同图片内容重复上传，迁移时已隐藏')
FROM ranked
WHERE photo."id" = ranked."id" AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "sample_photos_task_id_sha256_active_key"
  ON "sample_photos"("task_id", "sha256")
  WHERE "deleted_at" IS NULL;
