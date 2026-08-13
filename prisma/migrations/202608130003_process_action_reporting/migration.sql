ALTER TABLE "product_process_time_entries"
  ADD COLUMN "report_quantity_basis" TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN "report_unit_label" TEXT NOT NULL DEFAULT '个';

ALTER TABLE "work_order_process_steps"
  ADD COLUMN "report_quantity_basis" TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN "report_unit_label" TEXT NOT NULL DEFAULT '件';

ALTER TABLE "process_completions"
  ADD COLUMN "reported_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reported_good_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reported_defect_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "report_quantity_basis" TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN "report_unit_label" TEXT NOT NULL DEFAULT '件';

UPDATE "product_process_time_entries"
SET "report_unit_label" = COALESCE(NULLIF("unit_label", ''), '个');

UPDATE "work_order_process_steps"
SET "report_unit_label" = COALESCE(NULLIF("unit_label", ''), '件');

ALTER TABLE "process_completions"
  DROP CONSTRAINT "process_completions_quantities_valid";

UPDATE "process_completions"
SET
  "reported_unit_qty" = "processed_qty",
  "reported_good_unit_qty" = "good_qty",
  "reported_defect_unit_qty" = "defect_qty",
  "report_quantity_basis" = 'product',
  "report_unit_label" = COALESCE(NULLIF("unit_label", ''), '件');

ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_quantities_valid" CHECK (
    "processed_qty" >= 0
    AND "good_qty" >= 0
    AND "defect_qty" >= 0
    AND "processed_qty" = "good_qty" + "defect_qty"
    AND ("processed_qty" > 0 OR "reported_unit_qty" > 0)
  ),
  ADD CONSTRAINT "process_completions_reported_units_valid" CHECK (
    "reported_unit_qty" >= 0
    AND "reported_good_unit_qty" >= 0
    AND "reported_defect_unit_qty" >= 0
    AND "reported_unit_qty" = "reported_good_unit_qty" + "reported_defect_unit_qty"
  ),
  ADD CONSTRAINT "process_completions_report_quantity_basis_valid" CHECK (
    "report_quantity_basis" IN ('product', 'action')
    AND (
      "report_quantity_basis" <> 'product'
      OR (
        "reported_unit_qty" = "processed_qty"
        AND "reported_good_unit_qty" = "good_qty"
        AND "reported_defect_unit_qty" = "defect_qty"
      )
    )
  );

ALTER TABLE "product_process_time_entries"
  ADD CONSTRAINT "product_process_time_entries_report_quantity_basis_valid" CHECK (
    "report_quantity_basis" IN ('product', 'action')
  );

ALTER TABLE "work_order_process_steps"
  ADD CONSTRAINT "work_order_process_steps_report_quantity_basis_valid" CHECK (
    "report_quantity_basis" IN ('product', 'action')
  );
