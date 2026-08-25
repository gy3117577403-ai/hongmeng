-- A single factory attendance calendar controls whether a date participates in
-- attendance collection and reporting. Existing attendance rows remain intact;
-- changing a calendar day only changes whether those rows are effective.
CREATE TABLE "attendance_calendar_days" (
  "id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,
  "day_type" TEXT NOT NULL DEFAULT 'default',
  "label" TEXT,
  "remark" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_calendar_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_calendar_days_day_type_check"
    CHECK ("day_type" IN ('default', 'holiday', 'temporary_workday'))
);

CREATE UNIQUE INDEX "attendance_calendar_days_work_date_key"
  ON "attendance_calendar_days"("work_date");

CREATE INDEX "attendance_calendar_days_day_type_work_date_idx"
  ON "attendance_calendar_days"("day_type", "work_date");

CREATE INDEX "attendance_calendar_days_updated_by_id_idx"
  ON "attendance_calendar_days"("updated_by_id");
