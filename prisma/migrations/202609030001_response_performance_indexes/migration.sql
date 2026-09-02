-- Composite indexes for the list/filter paths used by product time, planning,
-- and production execution. These are additive and preserve all existing data.
CREATE INDEX IF NOT EXISTS "drawing_library_active_updated_idx"
  ON "drawing_library_items" ("deleted_at", "updated_at", "customer_name", "specification");

CREATE INDEX IF NOT EXISTS "production_plan_active_dispatch_idx"
  ON "production_plan_orders" ("deleted_at", "status", "priority", "customer_due_date");

CREATE INDEX IF NOT EXISTS "production_plan_batch_active_week_idx"
  ON "production_plan_batches" ("deleted_at", "week_start_date", "release_state");

CREATE INDEX IF NOT EXISTS "work_order_active_week_idx"
  ON "work_orders" ("deleted_at", "plan_active", "week_start_date");

CREATE INDEX IF NOT EXISTS "work_order_dispatch_idx"
  ON "work_orders" ("deleted_at", "stage", "priority", "planned_at");

