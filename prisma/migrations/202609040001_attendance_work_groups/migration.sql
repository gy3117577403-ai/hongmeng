ALTER TABLE "employees"
ADD COLUMN "attendance_group" TEXT NOT NULL DEFAULT 'UNASSIGNED';

UPDATE "employees"
SET "attendance_group" = CASE
  WHEN concat_ws(' ', "department", "position", "team") ~ '(样品|样配)' THEN 'SAMPLE'
  WHEN concat_ws(' ', "department", "position", "team") ~ '(后端|装配|插入|总装)' THEN 'PRODUCTION_BACK'
  WHEN concat_ws(' ', "department", "position", "team") ~ '(前端|裁线|剥皮|压接|压裁)' THEN 'PRODUCTION_FRONT'
  WHEN concat_ws(' ', "department", "position", "team") ~ '(生产|车间|制造)' THEN 'UNASSIGNED'
  WHEN btrim(concat_ws(' ', "department", "position", "team")) <> '' THEN 'OTHER'
  ELSE 'UNASSIGNED'
END;

CREATE INDEX "employees_attendance_group_attendance_enabled_is_active_idx"
ON "employees"("attendance_group", "attendance_enabled", "is_active");

ALTER TABLE "attendance_records"
ADD COLUMN "attendance_group_snapshot" TEXT;

UPDATE "attendance_records" AS attendance
SET "attendance_group_snapshot" = employee."attendance_group"
FROM "employees" AS employee
WHERE employee."id" = attendance."employee_id";

CREATE INDEX "attendance_records_work_date_attendance_group_snapshot_status_idx"
ON "attendance_records"("work_date", "attendance_group_snapshot", "status");
