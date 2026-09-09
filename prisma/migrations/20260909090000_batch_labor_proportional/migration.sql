ALTER TABLE "process_labor_pools"
  ADD COLUMN "allocation_policy" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "batch_target_qty" INTEGER,
  ADD COLUMN "batch_total_standard_labor_milliseconds" BIGINT;

ALTER TABLE "process_labor_pools" ADD CONSTRAINT "process_labor_pools_batch_allocation_check"
  CHECK ("allocation_policy" <> 'batch_proportional_v1' OR
    ("batch_target_qty" > 0 AND "batch_total_standard_labor_milliseconds" > 0));
