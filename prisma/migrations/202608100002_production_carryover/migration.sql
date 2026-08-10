CREATE TABLE "production_carryovers" (
  "id" TEXT NOT NULL,
  "production_plan_batch_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "source_week_start_date" TIMESTAMP(3) NOT NULL,
  "target_week_start_date" TIMESTAMP(3) NOT NULL,
  "inclusion_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT,
  "included_by_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "production_carryovers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_carryovers_production_plan_batch_id_target_week_start_date_key"
ON "production_carryovers"("production_plan_batch_id", "target_week_start_date");

CREATE INDEX "production_carryovers_target_week_start_date_status_idx"
ON "production_carryovers"("target_week_start_date", "status");

CREATE INDEX "production_carryovers_source_week_start_date_status_idx"
ON "production_carryovers"("source_week_start_date", "status");

CREATE INDEX "production_carryovers_work_order_id_target_week_start_date_idx"
ON "production_carryovers"("work_order_id", "target_week_start_date");

ALTER TABLE "production_carryovers"
ADD CONSTRAINT "production_carryovers_production_plan_batch_id_fkey"
FOREIGN KEY ("production_plan_batch_id") REFERENCES "production_plan_batches"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_carryovers"
ADD CONSTRAINT "production_carryovers_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_carryovers"
ADD CONSTRAINT "production_carryovers_included_by_id_fkey"
FOREIGN KEY ("included_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
