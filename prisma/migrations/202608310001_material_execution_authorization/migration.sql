ALTER TABLE "production_plan_batches"
ADD COLUMN "material_execution_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "material_execution_task_version" INTEGER,
ADD COLUMN "material_execution_decision_at" TIMESTAMP(3),
ADD COLUMN "material_execution_decision_by_id" TEXT,
ADD COLUMN "material_execution_reason" TEXT;

ALTER TABLE "production_plan_batches"
ADD CONSTRAINT "production_plan_batches_material_execution_decision_by_id_fkey"
FOREIGN KEY ("material_execution_decision_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "production_plan_batches_material_execution_decision_by_id_idx"
ON "production_plan_batches"("material_execution_decision_by_id");

-- Material state remains a visible production risk but no longer owns the
-- generic hard-hold ledger. Convert legacy automatically-created material
-- holds to an auditable overridden state; manual/quality/equipment holds stay
-- untouched and continue to block production.
UPDATE "production_plan_batch_holds"
SET
  "status" = 'OVERRIDDEN',
  "resolved_at" = COALESCE("resolved_at", CURRENT_TIMESTAMP),
  "override_reason" = COALESCE("override_reason", 'MATERIAL_HARD_HOLD_POLICY_DISABLED'),
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'ACTIVE'
  AND "hold_type" = 'MATERIAL'
  AND "source_type" = 'WAREHOUSE_MATERIAL_TASK';
