ALTER TABLE "production_plan_batches"
 ADD COLUMN "schedule_state" TEXT NOT NULL DEFAULT 'ACTIVE',
 ADD COLUMN "schedule_version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "schedule_reason" TEXT,
 ADD COLUMN "deferred_at" TIMESTAMP(3);
CREATE TABLE "production_plan_week_slots" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "batch_id" TEXT NOT NULL REFERENCES "production_plan_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "week_start_date" TIMESTAMP(3) NOT NULL,
 "week_end_date" TIMESTAMP(3) NOT NULL,
 "completion_date" TIMESTAMP(3) NOT NULL,
 "quantity" INTEGER NOT NULL CHECK ("quantity" >= 0),
 "planned_milliseconds" BIGINT CHECK ("planned_milliseconds" >= 0),
 "standard_milliseconds" BIGINT CHECK ("standard_milliseconds" >= 0),
 "step_milliseconds" JSONB NOT NULL DEFAULT '{}',
 "updated_at" TIMESTAMP(3) NOT NULL,
 UNIQUE ("batch_id", "week_start_date")
);
CREATE INDEX "production_plan_week_slots_completion_date_idx" ON "production_plan_week_slots"("completion_date");
CREATE INDEX "production_plan_week_slots_week_start_date_idx" ON "production_plan_week_slots"("week_start_date");
CREATE INDEX "production_plan_batches_schedule_state_idx" ON "production_plan_batches"("schedule_state", "deleted_at");
CREATE TABLE "production_plan_week_commands" (
 "key" TEXT NOT NULL PRIMARY KEY,
 "hash" TEXT NOT NULL,
 "result" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
