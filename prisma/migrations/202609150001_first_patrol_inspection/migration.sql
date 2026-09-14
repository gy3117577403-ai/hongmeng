ALTER TABLE "quality_data_records" ALTER COLUMN "work_order_id" DROP NOT NULL;
ALTER TABLE "quality_data_records"
  ADD COLUMN "inspection_step_id" TEXT,
  ADD COLUMN "inspection_step_snapshot" JSONB;
ALTER TABLE "quality_data_records" ADD CONSTRAINT "quality_data_order_scope_check"
  CHECK ("type" = 'PATROL' OR "work_order_id" IS NOT NULL);
ALTER TABLE "quality_data_records" ADD CONSTRAINT "quality_data_first_step_scope_check"
  CHECK ("inspection_step_id" IS NULL OR ("type" = 'FIRST' AND "inspection_step_snapshot" IS NOT NULL));
CREATE INDEX "quality_data_step_idx" ON "quality_data_records"("work_order_id", "inspection_step_id", "deleted_at", "inspected_at");
ALTER TABLE "quality_data_attachments" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
WITH ordered AS (
  SELECT "id", row_number() OVER (PARTITION BY "record_id" ORDER BY "created_at", "id") - 1 AS position
  FROM "quality_data_attachments"
)
UPDATE "quality_data_attachments" AS attachment SET "sort_order" = ordered.position FROM ordered WHERE attachment."id" = ordered."id";
-- Historical FIRST records stay unassigned. Never infer a process from a repeated name.
