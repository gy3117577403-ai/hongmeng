-- Add an order pool and release batches ahead of the existing production work-order flow.

CREATE TABLE "production_plan_orders" (
    "id" TEXT NOT NULL,
    "source_order_no" TEXT NOT NULL,
    "source_line_no" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "drawing_library_item_id" TEXT,
    "order_quantity" INTEGER NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "customer_due_date" TIMESTAMP(3) NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remark" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "production_plan_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_plan_orders_source_line_positive" CHECK ("source_line_no" > 0),
    CONSTRAINT "production_plan_orders_quantity_positive" CHECK ("order_quantity" > 0),
    CONSTRAINT "production_plan_orders_priority_check" CHECK ("priority" IN ('normal', 'urgent', 'insert')),
    CONSTRAINT "production_plan_orders_status_check" CHECK ("status" IN ('pending', 'scheduled', 'partially_released', 'released', 'paused', 'cancelled', 'completed'))
);

CREATE TABLE "production_plan_batches" (
    "id" TEXT NOT NULL,
    "plan_order_id" TEXT NOT NULL,
    "batch_no" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "week_start_date" TIMESTAMP(3) NOT NULL,
    "week_end_date" TIMESTAMP(3) NOT NULL,
    "planned_completion_date" TIMESTAMP(3) NOT NULL,
    "release_state" TEXT NOT NULL DEFAULT 'draft',
    "work_order_id" TEXT,
    "product_time_profile_id" TEXT,
    "product_time_profile_version" INTEGER,
    "unit_milliseconds_snapshot" INTEGER,
    "total_milliseconds_snapshot" BIGINT,
    "released_at" TIMESTAMP(3),
    "released_by_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "activated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "production_plan_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_plan_batches_batch_no_positive" CHECK ("batch_no" > 0),
    CONSTRAINT "production_plan_batches_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "production_plan_batches_release_state_check" CHECK ("release_state" IN ('draft', 'preparation', 'active', 'archived')),
    CONSTRAINT "production_plan_batches_profile_version_positive" CHECK ("product_time_profile_version" IS NULL OR "product_time_profile_version" > 0),
    CONSTRAINT "production_plan_batches_unit_time_positive" CHECK ("unit_milliseconds_snapshot" IS NULL OR "unit_milliseconds_snapshot" > 0),
    CONSTRAINT "production_plan_batches_total_time_positive" CHECK ("total_milliseconds_snapshot" IS NULL OR "total_milliseconds_snapshot" > 0),
    CONSTRAINT "production_plan_batches_week_range_check" CHECK ("week_end_date" >= "week_start_date")
);

CREATE TABLE "production_plan_changes" (
    "id" TEXT NOT NULL,
    "plan_order_id" TEXT,
    "batch_id" TEXT,
    "action" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "impact_data" JSONB,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_plan_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_plan_orders_source_order_no_source_line_no_key"
ON "production_plan_orders"("source_order_no", "source_line_no");
CREATE INDEX "production_plan_orders_customer_name_idx" ON "production_plan_orders"("customer_name");
CREATE INDEX "production_plan_orders_specification_idx" ON "production_plan_orders"("specification");
CREATE INDEX "production_plan_orders_customer_due_date_idx" ON "production_plan_orders"("customer_due_date");
CREATE INDEX "production_plan_orders_status_idx" ON "production_plan_orders"("status");
CREATE INDEX "production_plan_orders_priority_idx" ON "production_plan_orders"("priority");
CREATE INDEX "production_plan_orders_drawing_library_item_id_idx" ON "production_plan_orders"("drawing_library_item_id");
CREATE INDEX "production_plan_orders_deleted_at_idx" ON "production_plan_orders"("deleted_at");

CREATE UNIQUE INDEX "production_plan_batches_plan_order_id_batch_no_key"
ON "production_plan_batches"("plan_order_id", "batch_no");
CREATE UNIQUE INDEX "production_plan_batches_work_order_id_key" ON "production_plan_batches"("work_order_id");
CREATE INDEX "production_plan_batches_week_start_date_release_state_idx" ON "production_plan_batches"("week_start_date", "release_state");
CREATE INDEX "production_plan_batches_planned_completion_date_idx" ON "production_plan_batches"("planned_completion_date");
CREATE INDEX "production_plan_batches_product_time_profile_id_idx" ON "production_plan_batches"("product_time_profile_id");
CREATE INDEX "production_plan_batches_deleted_at_idx" ON "production_plan_batches"("deleted_at");

CREATE INDEX "production_plan_changes_plan_order_id_created_at_idx" ON "production_plan_changes"("plan_order_id", "created_at");
CREATE INDEX "production_plan_changes_batch_id_created_at_idx" ON "production_plan_changes"("batch_id", "created_at");
CREATE INDEX "production_plan_changes_action_idx" ON "production_plan_changes"("action");
CREATE INDEX "production_plan_changes_created_at_idx" ON "production_plan_changes"("created_at");

ALTER TABLE "production_plan_orders"
ADD CONSTRAINT "production_plan_orders_drawing_library_item_id_fkey"
FOREIGN KEY ("drawing_library_item_id") REFERENCES "drawing_library_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_orders_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_orders_updated_by_id_fkey"
FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "production_plan_batches"
ADD CONSTRAINT "production_plan_batches_plan_order_id_fkey"
FOREIGN KEY ("plan_order_id") REFERENCES "production_plan_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_batches_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_batches_product_time_profile_id_fkey"
FOREIGN KEY ("product_time_profile_id") REFERENCES "product_time_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_batches_released_by_id_fkey"
FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_batches_activated_by_id_fkey"
FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "production_plan_changes"
ADD CONSTRAINT "production_plan_changes_plan_order_id_fkey"
FOREIGN KEY ("plan_order_id") REFERENCES "production_plan_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_changes_batch_id_fkey"
FOREIGN KEY ("batch_id") REFERENCES "production_plan_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "production_plan_changes_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
