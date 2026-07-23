ALTER TABLE "product_process_time_entries"
ADD COLUMN "time_basis" TEXT NOT NULL DEFAULT 'per_unit';

ALTER TABLE "product_process_time_entries"
ADD CONSTRAINT "product_process_time_entries_time_basis_check"
CHECK ("time_basis" IN ('per_unit', 'per_batch'));
