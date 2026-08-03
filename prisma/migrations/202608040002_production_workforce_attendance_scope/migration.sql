-- Keep the existing HR department as the single workforce source.
-- Older deployments used "生产" while the current HR UI uses "生产部".
UPDATE "employees"
SET "department" = '生产部'
WHERE BTRIM("department") IN ('生产', '生产部');

-- Freeze the department used for each attendance day so later transfers do
-- not rewrite historical attendance and attainment statistics.
ALTER TABLE "attendance_records"
ADD COLUMN "department_snapshot" TEXT;

UPDATE "attendance_records" AS attendance
SET "department_snapshot" = COALESCE(employee."department", '')
FROM "employees" AS employee
WHERE attendance."employee_id" = employee."id";

CREATE INDEX "attendance_records_work_date_department_snapshot_status_idx"
ON "attendance_records"("work_date", "department_snapshot", "status");
