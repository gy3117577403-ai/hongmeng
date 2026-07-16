-- Warehouse material preparation is tracked independently from production stage.
CREATE TABLE "warehouse_material_tasks" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exception_type" TEXT,
    "exception_note" TEXT,
    "expected_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "updated_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouse_material_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "warehouse_material_activities" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "content" TEXT,
    "detail" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouse_material_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_material_tasks_work_order_id_key" ON "warehouse_material_tasks"("work_order_id");
CREATE INDEX "warehouse_material_tasks_status_idx" ON "warehouse_material_tasks"("status");
CREATE INDEX "warehouse_material_tasks_exception_type_idx" ON "warehouse_material_tasks"("exception_type");
CREATE INDEX "warehouse_material_tasks_expected_at_idx" ON "warehouse_material_tasks"("expected_at");
CREATE INDEX "warehouse_material_tasks_updated_at_idx" ON "warehouse_material_tasks"("updated_at");
CREATE INDEX "warehouse_material_activities_task_id_created_at_idx" ON "warehouse_material_activities"("task_id", "created_at");
CREATE INDEX "warehouse_material_activities_actor_id_idx" ON "warehouse_material_activities"("actor_id");
CREATE INDEX "warehouse_material_activities_action_idx" ON "warehouse_material_activities"("action");

ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_activities" ADD CONSTRAINT "warehouse_material_activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "warehouse_material_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_activities" ADD CONSTRAINT "warehouse_material_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "warehouse_material_tasks" ("id", "work_order_id", "status", "created_at", "updated_at")
SELECT 'wmt-' || md5("id"), "id", 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "work_orders"
WHERE "deleted_at" IS NULL
  AND "plan_type" = 'weekly_plan'
  AND "plan_active" = true
ON CONFLICT ("work_order_id") DO NOTHING;

UPDATE "work_orders"
SET "material_status" = '未配料', "updated_at" = CURRENT_TIMESTAMP
WHERE "deleted_at" IS NULL
  AND "plan_type" = 'weekly_plan'
  AND "plan_active" = true;
