ALTER TABLE "work_orders" ADD COLUMN "plan_type" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "week_start_date" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN "week_end_date" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN "plan_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "work_orders" ADD COLUMN "plan_cleared_at" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN "plan_cleared_by" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "library_key" TEXT;

UPDATE "work_orders"
SET
  "plan_type" = COALESCE("plan_type", 'manual'),
  "library_key" = COALESCE(NULLIF(BTRIM("library_key"), ''), NULLIF(BTRIM("specification"), ''), "code"),
  "plan_active" = true
WHERE "plan_type" IS NULL OR "library_key" IS NULL;

CREATE INDEX "work_orders_plan_type_idx" ON "work_orders"("plan_type");
CREATE INDEX "work_orders_week_start_date_idx" ON "work_orders"("week_start_date");
CREATE INDEX "work_orders_plan_active_idx" ON "work_orders"("plan_active");
CREATE INDEX "work_orders_library_key_idx" ON "work_orders"("library_key");
