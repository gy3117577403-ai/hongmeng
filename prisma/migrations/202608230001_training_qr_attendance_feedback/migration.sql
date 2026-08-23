ALTER TABLE "training_sessions"
  ADD COLUMN "check_in_open_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "late_after_minutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "check_in_close_minutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "feedback_deadline_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "feedback_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "training_sessions"
  ADD CONSTRAINT "training_sessions_check_in_window_check"
    CHECK (
      "check_in_open_minutes" >= 0
      AND "check_in_open_minutes" <= 1440
      AND "late_after_minutes" >= 0
      AND "check_in_close_minutes" >= "late_after_minutes"
      AND "check_in_close_minutes" <= 1440
    ),
  ADD CONSTRAINT "training_sessions_feedback_deadline_check"
    CHECK ("feedback_deadline_hours" >= 1 AND "feedback_deadline_hours" <= 720);

CREATE TABLE "training_qr_windows" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "token_hash" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "opens_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "opened_by_id" TEXT NOT NULL,
  "closed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_qr_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_qr_windows_purpose_check" CHECK ("purpose" IN ('CHECK_IN', 'FEEDBACK')),
  CONSTRAINT "training_qr_windows_status_check" CHECK ("status" IN ('SCHEDULED', 'OPEN', 'CLOSED', 'REVOKED')),
  CONSTRAINT "training_qr_windows_generation_check" CHECK ("generation" >= 1),
  CONSTRAINT "training_qr_windows_time_check" CHECK ("expires_at" > "opens_at")
);

CREATE TABLE "training_session_attendances" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "participant_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "check_in_at" TIMESTAMP(3),
  "check_out_at" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'SYSTEM_INVITE',
  "qr_window_id" TEXT,
  "corrected_at" TIMESTAMP(3),
  "corrected_by_id" TEXT,
  "correction_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_session_attendances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_session_attendances_status_check" CHECK ("status" IN ('INVITED', 'PRESENT', 'LATE', 'ABSENT', 'LEAVE')),
  CONSTRAINT "training_session_attendances_source_check" CHECK ("source" IN ('SYSTEM_INVITE', 'SYSTEM_FINALIZE', 'QR_SELF', 'ADMIN_MANUAL', 'LEGACY_MIGRATION')),
  CONSTRAINT "training_session_attendances_version_check" CHECK ("version" >= 1),
  CONSTRAINT "training_session_attendances_check_out_check" CHECK ("check_out_at" IS NULL OR "check_in_at" IS NULL OR "check_out_at" >= "check_in_at")
);

CREATE TABLE "training_feedbacks" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "participant_id" TEXT NOT NULL,
  "overall_rating" INTEGER NOT NULL,
  "content_rating" INTEGER NOT NULL,
  "trainer_rating" INTEGER NOT NULL,
  "practical_value_rating" INTEGER NOT NULL,
  "issue_tags" JSONB NOT NULL,
  "comment" TEXT,
  "follow_up_requested" BOOLEAN NOT NULL DEFAULT false,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_feedbacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_feedbacks_overall_rating_check" CHECK ("overall_rating" BETWEEN 1 AND 5),
  CONSTRAINT "training_feedbacks_content_rating_check" CHECK ("content_rating" BETWEEN 1 AND 5),
  CONSTRAINT "training_feedbacks_trainer_rating_check" CHECK ("trainer_rating" BETWEEN 1 AND 5),
  CONSTRAINT "training_feedbacks_practical_value_rating_check" CHECK ("practical_value_rating" BETWEEN 1 AND 5),
  CONSTRAINT "training_feedbacks_issue_tags_check" CHECK (jsonb_typeof("issue_tags") = 'array'),
  CONSTRAINT "training_feedbacks_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "training_qr_windows_token_hash_key" ON "training_qr_windows"("token_hash");
CREATE INDEX "training_qr_windows_session_id_purpose_status_idx" ON "training_qr_windows"("session_id", "purpose", "status");
CREATE INDEX "training_qr_windows_expires_at_status_idx" ON "training_qr_windows"("expires_at", "status");

CREATE UNIQUE INDEX "training_session_attendances_session_id_participant_id_key"
  ON "training_session_attendances"("session_id", "participant_id");
CREATE INDEX "training_session_attendances_participant_id_status_idx"
  ON "training_session_attendances"("participant_id", "status");
CREATE INDEX "training_session_attendances_session_id_status_check_in_at_idx"
  ON "training_session_attendances"("session_id", "status", "check_in_at");
CREATE INDEX "training_session_attendances_qr_window_id_idx"
  ON "training_session_attendances"("qr_window_id");

CREATE UNIQUE INDEX "training_feedbacks_session_id_participant_id_key"
  ON "training_feedbacks"("session_id", "participant_id");
CREATE INDEX "training_feedbacks_session_id_submitted_at_idx"
  ON "training_feedbacks"("session_id", "submitted_at");
CREATE INDEX "training_feedbacks_participant_id_updated_at_idx"
  ON "training_feedbacks"("participant_id", "updated_at");
CREATE INDEX "training_feedbacks_follow_up_requested_updated_at_idx"
  ON "training_feedbacks"("follow_up_requested", "updated_at");

ALTER TABLE "training_qr_windows" ADD CONSTRAINT "training_qr_windows_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "training_session_attendances" ADD CONSTRAINT "training_session_attendances_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_session_attendances" ADD CONSTRAINT "training_session_attendances_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "training_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_session_attendances" ADD CONSTRAINT "training_session_attendances_qr_window_id_fkey"
  FOREIGN KEY ("qr_window_id") REFERENCES "training_qr_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "training_feedbacks" ADD CONSTRAINT "training_feedbacks_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_feedbacks" ADD CONSTRAINT "training_feedbacks_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "training_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing training data only had plan-level attendance. It can be mapped
-- without invention only when the plan has exactly one session.
INSERT INTO "training_session_attendances" (
  "id",
  "session_id",
  "participant_id",
  "status",
  "check_in_at",
  "check_out_at",
  "source",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  single_session."session_id",
  participant."id",
  CASE
    WHEN participant."attendance_status" IN ('INVITED', 'PRESENT', 'LATE', 'ABSENT', 'LEAVE')
      THEN participant."attendance_status"
    ELSE 'INVITED'
  END,
  participant."check_in_at",
  participant."check_out_at",
  'LEGACY_MIGRATION',
  1,
  participant."created_at",
  participant."updated_at"
FROM "training_participants" participant
JOIN (
  SELECT "plan_id", MIN("id") AS "session_id"
  FROM "training_sessions"
  GROUP BY "plan_id"
  HAVING COUNT(*) = 1
) single_session ON single_session."plan_id" = participant."plan_id"
ON CONFLICT ("session_id", "participant_id") DO NOTHING;
