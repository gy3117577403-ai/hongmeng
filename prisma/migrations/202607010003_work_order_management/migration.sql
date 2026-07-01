ALTER TABLE "work_orders" ADD COLUMN "remark" TEXT;
ALTER TABLE "work_orders" ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "work_orders_deleted_at_idx" ON "work_orders"("deleted_at");
