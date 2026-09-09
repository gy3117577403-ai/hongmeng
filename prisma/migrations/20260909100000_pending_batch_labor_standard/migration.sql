ALTER TABLE "process_labor_pools" DROP CONSTRAINT "process_labor_pools_batch_allocation_check";
ALTER TABLE "process_labor_pools" ADD CONSTRAINT "process_labor_pools_batch_allocation_check"
  CHECK ("allocation_policy" <> 'batch_proportional_v1' OR
    ("batch_target_qty" > 0 AND
      ("batch_total_standard_labor_milliseconds" > 0 OR
       ("standard_source" = 'pending_standard' AND "batch_total_standard_labor_milliseconds" IS NULL))));
