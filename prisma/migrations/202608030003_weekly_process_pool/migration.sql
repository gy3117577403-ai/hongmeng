-- Add explicit process ownership for production teams. No existing team,
-- employee, plan, task, or historical record is deleted or rewritten.
CREATE TABLE "production_team_process_capabilities" (
  "id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "process_definition_id" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_team_process_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_team_process_capabilities_team_id_process_definition_id_key"
  ON "production_team_process_capabilities"("team_id", "process_definition_id");
CREATE INDEX "production_team_process_capabilities_process_definition_id_is_active_idx"
  ON "production_team_process_capabilities"("process_definition_id", "is_active");
CREATE INDEX "production_team_process_capabilities_team_id_is_active_priority_idx"
  ON "production_team_process_capabilities"("team_id", "is_active", "priority");
CREATE INDEX "daily_process_tasks_week_allocation_idx"
  ON "daily_process_tasks"("production_plan_batch_id", "step_id", "work_date", "status");

ALTER TABLE "production_team_process_capabilities"
  ADD CONSTRAINT "production_team_process_capabilities_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "production_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_team_process_capabilities"
  ADD CONSTRAINT "production_team_process_capabilities_process_definition_id_fkey"
  FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
