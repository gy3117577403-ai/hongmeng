ALTER TABLE "warehouse_material_exception_cases"
  ADD COLUMN "arrival_outcome" TEXT NOT NULL DEFAULT '';
ALTER TABLE "warehouse_material_exception_cases"
  ADD CONSTRAINT "warehouse_material_arrival_outcome_check"
  CHECK ("arrival_outcome" IN ('', 'PARTIAL', 'COMPLETE'));
