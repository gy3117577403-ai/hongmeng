CREATE TABLE "tooling_kits" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "tooling_jobs" (
  "id" TEXT PRIMARY KEY, "actor_id" TEXT NOT NULL, "employee_id" TEXT NOT NULL,
  "actor_name" TEXT NOT NULL, "employee_no" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TUNING','ASSIST')),
  "status" TEXT NOT NULL CHECK ("status" IN ('RUNNING','PAUSED','COMPLETED','INCOMPLETE')),
  "active_employee" TEXT UNIQUE,
  "terminal_id" TEXT REFERENCES "terminal_tooling_terminals"("id") ON DELETE RESTRICT,
  "setup_id" TEXT REFERENCES "terminal_tooling_setups"("id") ON DELETE RESTRICT,
  "terminal_snapshot" JSONB NOT NULL, "context_snapshot" JSONB NOT NULL,
  "description" TEXT NOT NULL DEFAULT '', "category" TEXT NOT NULL DEFAULT '',
  "result_note" TEXT NOT NULL DEFAULT '', "backfill_reason" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL, "ended_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tooling_jobs_user_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "tooling_jobs_employee_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT
);
CREATE INDEX "tooling_jobs_employee_started_idx" ON "tooling_jobs"("employee_id","started_at");
CREATE INDEX "tooling_jobs_status_started_idx" ON "tooling_jobs"("status","started_at");
CREATE INDEX "tooling_jobs_terminal_idx" ON "tooling_jobs"("terminal_id");
CREATE TABLE "tooling_stocks" (
  "id" TEXT PRIMARY KEY, "blade_id" TEXT NOT NULL REFERENCES "terminal_tooling_blades"("id") ON DELETE RESTRICT,
  "position" "terminal_tooling_blade_position" NOT NULL,
  "kit_id" TEXT REFERENCES "tooling_kits"("id") ON DELETE RESTRICT,
  "home_box" INTEGER NOT NULL CHECK ("home_box" BETWEEN 1 AND 100),
  "current_box" INTEGER CHECK ("current_box" BETWEEN 1 AND 100),
  "state" TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK ("state" IN ('AVAILABLE','IN_USE','MAINTENANCE','RETIRED')),
  "in_use_job_id" TEXT REFERENCES "tooling_jobs"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tooling_stock_location_check" CHECK (
    ("state" = 'AVAILABLE' AND "current_box" IS NOT NULL AND "in_use_job_id" IS NULL)
    OR ("state" = 'IN_USE' AND "current_box" IS NULL AND "in_use_job_id" IS NOT NULL)
    OR ("state" IN ('MAINTENANCE','RETIRED') AND "in_use_job_id" IS NULL)
  )
);
CREATE UNIQUE INDEX "tooling_stocks_kit_position_key" ON "tooling_stocks"("kit_id","position") WHERE "kit_id" IS NOT NULL;
CREATE INDEX "tooling_stocks_blade_position_state_idx" ON "tooling_stocks"("blade_id","position","state");
CREATE INDEX "tooling_stocks_current_box_idx" ON "tooling_stocks"("current_box");
CREATE TABLE "tooling_segments" (
  "id" TEXT PRIMARY KEY, "job_id" TEXT NOT NULL REFERENCES "tooling_jobs"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('WORK','WAIT')),
  "reason" TEXT NOT NULL DEFAULT '', "started_at" TIMESTAMP(3) NOT NULL, "ended_at" TIMESTAMP(3),
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
CREATE UNIQUE INDEX "tooling_segment_open_key" ON "tooling_segments"("job_id") WHERE "ended_at" IS NULL;
CREATE INDEX "tooling_segments_job_idx" ON "tooling_segments"("job_id");
CREATE TABLE "tooling_usages" (
  "id" TEXT PRIMARY KEY, "job_id" TEXT NOT NULL REFERENCES "tooling_jobs"("id") ON DELETE CASCADE,
  "blade_id" TEXT NOT NULL REFERENCES "terminal_tooling_blades"("id") ON DELETE RESTRICT,
  "stock_id" TEXT REFERENCES "tooling_stocks"("id") ON DELETE RESTRICT,
  "position" "terminal_tooling_blade_position" NOT NULL, "snapshot" JSONB NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true, "disposition" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "tooling_usage_current_position_key" ON "tooling_usages"("job_id","position") WHERE "is_current";
CREATE INDEX "tooling_usages_stock_idx" ON "tooling_usages"("stock_id");
CREATE TABLE "tooling_events" (
  "id" TEXT PRIMARY KEY, "actor_id" TEXT NOT NULL, "actor_name" TEXT NOT NULL,
  "job_id" TEXT REFERENCES "tooling_jobs"("id") ON DELETE RESTRICT,
  "action" TEXT NOT NULL, "detail" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "tooling_events_job_created_idx" ON "tooling_events"("job_id","created_at");
CREATE TABLE "tooling_receipts" (
  "id" TEXT PRIMARY KEY, "actor_id" TEXT NOT NULL, "key" TEXT NOT NULL, "hash" TEXT NOT NULL,
  "result" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("actor_id","key")
);
ALTER TABLE "other_work_time_requests" ADD COLUMN "reportedMilliseconds" INTEGER;
ALTER TABLE "other_work_time_requests" ADD COLUMN "toolingJobId" TEXT REFERENCES "tooling_jobs"("id") ON DELETE RESTRICT;
CREATE INDEX "other_work_time_requests_toolingJobId_idx" ON "other_work_time_requests"("toolingJobId");
ALTER TABLE "terminal_tooling_blades" ADD COLUMN "inventory_counted_at" TIMESTAMP(3);
