CREATE TABLE "weekly_process_worker_presets" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "week_start_date" DATE NOT NULL,
  "scope_key" TEXT NOT NULL,
  "process_key" TEXT NOT NULL,
  "process_definition_id" TEXT,
  "step_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_process_worker_presets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "weekly_process_worker_presets_scope_check" CHECK (
    ("scope_key" LIKE 'process:%' AND "step_id" IS NULL)
    OR ("scope_key" LIKE 'step:%' AND "step_id" IS NOT NULL)
  )
);

CREATE TABLE "weekly_process_worker_preset_members" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "preset_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_process_worker_preset_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weekly_process_worker_presets_week_start_date_scope_key_key"
  ON "weekly_process_worker_presets"("week_start_date", "scope_key");
CREATE INDEX "weekly_process_worker_presets_week_start_date_process_key_idx"
  ON "weekly_process_worker_presets"("week_start_date", "process_key");
CREATE INDEX "weekly_process_worker_presets_process_definition_id_idx"
  ON "weekly_process_worker_presets"("process_definition_id");
CREATE INDEX "weekly_process_worker_presets_step_id_idx"
  ON "weekly_process_worker_presets"("step_id");
CREATE INDEX "weekly_process_worker_presets_updated_at_idx"
  ON "weekly_process_worker_presets"("updated_at");

CREATE UNIQUE INDEX "weekly_process_worker_preset_members_preset_id_employee_id_key"
  ON "weekly_process_worker_preset_members"("preset_id", "employee_id");
CREATE INDEX "weekly_process_worker_preset_members_employee_id_idx"
  ON "weekly_process_worker_preset_members"("employee_id");

ALTER TABLE "weekly_process_worker_presets"
  ADD CONSTRAINT "weekly_process_worker_presets_process_definition_id_fkey"
  FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_process_worker_presets"
  ADD CONSTRAINT "weekly_process_worker_presets_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_process_worker_presets"
  ADD CONSTRAINT "weekly_process_worker_presets_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_process_worker_presets"
  ADD CONSTRAINT "weekly_process_worker_presets_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_process_worker_preset_members"
  ADD CONSTRAINT "weekly_process_worker_preset_members_preset_id_fkey"
  FOREIGN KEY ("preset_id") REFERENCES "weekly_process_worker_presets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_process_worker_preset_members"
  ADD CONSTRAINT "weekly_process_worker_preset_members_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
