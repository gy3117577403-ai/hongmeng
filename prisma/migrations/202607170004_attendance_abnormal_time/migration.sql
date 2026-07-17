-- Additive attendance and abnormal-time ledgers for employee attainment reporting.
-- Existing employees and process execution records remain unchanged.

ALTER TABLE "employees"
ADD COLUMN "attendance_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "attendance_type" TEXT NOT NULL DEFAULT 'normal',
    "planned_milliseconds" INTEGER NOT NULL DEFAULT 28800000,
    "leave_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "actual_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "overtime_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "segments" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "remark" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_records_status_check" CHECK ("status" IN ('draft', 'confirmed')),
    CONSTRAINT "attendance_records_type_check" CHECK ("attendance_type" IN ('normal', 'leave', 'absent', 'rest')),
    CONSTRAINT "attendance_records_planned_nonnegative" CHECK ("planned_milliseconds" >= 0),
    CONSTRAINT "attendance_records_leave_nonnegative" CHECK ("leave_milliseconds" >= 0),
    CONSTRAINT "attendance_records_actual_nonnegative" CHECK ("actual_milliseconds" >= 0),
    CONSTRAINT "attendance_records_overtime_nonnegative" CHECK ("overtime_milliseconds" >= 0)
);

CREATE TABLE "abnormal_time_events" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "work_date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "duration_milliseconds" INTEGER NOT NULL,
    "employee_exempt" BOOLEAN NOT NULL DEFAULT false,
    "quality_status" TEXT NOT NULL DEFAULT 'pending',
    "quality_note" TEXT,
    "quality_confirmed_by_id" TEXT,
    "quality_confirmed_at" TIMESTAMP(3),
    "resolution_status" TEXT NOT NULL DEFAULT 'open',
    "responsibility_department" TEXT,
    "expected_resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "work_order_id" TEXT,
    "process_step_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "abnormal_time_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abnormal_time_events_time_order" CHECK ("ended_at" > "started_at"),
    CONSTRAINT "abnormal_time_events_duration_positive" CHECK ("duration_milliseconds" > 0),
    CONSTRAINT "abnormal_time_events_quality_status_check" CHECK ("quality_status" IN ('pending', 'confirmed', 'rejected')),
    CONSTRAINT "abnormal_time_events_resolution_status_check" CHECK ("resolution_status" IN ('open', 'resolved'))
);

CREATE TABLE "abnormal_time_allocations" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "duration_milliseconds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "abnormal_time_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abnormal_time_allocations_duration_positive" CHECK ("duration_milliseconds" > 0)
);

CREATE INDEX "employees_attendance_enabled_is_active_idx" ON "employees"("attendance_enabled", "is_active");
CREATE UNIQUE INDEX "attendance_records_employee_id_work_date_key" ON "attendance_records"("employee_id", "work_date");
CREATE INDEX "attendance_records_work_date_status_idx" ON "attendance_records"("work_date", "status");
CREATE INDEX "attendance_records_employee_id_status_idx" ON "attendance_records"("employee_id", "status");
CREATE INDEX "attendance_records_confirmed_by_id_idx" ON "attendance_records"("confirmed_by_id");
CREATE UNIQUE INDEX "abnormal_time_events_sequence_key" ON "abnormal_time_events"("sequence");
CREATE INDEX "abnormal_time_events_work_date_quality_status_idx" ON "abnormal_time_events"("work_date", "quality_status");
CREATE INDEX "abnormal_time_events_category_work_date_idx" ON "abnormal_time_events"("category", "work_date");
CREATE INDEX "abnormal_time_events_resolution_status_work_date_idx" ON "abnormal_time_events"("resolution_status", "work_date");
CREATE INDEX "abnormal_time_events_work_order_id_idx" ON "abnormal_time_events"("work_order_id");
CREATE INDEX "abnormal_time_events_process_step_id_idx" ON "abnormal_time_events"("process_step_id");
CREATE INDEX "abnormal_time_events_deleted_at_idx" ON "abnormal_time_events"("deleted_at");
CREATE UNIQUE INDEX "abnormal_time_allocations_event_id_employee_id_key" ON "abnormal_time_allocations"("event_id", "employee_id");
CREATE INDEX "abnormal_time_allocations_employee_id_work_date_idx" ON "abnormal_time_allocations"("employee_id", "work_date");
CREATE INDEX "abnormal_time_allocations_work_date_idx" ON "abnormal_time_allocations"("work_date");

ALTER TABLE "attendance_records"
ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "attendance_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "attendance_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "attendance_records_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "abnormal_time_events"
ADD CONSTRAINT "abnormal_time_events_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_events_process_step_id_fkey" FOREIGN KEY ("process_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_events_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_events_quality_confirmed_by_id_fkey" FOREIGN KEY ("quality_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_events_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "abnormal_time_allocations"
ADD CONSTRAINT "abnormal_time_allocations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "abnormal_time_events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "abnormal_time_allocations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
