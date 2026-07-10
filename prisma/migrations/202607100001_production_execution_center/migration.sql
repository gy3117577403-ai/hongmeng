ALTER TABLE "work_orders"
ADD COLUMN "production_owner" TEXT,
ADD COLUMN "workstation" TEXT,
ADD COLUMN "completed_qty" TEXT,
ADD COLUMN "started_at" TIMESTAMP(3),
ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "last_progress_at" TIMESTAMP(3),
ADD COLUMN "latest_progress_remark" TEXT;

CREATE TABLE "work_order_progress_logs" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "work_order_id" TEXT NOT NULL,
  "previous_stage" TEXT,
  "stage" TEXT NOT NULL,
  "completed_qty" TEXT,
  "production_owner" TEXT,
  "workstation" TEXT,
  "remark" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_progress_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_orders_production_owner_idx" ON "work_orders"("production_owner");
CREATE INDEX "work_orders_workstation_idx" ON "work_orders"("workstation");
CREATE INDEX "work_orders_last_progress_at_idx" ON "work_orders"("last_progress_at");
CREATE INDEX "work_order_progress_logs_work_order_id_created_at_idx" ON "work_order_progress_logs"("work_order_id", "created_at");
CREATE INDEX "work_order_progress_logs_created_at_idx" ON "work_order_progress_logs"("created_at");

ALTER TABLE "work_order_progress_logs"
ADD CONSTRAINT "work_order_progress_logs_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
