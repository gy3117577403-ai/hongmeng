CREATE TYPE "recruitment_demand_status" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'RECRUITING',
  'INTERVIEWING',
  'OFFER',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE "recruitment_priority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

CREATE TYPE "recruitment_candidate_status" AS ENUM (
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TYPE "recruitment_interview_status" AS ENUM (
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "recruitment_demands" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "team" TEXT,
  "headcount" INTEGER NOT NULL,
  "employment_type" TEXT NOT NULL DEFAULT 'full_time',
  "priority" "recruitment_priority" NOT NULL DEFAULT 'NORMAL',
  "reason" TEXT NOT NULL,
  "requirements" TEXT,
  "target_date" DATE,
  "status" "recruitment_demand_status" NOT NULL DEFAULT 'DRAFT',
  "requester_id" TEXT,
  "coordinator_id" TEXT,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "approved_by_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recruitment_demands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recruitment_candidates" (
  "id" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "demand_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "source" TEXT NOT NULL,
  "current_company" TEXT,
  "current_position" TEXT,
  "experience_years" INTEGER,
  "expected_salary" TEXT,
  "notes" TEXT,
  "status" "recruitment_candidate_status" NOT NULL DEFAULT 'SCREENING',
  "next_action_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "employee_id" TEXT,
  "hired_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recruitment_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recruitment_interviews" (
  "id" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "duration_minutes" INTEGER NOT NULL DEFAULT 60,
  "interviewer_id" TEXT,
  "method" TEXT NOT NULL DEFAULT 'onsite',
  "location" TEXT,
  "status" "recruitment_interview_status" NOT NULL DEFAULT 'SCHEDULED',
  "result" TEXT NOT NULL DEFAULT 'pending',
  "feedback" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recruitment_interviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recruitment_activities" (
  "id" TEXT NOT NULL,
  "demand_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "content" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recruitment_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recruitment_demands_code_key" ON "recruitment_demands"("code");
CREATE INDEX "recruitment_demands_status_priority_target_date_idx" ON "recruitment_demands"("status", "priority", "target_date");
CREATE INDEX "recruitment_demands_department_status_idx" ON "recruitment_demands"("department", "status");
CREATE INDEX "recruitment_demands_requester_id_status_idx" ON "recruitment_demands"("requester_id", "status");
CREATE INDEX "recruitment_demands_coordinator_id_status_idx" ON "recruitment_demands"("coordinator_id", "status");
CREATE INDEX "recruitment_demands_created_at_idx" ON "recruitment_demands"("created_at");

CREATE UNIQUE INDEX "recruitment_candidates_sequence_key" ON "recruitment_candidates"("sequence");
CREATE UNIQUE INDEX "recruitment_candidates_employee_id_key" ON "recruitment_candidates"("employee_id");
CREATE INDEX "recruitment_candidates_demand_id_status_updated_at_idx" ON "recruitment_candidates"("demand_id", "status", "updated_at");
CREATE INDEX "recruitment_candidates_status_next_action_at_idx" ON "recruitment_candidates"("status", "next_action_at");
CREATE INDEX "recruitment_candidates_name_idx" ON "recruitment_candidates"("name");

CREATE UNIQUE INDEX "recruitment_interviews_candidate_id_round_key" ON "recruitment_interviews"("candidate_id", "round");
CREATE INDEX "recruitment_interviews_scheduled_at_status_idx" ON "recruitment_interviews"("scheduled_at", "status");
CREATE INDEX "recruitment_interviews_interviewer_id_scheduled_at_idx" ON "recruitment_interviews"("interviewer_id", "scheduled_at");

CREATE INDEX "recruitment_activities_demand_id_created_at_idx" ON "recruitment_activities"("demand_id", "created_at");
CREATE INDEX "recruitment_activities_actor_id_idx" ON "recruitment_activities"("actor_id");
CREATE INDEX "recruitment_activities_action_idx" ON "recruitment_activities"("action");

ALTER TABLE "recruitment_demands"
ADD CONSTRAINT "recruitment_demands_requester_id_fkey"
FOREIGN KEY ("requester_id") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_demands"
ADD CONSTRAINT "recruitment_demands_coordinator_id_fkey"
FOREIGN KEY ("coordinator_id") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_demands"
ADD CONSTRAINT "recruitment_demands_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_demands"
ADD CONSTRAINT "recruitment_demands_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_demands"
ADD CONSTRAINT "recruitment_demands_approved_by_id_fkey"
FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_candidates"
ADD CONSTRAINT "recruitment_candidates_demand_id_fkey"
FOREIGN KEY ("demand_id") REFERENCES "recruitment_demands"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recruitment_candidates"
ADD CONSTRAINT "recruitment_candidates_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_candidates"
ADD CONSTRAINT "recruitment_candidates_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_candidates"
ADD CONSTRAINT "recruitment_candidates_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_interviews"
ADD CONSTRAINT "recruitment_interviews_candidate_id_fkey"
FOREIGN KEY ("candidate_id") REFERENCES "recruitment_candidates"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recruitment_interviews"
ADD CONSTRAINT "recruitment_interviews_interviewer_id_fkey"
FOREIGN KEY ("interviewer_id") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_interviews"
ADD CONSTRAINT "recruitment_interviews_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_interviews"
ADD CONSTRAINT "recruitment_interviews_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recruitment_activities"
ADD CONSTRAINT "recruitment_activities_demand_id_fkey"
FOREIGN KEY ("demand_id") REFERENCES "recruitment_demands"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recruitment_activities"
ADD CONSTRAINT "recruitment_activities_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
