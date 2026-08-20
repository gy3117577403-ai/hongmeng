ALTER TABLE "employees"
  ADD COLUMN "attainment_eligible" BOOLEAN NOT NULL DEFAULT TRUE;

-- This is an initialization rule only. Runtime reports use the explicit field
-- and attendance snapshots, never a title string match. HR can re-enable an
-- acting supervisor who also works on production output.
UPDATE "employees"
SET "attainment_eligible" = FALSE
WHERE COALESCE("position", '') ~ '(主管|组长)';

ALTER TABLE "attendance_records"
  ADD COLUMN "team_snapshot" TEXT,
  ADD COLUMN "position_snapshot" TEXT,
  ADD COLUMN "attainment_eligible_snapshot" BOOLEAN;

UPDATE "attendance_records" record
SET
  "team_snapshot" = employee."team",
  "position_snapshot" = employee."position",
  "attainment_eligible_snapshot" = employee."attainment_eligible"
FROM "employees" employee
WHERE employee."id" = record."employee_id";

CREATE INDEX "attendance_records_work_date_attainment_eligible_snapshot_status_idx"
  ON "attendance_records"("work_date", "attainment_eligible_snapshot", "status");
