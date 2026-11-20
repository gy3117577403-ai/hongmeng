ALTER TABLE "work_orders"
ADD COLUMN "force_closed_at" TIMESTAMP(3),
ADD COLUMN "force_closed_qty" INTEGER,
ADD CONSTRAINT "work_orders_force_closed_qty_check"
CHECK ("force_closed_qty" IS NULL OR ("force_closed_at" IS NOT NULL AND "force_closed_qty" >= 0));
