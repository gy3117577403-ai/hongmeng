ALTER TYPE "access_profile_key" ADD VALUE IF NOT EXISTS 'TRAINING_COLLABORATOR';

-- Training approval writes formal employee skill certificates. The legacy
-- certification table originally accepted only ASSESSMENT and LEGACY_ENTRY;
-- extend that database-level allowlist before any training records are used.
ALTER TABLE "employee_skill_certifications"
  DROP CONSTRAINT IF EXISTS "employee_skill_certifications_source_check";

ALTER TABLE "employee_skill_certifications"
  ADD CONSTRAINT "employee_skill_certifications_source_check"
  CHECK ("source" IN ('ASSESSMENT', 'LEGACY_ENTRY', 'TRAINING'));

CREATE TABLE "training_courses" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '岗位技能',
  "objective" TEXT,
  "description" TEXT,
  "target_audience" TEXT,
  "default_duration_minutes" INTEGER NOT NULL DEFAULT 60,
  "mode" TEXT NOT NULL DEFAULT 'OFFLINE',
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "assessment_mode" TEXT NOT NULL DEFAULT 'NONE',
  "pass_score" INTEGER,
  "skill_id" TEXT,
  "target_level" INTEGER,
  "validity_months" INTEGER,
  "retraining_months" INTEGER,
  "owner_employee_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_courses_duration_check" CHECK ("default_duration_minutes" > 0),
  CONSTRAINT "training_courses_pass_score_check" CHECK ("pass_score" IS NULL OR ("pass_score" >= 0 AND "pass_score" <= 100)),
  CONSTRAINT "training_courses_target_level_check" CHECK ("target_level" IS NULL OR ("target_level" >= 1 AND "target_level" <= 5)),
  CONSTRAINT "training_courses_validity_check" CHECK ("validity_months" IS NULL OR "validity_months" > 0),
  CONSTRAINT "training_courses_retraining_check" CHECK ("retraining_months" IS NULL OR "retraining_months" > 0),
  CONSTRAINT "training_courses_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "training_plans" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "course_id" TEXT,
  "course_version" INTEGER,
  "course_snapshot" JSONB,
  "purpose" TEXT,
  "scope_type" TEXT NOT NULL DEFAULT 'SELECTED',
  "scope_description" TEXT,
  "organizer_id" TEXT,
  "trainer_id" TEXT,
  "reviewer_id" TEXT,
  "department_id" TEXT,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'OFFLINE',
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "assessment_mode" TEXT NOT NULL DEFAULT 'NONE',
  "pass_score" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_plans_date_check" CHECK ("end_at" >= "start_at"),
  CONSTRAINT "training_plans_pass_score_check" CHECK ("pass_score" IS NULL OR ("pass_score" >= 0 AND "pass_score" <= 100)),
  CONSTRAINT "training_plans_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "training_sessions" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "trainer_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "actual_start_at" TIMESTAMP(3),
  "actual_end_at" TIMESTAMP(3),
  "actual_minutes" INTEGER,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_sessions_date_check" CHECK ("end_at" >= "start_at"),
  CONSTRAINT "training_sessions_actual_minutes_check" CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0),
  CONSTRAINT "training_sessions_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "training_participants" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employee_no_snapshot" TEXT NOT NULL,
  "employee_name_snapshot" TEXT NOT NULL,
  "department_snapshot" TEXT,
  "position_snapshot" TEXT,
  "team_snapshot" TEXT,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "attendance_status" TEXT NOT NULL DEFAULT 'INVITED',
  "check_in_at" TIMESTAMP(3),
  "check_out_at" TIMESTAMP(3),
  "actual_minutes" INTEGER,
  "theory_score" INTEGER,
  "practical_score" INTEGER,
  "score" INTEGER,
  "result" TEXT NOT NULL DEFAULT 'PENDING',
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "review_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  "reviewer_id" TEXT,
  "review_comment" TEXT,
  "absence_note" TEXT,
  "certification_id" TEXT,
  "submitted_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_participants_minutes_check" CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0),
  CONSTRAINT "training_participants_theory_score_check" CHECK ("theory_score" IS NULL OR ("theory_score" >= 0 AND "theory_score" <= 100)),
  CONSTRAINT "training_participants_practical_score_check" CHECK ("practical_score" IS NULL OR ("practical_score" >= 0 AND "practical_score" <= 100)),
  CONSTRAINT "training_participants_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
  CONSTRAINT "training_participants_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "training_attachments" (
  "id" TEXT NOT NULL,
  "course_id" TEXT,
  "plan_id" TEXT,
  "session_id" TEXT,
  "participant_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'OTHER',
  "object_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "display_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "uploaded_by_id" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "training_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_attachments_parent_check" CHECK (num_nonnulls("course_id", "plan_id", "session_id", "participant_id") = 1),
  CONSTRAINT "training_attachments_size_check" CHECK ("size" > 0)
);

CREATE TABLE "training_activities" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "content" TEXT,
  "detail" JSONB,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "training_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "training_courses_code_key" ON "training_courses"("code");
CREATE INDEX "training_courses_status_deleted_at_updated_at_idx" ON "training_courses"("status", "deleted_at", "updated_at");
CREATE INDEX "training_courses_category_status_idx" ON "training_courses"("category", "status");
CREATE INDEX "training_courses_skill_id_idx" ON "training_courses"("skill_id");
CREATE INDEX "training_courses_owner_employee_id_idx" ON "training_courses"("owner_employee_id");

CREATE UNIQUE INDEX "training_plans_code_key" ON "training_plans"("code");
CREATE INDEX "training_plans_status_start_at_deleted_at_idx" ON "training_plans"("status", "start_at", "deleted_at");
CREATE INDEX "training_plans_course_id_idx" ON "training_plans"("course_id");
CREATE INDEX "training_plans_department_id_start_at_idx" ON "training_plans"("department_id", "start_at");
CREATE INDEX "training_plans_trainer_id_start_at_idx" ON "training_plans"("trainer_id", "start_at");
CREATE INDEX "training_plans_reviewer_id_status_idx" ON "training_plans"("reviewer_id", "status");

CREATE UNIQUE INDEX "training_sessions_plan_id_sequence_key" ON "training_sessions"("plan_id", "sequence");
CREATE INDEX "training_sessions_start_at_status_idx" ON "training_sessions"("start_at", "status");
CREATE INDEX "training_sessions_trainer_id_start_at_idx" ON "training_sessions"("trainer_id", "start_at");

CREATE UNIQUE INDEX "training_participants_plan_id_employee_id_key" ON "training_participants"("plan_id", "employee_id");
CREATE INDEX "training_participants_employee_id_status_idx" ON "training_participants"("employee_id", "status");
CREATE INDEX "training_participants_review_status_updated_at_idx" ON "training_participants"("review_status", "updated_at");
CREATE INDEX "training_participants_attendance_status_updated_at_idx" ON "training_participants"("attendance_status", "updated_at");

CREATE UNIQUE INDEX "training_attachments_object_key_key" ON "training_attachments"("object_key");
CREATE INDEX "training_attachments_course_id_deleted_at_created_at_idx" ON "training_attachments"("course_id", "deleted_at", "created_at");
CREATE INDEX "training_attachments_plan_id_deleted_at_created_at_idx" ON "training_attachments"("plan_id", "deleted_at", "created_at");
CREATE INDEX "training_attachments_session_id_deleted_at_created_at_idx" ON "training_attachments"("session_id", "deleted_at", "created_at");
CREATE INDEX "training_attachments_participant_id_deleted_at_created_at_idx" ON "training_attachments"("participant_id", "deleted_at", "created_at");

CREATE INDEX "training_activities_plan_id_created_at_idx" ON "training_activities"("plan_id", "created_at");
CREATE INDEX "training_activities_actor_id_created_at_idx" ON "training_activities"("actor_id", "created_at");

ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skill_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "training_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "training_attachments" ADD CONSTRAINT "training_attachments_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "training_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_attachments" ADD CONSTRAINT "training_attachments_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_attachments" ADD CONSTRAINT "training_attachments_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_attachments" ADD CONSTRAINT "training_attachments_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "training_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_activities" ADD CONSTRAINT "training_activities_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
