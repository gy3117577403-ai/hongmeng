ALTER TABLE "work_orders"
  ADD COLUMN "operational_note" JSONB,
  ADD COLUMN "production_paused_at" TIMESTAMP(3),
  ADD COLUMN "production_pause" JSONB,
  ADD COLUMN "production_control_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "estimated_completion_at" TIMESTAMP(3),
  ADD COLUMN "delivery_baseline_day" TEXT,
  ADD COLUMN "plan_baseline_at" TIMESTAMP(3),
  ADD COLUMN "date_baseline_source" TEXT NOT NULL DEFAULT 'initial',
  ADD COLUMN "delivery_adjustment_count" INTEGER NOT NULL DEFAULT 0;

-- Existing values are upgrade baselines, not reconstructed original promises.
UPDATE "work_orders" SET "delivery_baseline_day" = "delivery_day",
  "plan_baseline_at" = "planned_at", "date_baseline_source" = 'upgrade';

ALTER TABLE "production_plan_orders"
  ADD COLUMN "customer_due_date_confirmed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "delivery_baseline_date" TIMESTAMP(3),
  ADD COLUMN "date_baseline_source" TEXT NOT NULL DEFAULT 'initial',
  ADD COLUMN "delivery_version" INTEGER NOT NULL DEFAULT 0;
UPDATE "production_plan_orders" SET "delivery_baseline_date" = "customer_due_date", "date_baseline_source" = 'upgrade';

ALTER TABLE "production_plan_batches"
  ADD COLUMN "plan_baseline_date" TIMESTAMP(3),
  ADD COLUMN "estimated_completion_date" TIMESTAMP(3);
UPDATE "production_plan_batches" SET "plan_baseline_date" = "planned_completion_date";

ALTER TABLE "daily_process_tasks" ADD COLUMN "production_suspended_at" TIMESTAMP(3);

CREATE TABLE "production_control_events" (
  "id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "actor_id" TEXT NOT NULL,
  "actor_name" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "before_data" JSONB NOT NULL,
  "after_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_control_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_control_events_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "production_control_events_request_id_key" ON "production_control_events"("request_id");
CREATE INDEX "production_control_events_work_order_id_created_at_idx" ON "production_control_events"("work_order_id", "created_at");
CREATE INDEX "work_orders_production_paused_at_idx" ON "work_orders"("production_paused_at");
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_production_control_version_nonnegative" CHECK ("production_control_version" >= 0);
