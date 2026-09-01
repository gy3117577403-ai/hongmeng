-- Backfill the pre-P0 sample submission state so already-submitted capture
-- records remain withdrawable/reviewable after the submission ledger is added.
-- The block is intentionally idempotent: integration tests can seed a legacy
-- row and execute it again without mutating modern submission revisions.
DO $sample_capture_legacy_backfill$
BEGIN
  INSERT INTO "sample_submissions" (
    "id",
    "task_id",
    "revision",
    "mutation_id",
    "request_hash",
    "status",
    "snapshot",
    "submitted_by_id",
    "submitted_by_name",
    "submitted_at",
    "created_at",
    "updated_at"
  )
  SELECT
    'legacy-sample-submission-' || task."id",
    task."id",
    1,
    'legacy-migration-' || task."id",
    'legacy-migration-' || task."id",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "sample_data_entries" entry
        WHERE entry."task_id" = task."id"
          AND entry."deleted_at" IS NULL
          AND entry."review_status" = 'PENDING'
      ) OR EXISTS (
        SELECT 1 FROM "sample_photos" photo
        WHERE photo."task_id" = task."id"
          AND photo."deleted_at" IS NULL
          AND photo."review_status" = 'PENDING'
      ) THEN 'PENDING'
      ELSE 'REVIEWED'
    END,
    jsonb_build_object(
      'schemaVersion', 0,
      'legacyMigration', true,
      'task', jsonb_build_object(
        'id', task."id",
        'code', task."code",
        'taskVersion', task."version",
        'submissionRevision', 1,
        'customerName', task."customer_name_snapshot",
        'productName', task."product_name_snapshot",
        'specification', task."specification_snapshot"
      ),
      'sections', '[]'::jsonb,
      'entries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', entry."id",
          'kind', entry."kind",
          'label', entry."label",
          'payload', entry."payload",
          'version', entry."version"
        ) ORDER BY entry."created_at", entry."id")
        FROM "sample_data_entries" entry
        WHERE entry."task_id" = task."id"
          AND entry."deleted_at" IS NULL
          AND entry."review_status" <> 'DRAFT'
      ), '[]'::jsonb),
      'photos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', photo."id",
          'category', photo."category",
          'caption', photo."caption",
          'originalName', photo."original_name",
          'mimeType', photo."mime_type",
          'size', photo."size",
          'sha256', photo."sha256",
          'version', photo."version"
        ) ORDER BY photo."created_at", photo."id")
        FROM "sample_photos" photo
        WHERE photo."task_id" = task."id"
          AND photo."deleted_at" IS NULL
          AND photo."review_status" <> 'DRAFT'
      ), '[]'::jsonb),
      'submittedAt', COALESCE(task."submitted_at", task."updated_at", task."created_at")
    ),
    task."updated_by_id",
    task."updated_by_name",
    COALESCE(task."submitted_at", task."updated_at", task."created_at", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "sample_tasks" task
  WHERE task."deleted_at" IS NULL
    AND task."status" NOT IN ('COMPLETED', 'CANCELLED')
    AND (
      task."status" = 'SUBMITTED'
      OR EXISTS (
        SELECT 1 FROM "sample_data_entries" entry
        WHERE entry."task_id" = task."id"
          AND entry."deleted_at" IS NULL
          AND entry."review_status" = 'PENDING'
      )
      OR EXISTS (
        SELECT 1 FROM "sample_photos" photo
        WHERE photo."task_id" = task."id"
          AND photo."deleted_at" IS NULL
          AND photo."review_status" = 'PENDING'
      )
    )
  ON CONFLICT ("task_id", "revision") DO NOTHING;

  UPDATE "sample_data_entries" entry
  SET "submission_revision" = 1
  FROM "sample_submissions" submission
  WHERE submission."task_id" = entry."task_id"
    AND submission."revision" = 1
    AND submission."mutation_id" = 'legacy-migration-' || submission."task_id"
    AND entry."deleted_at" IS NULL
    AND entry."review_status" <> 'DRAFT'
    AND entry."submission_revision" IS NULL;

  UPDATE "sample_photos" photo
  SET "submission_revision" = 1
  FROM "sample_submissions" submission
  WHERE submission."task_id" = photo."task_id"
    AND submission."revision" = 1
    AND submission."mutation_id" = 'legacy-migration-' || submission."task_id"
    AND photo."deleted_at" IS NULL
    AND photo."review_status" <> 'DRAFT'
    AND photo."submission_revision" IS NULL;

  UPDATE "sample_tasks" task
  SET
    "submission_revision" = GREATEST(task."submission_revision", 1),
    "active_submission_id" = CASE WHEN submission."status" = 'PENDING' THEN submission."id" ELSE NULL END,
    "status" = CASE
      WHEN submission."status" = 'PENDING' THEN 'SUBMITTED'
      WHEN task."status" = 'SUBMITTED' THEN 'IN_PROGRESS'
      ELSE task."status"
    END,
    "submitted_at" = CASE WHEN submission."status" = 'PENDING' THEN submission."submitted_at" ELSE NULL END
  FROM "sample_submissions" submission
  WHERE submission."task_id" = task."id"
    AND submission."revision" = 1
    AND submission."mutation_id" = 'legacy-migration-' || submission."task_id";
END
$sample_capture_legacy_backfill$;
