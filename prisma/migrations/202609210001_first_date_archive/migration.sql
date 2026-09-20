-- First inspection sheets may contain several products. Keep all old links,
-- while allowing new date-only FIRST records, as already supported for PATROL.
ALTER TABLE "quality_data_records" DROP CONSTRAINT "quality_data_order_scope_check";
ALTER TABLE "quality_data_records" ADD CONSTRAINT "quality_data_order_scope_check"
  CHECK ("type" IN ('FIRST', 'PATROL') OR "work_order_id" IS NOT NULL);
