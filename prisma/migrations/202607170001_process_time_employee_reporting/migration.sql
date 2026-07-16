-- Additive standard-time, employee, and process execution reporting foundation.
-- Existing process routes remain valid; unconfigured historical steps keep nullable snapshots.

CREATE TABLE "process_time_standards" (
    "id" TEXT NOT NULL,
    "process_definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "time_basis" TEXT NOT NULL DEFAULT 'per_unit',
    "unit_label" TEXT NOT NULL DEFAULT '件',
    "standard_milliseconds_per_unit" INTEGER NOT NULL,
    "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_time_standards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_time_standards_version_positive" CHECK ("version" > 0),
    CONSTRAINT "process_time_standards_basis_check" CHECK ("time_basis" IN ('per_unit', 'per_batch')),
    CONSTRAINT "process_time_standards_standard_positive" CHECK ("standard_milliseconds_per_unit" > 0),
    CONSTRAINT "process_time_standards_setup_nonnegative" CHECK ("setup_milliseconds" >= 0)
);

CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "team" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "process_template_steps"
ADD COLUMN "units_per_product" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "work_order_process_steps"
ADD COLUMN "standard_time_id" TEXT,
ADD COLUMN "standard_version" INTEGER,
ADD COLUMN "time_basis" TEXT,
ADD COLUMN "unit_label" TEXT,
ADD COLUMN "standard_milliseconds_per_unit" INTEGER,
ADD COLUMN "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "units_per_product" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "process_executions" (
    "id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "break_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "good_qty" INTEGER NOT NULL,
    "scrap_qty" INTEGER NOT NULL DEFAULT 0,
    "rework_qty" INTEGER NOT NULL DEFAULT 0,
    "time_basis" TEXT NOT NULL DEFAULT 'per_unit',
    "unit_label" TEXT NOT NULL,
    "standard_milliseconds_per_unit" INTEGER NOT NULL,
    "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "units_per_product" INTEGER NOT NULL DEFAULT 1,
    "standard_labor_milliseconds" INTEGER NOT NULL,
    "actual_labor_milliseconds" INTEGER NOT NULL,
    "attainment_basis_points" INTEGER NOT NULL,
    "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "remark" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    CONSTRAINT "process_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_executions_time_order" CHECK ("ended_at" > "started_at"),
    CONSTRAINT "process_executions_break_nonnegative" CHECK ("break_milliseconds" >= 0),
    CONSTRAINT "process_executions_good_qty_positive" CHECK ("good_qty" > 0),
    CONSTRAINT "process_executions_scrap_qty_nonnegative" CHECK ("scrap_qty" >= 0),
    CONSTRAINT "process_executions_rework_qty_nonnegative" CHECK ("rework_qty" >= 0),
    CONSTRAINT "process_executions_basis_check" CHECK ("time_basis" IN ('per_unit', 'per_batch')),
    CONSTRAINT "process_executions_standard_positive" CHECK ("standard_milliseconds_per_unit" > 0),
    CONSTRAINT "process_executions_setup_nonnegative" CHECK ("setup_milliseconds" >= 0),
    CONSTRAINT "process_executions_units_positive" CHECK ("units_per_product" > 0),
    CONSTRAINT "process_executions_standard_labor_positive" CHECK ("standard_labor_milliseconds" > 0),
    CONSTRAINT "process_executions_actual_labor_positive" CHECK ("actual_labor_milliseconds" > 0),
    CONSTRAINT "process_executions_attainment_nonnegative" CHECK ("attainment_basis_points" >= 0)
);

ALTER TABLE "process_template_steps"
ADD CONSTRAINT "process_template_steps_units_per_product_positive"
CHECK ("units_per_product" > 0);

ALTER TABLE "work_order_process_steps"
ADD CONSTRAINT "work_order_process_steps_standard_version_positive"
CHECK ("standard_version" IS NULL OR "standard_version" > 0),
ADD CONSTRAINT "work_order_process_steps_basis_check"
CHECK ("time_basis" IS NULL OR "time_basis" IN ('per_unit', 'per_batch')),
ADD CONSTRAINT "work_order_process_steps_standard_positive"
CHECK ("standard_milliseconds_per_unit" IS NULL OR "standard_milliseconds_per_unit" > 0),
ADD CONSTRAINT "work_order_process_steps_setup_nonnegative"
CHECK ("setup_milliseconds" >= 0),
ADD CONSTRAINT "work_order_process_steps_units_per_product_positive"
CHECK ("units_per_product" > 0);

CREATE UNIQUE INDEX "process_time_standards_process_definition_id_version_key"
ON "process_time_standards"("process_definition_id", "version");
CREATE UNIQUE INDEX "process_time_standards_one_current_per_definition"
ON "process_time_standards"("process_definition_id") WHERE "is_current" = true;
CREATE INDEX "process_time_standards_process_definition_id_is_current_idx"
ON "process_time_standards"("process_definition_id", "is_current");
CREATE INDEX "process_time_standards_effective_from_idx"
ON "process_time_standards"("effective_from");
CREATE INDEX "process_time_standards_created_by_id_idx"
ON "process_time_standards"("created_by_id");

CREATE UNIQUE INDEX "employees_employee_no_key" ON "employees"("employee_no");
CREATE INDEX "employees_is_active_employee_no_idx" ON "employees"("is_active", "employee_no");
CREATE INDEX "employees_name_idx" ON "employees"("name");
CREATE INDEX "employees_department_idx" ON "employees"("department");
CREATE INDEX "employees_team_idx" ON "employees"("team");

CREATE INDEX "work_order_process_steps_standard_time_id_idx"
ON "work_order_process_steps"("standard_time_id");
CREATE INDEX "process_executions_step_id_ended_at_idx"
ON "process_executions"("step_id", "ended_at");
CREATE INDEX "process_executions_employee_id_ended_at_idx"
ON "process_executions"("employee_id", "ended_at");
CREATE INDEX "process_executions_ended_at_idx"
ON "process_executions"("ended_at");
CREATE INDEX "process_executions_voided_at_idx"
ON "process_executions"("voided_at");
CREATE INDEX "process_executions_recorded_by_id_idx"
ON "process_executions"("recorded_by_id");

ALTER TABLE "process_time_standards"
ADD CONSTRAINT "process_time_standards_process_definition_id_fkey"
FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "process_time_standards_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_order_process_steps"
ADD CONSTRAINT "work_order_process_steps_standard_time_id_fkey"
FOREIGN KEY ("standard_time_id") REFERENCES "process_time_standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_executions"
ADD CONSTRAINT "process_executions_step_id_fkey"
FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "process_executions_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_executions_recorded_by_id_fkey"
FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
