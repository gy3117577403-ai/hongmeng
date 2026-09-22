ALTER TABLE "sample_tasks"
 ADD COLUMN "task_type" TEXT NOT NULL DEFAULT 'NEW',
 ADD COLUMN "plan_week_start_date" DATE,
 ADD COLUMN "document_review_required" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "approved_package_id" TEXT,
 ADD COLUMN "completed_quantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sample_tasks" ADD CONSTRAINT "sample_task_type_check" CHECK ("task_type" IN ('NEW','REPEAT'));
ALTER TABLE "sample_tasks" ADD CONSTRAINT "sample_completed_quantity_check" CHECK ("completed_quantity" >= 0);
CREATE INDEX "sample_tasks_deleted_at_task_type_plan_week_start_date_status_idx" ON "sample_tasks"("deleted_at","task_type","plan_week_start_date","status");
ALTER TABLE "warehouse_material_tasks" ALTER COLUMN "work_order_id" DROP NOT NULL;
ALTER TABLE "warehouse_material_tasks" ADD COLUMN "sample_task_id" TEXT, ADD COLUMN "requirements" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "requirements_confirmed" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "warehouse_material_tasks_sample_task_id_key" ON "warehouse_material_tasks"("sample_task_id");
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_tasks_sample_task_id_fkey" FOREIGN KEY ("sample_task_id") REFERENCES "sample_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_material_tasks" ADD CONSTRAINT "warehouse_material_source_check" CHECK (num_nonnulls("work_order_id", "sample_task_id") = 1);
CREATE TABLE "sample_completions" (
 "id" TEXT NOT NULL PRIMARY KEY, "task_id" TEXT NOT NULL, "mutation_id" TEXT NOT NULL, "request_hash" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL CHECK ("quantity" > 0), "work_date" DATE NOT NULL, "note" TEXT NOT NULL DEFAULT '',
 "actor_id" TEXT NOT NULL, "actor_name" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "sample_completions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "sample_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sample_completions_task_id_mutation_id_key" ON "sample_completions"("task_id","mutation_id");
CREATE INDEX "sample_completions_task_id_created_at_idx" ON "sample_completions"("task_id","created_at");
ALTER TABLE "fg_lots" ADD COLUMN "sampleTaskId" TEXT;
ALTER TABLE "fg_lots" ADD CONSTRAINT "fg_lots_sampleTaskId_fkey" FOREIGN KEY ("sampleTaskId") REFERENCES "sample_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "fg_lots_sampleTaskId_idx" ON "fg_lots"("sampleTaskId");
-- Historical completed samples are deliberately not projected into stock.
INSERT INTO "warehouse_material_tasks" ("id","sample_task_id","status","version","created_at","updated_at")
SELECT md5('sample-material:' || "id"), "id", 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "sample_tasks" WHERE "deleted_at" IS NULL AND "status" NOT IN ('COMPLETED','CANCELLED') AND "data_purpose"='PRODUCTION';

ALTER TABLE "sample_completions" ADD COLUMN "approved_package_id" TEXT;
