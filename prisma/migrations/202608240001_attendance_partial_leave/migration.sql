ALTER TABLE "attendance_records"
  DROP CONSTRAINT IF EXISTS "attendance_records_type_check";

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_type_check"
  CHECK ("attendance_type" IN ('normal', 'partial_leave', 'leave', 'absent', 'rest'));
