CREATE TYPE "material_follow_up_status" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'WAITING_ARRIVAL',
  'WAITING_WAREHOUSE',
  'RESOLVED',
  'CANCELLED'
);

CREATE TABLE "material_follow_up_tasks" (
  "id" TEXT NOT NULL,
  "warehouse_task_id" TEXT NOT NULL,
  "status" "material_follow_up_status" NOT NULL DEFAULT 'PENDING',
  "owner_id" TEXT,
  "created_by_id" TEXT,
  "resolved_by_id" TEXT,
  "latest_progress" TEXT,
  "expected_at" TIMESTAMP(3),
  "last_followed_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "material_follow_up_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "material_follow_up_activities" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" "material_follow_up_status",
  "to_status" "material_follow_up_status",
  "content" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "material_follow_up_activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_follow_up_tasks_warehouse_task_id_key"
ON "material_follow_up_tasks"("warehouse_task_id");

CREATE INDEX "material_follow_up_tasks_status_expected_at_idx"
ON "material_follow_up_tasks"("status", "expected_at");

CREATE INDEX "material_follow_up_tasks_owner_id_status_idx"
ON "material_follow_up_tasks"("owner_id", "status");

CREATE INDEX "material_follow_up_tasks_updated_at_idx"
ON "material_follow_up_tasks"("updated_at");

CREATE INDEX "material_follow_up_activities_task_id_created_at_idx"
ON "material_follow_up_activities"("task_id", "created_at");

CREATE INDEX "material_follow_up_activities_actor_id_idx"
ON "material_follow_up_activities"("actor_id");

CREATE INDEX "material_follow_up_activities_action_idx"
ON "material_follow_up_activities"("action");

ALTER TABLE "material_follow_up_tasks"
ADD CONSTRAINT "material_follow_up_tasks_warehouse_task_id_fkey"
FOREIGN KEY ("warehouse_task_id") REFERENCES "warehouse_material_tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_tasks"
ADD CONSTRAINT "material_follow_up_tasks_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_tasks"
ADD CONSTRAINT "material_follow_up_tasks_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_tasks"
ADD CONSTRAINT "material_follow_up_tasks_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_activities"
ADD CONSTRAINT "material_follow_up_activities_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "material_follow_up_tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_follow_up_activities"
ADD CONSTRAINT "material_follow_up_activities_actor_id_fkey"
FOREIGN KEY ("actor_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
