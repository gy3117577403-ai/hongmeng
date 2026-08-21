ALTER TABLE "employees"
ADD COLUMN "attainment_factor_basis_points" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN "attainment_stream" TEXT NOT NULL DEFAULT 'batch';

ALTER TABLE "attendance_records"
ADD COLUMN "attainment_factor_basis_points_snapshot" INTEGER,
ADD COLUMN "attainment_stream_snapshot" TEXT;

ALTER TABLE "sop_documents"
ADD COLUMN "sop_stage" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "drawing_status" TEXT NOT NULL DEFAULT 'available',
ADD COLUMN "remark" TEXT;

ALTER TABLE "sop_versions"
ADD COLUMN "control_mode" TEXT;

UPDATE "employees"
SET
  "attainment_factor_basis_points" = CASE WHEN "attainment_eligible" THEN 10000 ELSE 0 END,
  "attainment_stream" = CASE WHEN "attainment_eligible" THEN 'batch' ELSE 'excluded' END;

UPDATE "employees"
SET "attainment_stream" = 'sample'
WHERE "attainment_eligible" = TRUE
  AND (
    COALESCE("team", '') LIKE '%样品%'
    OR COALESCE("position", '') LIKE '%样品%'
  );

UPDATE "employees"
SET
  "attainment_eligible" = FALSE,
  "attainment_factor_basis_points" = 0,
  "attainment_stream" = 'excluded'
WHERE COALESCE("position", '') ~ '(主管|组长|调模)';

UPDATE "attendance_records" AS attendance
SET
  "attainment_eligible_snapshot" = employee."attainment_eligible",
  "attainment_factor_basis_points_snapshot" = employee."attainment_factor_basis_points",
  "attainment_stream_snapshot" = employee."attainment_stream"
FROM "employees" AS employee
WHERE employee."id" = attendance."employee_id";

UPDATE "sop_versions"
SET "control_mode" = 'uncontrolled'
WHERE "status" = 'published' AND "control_mode" IS NULL;
