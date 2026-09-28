ALTER TABLE "production_plan_orders"
 ADD COLUMN "preparation_rank" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "preparation_version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "preparation_quantity" INTEGER,
 ADD COLUMN "preparation_due_at" TIMESTAMP(3),
 ADD COLUMN "preparation_note" TEXT,
 ADD COLUMN "preparation_state" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "production_plan_batches" ADD COLUMN "pool_prepared_quantity" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "pool_preparation_linked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "warehouse_material_tasks" ADD COLUMN "plan_order_id" TEXT,
 ADD COLUMN "prepared_quantity" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "pool_completion_inherited" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "preparation_task_id" TEXT;
ALTER TABLE "warehouse_material_tasks" DROP CONSTRAINT "warehouse_material_source_check";
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_source_check" CHECK (num_nonnulls("work_order_id", "sample_task_id", "plan_order_id") = 1);
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_plan_order_id_fkey" FOREIGN KEY ("plan_order_id") REFERENCES "production_plan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_preparation_task_id_fkey" FOREIGN KEY ("preparation_task_id") REFERENCES "warehouse_material_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "warehouse_material_tasks_plan_order_id_key" ON "warehouse_material_tasks"("plan_order_id");
CREATE INDEX "pool_preparation_queue_idx" ON "production_plan_orders"("deleted_at", "status", "priority", "preparation_rank");
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "pool_prepared_nonnegative" CHECK ("prepared_quantity" >= 0);
ALTER TABLE "production_plan_batches" ADD CONSTRAINT "pool_credit_range" CHECK ("pool_prepared_quantity" >= 0 AND "pool_prepared_quantity" <= "quantity");
ALTER TABLE "production_plan_orders" ADD CONSTRAINT "pool_target_range" CHECK ("preparation_quantity" IS NULL OR ("preparation_quantity" >= 0 AND "preparation_quantity" <= "order_quantity"));
CREATE TABLE "order_pool_commands" ("key" TEXT PRIMARY KEY, "hash" TEXT NOT NULL, "result" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
WITH ranked AS (SELECT id, row_number() OVER (ORDER BY created_at,id)::integer AS rank FROM production_plan_orders)
UPDATE production_plan_orders p SET preparation_rank=r.rank FROM ranked r WHERE r.id=p.id;
INSERT INTO warehouse_material_tasks(id,plan_order_id,status,updated_at)
SELECT 'pool-' || p.id,p.id,'pending',CURRENT_TIMESTAMP FROM production_plan_orders p
WHERE p.deleted_at IS NULL AND p.status NOT IN ('cancelled','completed')
 AND p.order_quantity > COALESCE((SELECT SUM(b.quantity) FROM production_plan_batches b WHERE b.plan_order_id=p.id AND b.deleted_at IS NULL),0)
ON CONFLICT DO NOTHING;
