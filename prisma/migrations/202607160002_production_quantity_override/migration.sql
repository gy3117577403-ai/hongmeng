ALTER TABLE "work_orders"
ADD COLUMN "production_target_qty" INTEGER;

ALTER TABLE "work_orders"
ADD CONSTRAINT "work_orders_production_target_qty_positive"
CHECK ("production_target_qty" IS NULL OR "production_target_qty" > 0);
