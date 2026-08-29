CREATE TABLE "production_plan_batch_holds" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "batch_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "hold_type" TEXT NOT NULL DEFAULT 'MATERIAL',
    "reason_code" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "expected_resolve_at" TIMESTAMP(3),
    "frozen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozen_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "override_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_plan_batch_holds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_plan_batch_holds_dedupe_key_key" ON "production_plan_batch_holds"("dedupe_key");
CREATE INDEX "production_plan_batch_holds_batch_id_status_idx" ON "production_plan_batch_holds"("batch_id", "status");
CREATE INDEX "production_plan_batch_holds_work_order_id_status_idx" ON "production_plan_batch_holds"("work_order_id", "status");
CREATE INDEX "production_plan_batch_holds_hold_type_status_idx" ON "production_plan_batch_holds"("hold_type", "status");
CREATE INDEX "production_plan_batch_holds_source_type_source_id_idx" ON "production_plan_batch_holds"("source_type", "source_id");

ALTER TABLE "production_plan_batch_holds"
  ADD CONSTRAINT "production_plan_batch_holds_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "production_plan_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_plan_batch_holds"
  ADD CONSTRAINT "production_plan_batch_holds_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing released batches must receive the same execution freeze as batches
-- released after this migration. Draft/archived planning rows remain unfrozen.
INSERT INTO "production_plan_batch_holds" (
  "id", "batch_id", "work_order_id", "dedupe_key", "hold_type",
  "reason_code", "source_type", "source_id", "status", "reason",
  "expected_resolve_at", "frozen_at", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  batch."id",
  batch."work_order_id",
  'material:' || batch."id",
  'MATERIAL',
  CASE
    WHEN task."status" = 'exception' THEN COALESCE(NULLIF(LOWER(task."exception_type"), ''), 'other')
    ELSE 'pending'
  END,
  'WAREHOUSE_MATERIAL_TASK',
  task."id",
  'ACTIVE',
  CASE
    WHEN task."status" = 'exception' AND NULLIF(task."exception_note", '') IS NOT NULL
      THEN '物料异常：' || task."exception_note"
    WHEN task."status" = 'exception' THEN '物料异常'
    ELSE '待配料'
  END,
  task."expected_at",
  COALESCE(task."updated_at", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "production_plan_batches" batch
JOIN "warehouse_material_tasks" task ON task."work_order_id" = batch."work_order_id"
WHERE batch."deleted_at" IS NULL
  AND batch."release_state" NOT IN ('draft', 'archived')
  AND task."status" <> 'completed'
ON CONFLICT ("dedupe_key") DO NOTHING;
