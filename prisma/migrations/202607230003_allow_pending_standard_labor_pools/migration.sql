ALTER TABLE "process_labor_pools"
DROP CONSTRAINT "process_labor_pools_standard_valid";

ALTER TABLE "process_labor_pools"
ADD CONSTRAINT "process_labor_pools_standard_valid" CHECK (
  (
    "status" = 'LOCKED'
    AND "standard_source" = 'pending_standard'
    AND "standard_milliseconds_per_unit" = 0
    AND "setup_milliseconds" >= 0
    AND "units_per_product" > 0
    AND "total_standard_labor_milliseconds" = 0
    AND "claimed_standard_labor_milliseconds" = 0
    AND "remaining_standard_labor_milliseconds" = 0
  )
  OR
  (
    "standard_milliseconds_per_unit" > 0
    AND "setup_milliseconds" >= 0
    AND "units_per_product" > 0
    AND "total_standard_labor_milliseconds" > 0
    AND "claimed_standard_labor_milliseconds" >= 0
    AND "remaining_standard_labor_milliseconds" >= 0
    AND "claimed_standard_labor_milliseconds" + "remaining_standard_labor_milliseconds"
        = "total_standard_labor_milliseconds"
  )
);
