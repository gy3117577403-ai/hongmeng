ALTER TABLE "sample_tasks"
  ADD COLUMN "unit_planned_milliseconds" INTEGER,
  ADD COLUMN "plan_time_source" TEXT,
  ADD COLUMN "completed_quantity_known" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "source_order_line" TEXT,
  ADD COLUMN "import_mutation_id" TEXT,
  ADD COLUMN "import_source_row" INTEGER,
  ADD COLUMN "import_file_name" TEXT;

ALTER TABLE "sample_tasks" ADD CONSTRAINT "sample_unit_time_positive"
  CHECK ("unit_planned_milliseconds" IS NULL OR "unit_planned_milliseconds" BETWEEN 1 AND 86400000);

-- A correction can reverse an erroneous completion to zero while preserving
-- its identity, audit history and matching warehouse ledger. New registrations
-- still require a positive quantity in the completion service.
ALTER TABLE "sample_completions" DROP CONSTRAINT "sample_completions_quantity_check";
ALTER TABLE "sample_completions" ADD CONSTRAINT "sample_completions_quantity_check" CHECK ("quantity" >= 0);

-- A historical completion flag is not evidence of a physical quantity.
-- This compatibility migration does not create any completion or stock movement.
UPDATE "sample_tasks" t SET "completed_quantity_known" = false
WHERE t.status = 'COMPLETED' AND t.completed_quantity = 0
AND NOT EXISTS (SELECT 1 FROM sample_completions c WHERE c.task_id = t.id);

CREATE INDEX "sample_tasks_import_mutation_id_idx" ON "sample_tasks"("import_mutation_id");
CREATE INDEX "sample_tasks_source_order_no_source_order_line_idx" ON "sample_tasks"("source_order_no", "source_order_line");
