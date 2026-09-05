ALTER TABLE "process_supplement_obligations" ADD COLUMN "reconciliation_key" TEXT;
CREATE UNIQUE INDEX "process_supplement_obligations_reconciliation_key_key"
  ON "process_supplement_obligations" ("reconciliation_key");
ALTER TABLE "process_supplement_obligations" DROP CONSTRAINT "process_supplement_obligations_source_check";
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_source_check" CHECK (
  ("change_id" IS NOT NULL AND "diff_id" IS NOT NULL AND "deployment_route_id" IS NULL AND "reconciliation_key" IS NULL)
  OR ("change_id" IS NULL AND "diff_id" IS NULL AND "deployment_route_id" IS NOT NULL AND "occurrence_key" IS NOT NULL AND "reconciliation_key" IS NULL)
  OR ("change_id" IS NULL AND "diff_id" IS NULL AND "deployment_route_id" IS NULL AND "occurrence_key" IS NULL
      AND "source" = 'EXISTING' AND "reconciliation_key" IS NOT NULL AND "reconciliation_key" = 'existing-route:' || "display_step_id")
);
