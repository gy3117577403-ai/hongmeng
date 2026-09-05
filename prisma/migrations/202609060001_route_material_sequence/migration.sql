-- Display order may change after reporting. Preserve the existing material
-- ledger order without rewriting reports, quantities or movement history.
ALTER TABLE "work_order_process_steps" ADD COLUMN "material_sequence_group" INTEGER;
