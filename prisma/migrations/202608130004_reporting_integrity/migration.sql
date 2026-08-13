ALTER TABLE "work_order_process_routes"
  ADD COLUMN "reporting_policy" TEXT NOT NULL DEFAULT 'free_sequence';

ALTER TABLE "product_time_profiles"
  ADD COLUMN "reporting_policy" TEXT NOT NULL DEFAULT 'free_sequence';

ALTER TABLE "process_supplement_obligations"
  ADD COLUMN "reported_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reported_good_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reported_defect_unit_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "report_quantity_basis" TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN "report_unit_label" TEXT NOT NULL DEFAULT '件';

UPDATE "process_supplement_obligations"
SET
  "reported_unit_qty" = "reported_qty",
  "reported_good_unit_qty" = "reported_qty",
  "reported_defect_unit_qty" = 0,
  "report_quantity_basis" = 'product',
  "report_unit_label" = COALESCE(NULLIF("unit_label", ''), '件');

CREATE TABLE "process_action_consumptions" (
  "id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "source_completion_id" TEXT NOT NULL,
  "consumer_completion_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMP(3),
  "voided_by_id" TEXT,
  "void_reason" TEXT,
  CONSTRAINT "process_action_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_action_consumptions_idempotency_key_key"
  ON "process_action_consumptions"("idempotency_key");
CREATE UNIQUE INDEX "process_action_consumptions_source_consumer_key"
  ON "process_action_consumptions"("source_completion_id", "consumer_completion_id");
CREATE INDEX "process_action_consumptions_step_id_voided_at_idx"
  ON "process_action_consumptions"("step_id", "voided_at");
CREATE INDEX "process_action_consumptions_source_completion_id_voided_at_idx"
  ON "process_action_consumptions"("source_completion_id", "voided_at");
CREATE INDEX "process_action_consumptions_consumer_completion_id_voided_at_idx"
  ON "process_action_consumptions"("consumer_completion_id", "voided_at");

ALTER TABLE "process_action_consumptions"
  ADD CONSTRAINT "process_action_consumptions_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_action_consumptions"
  ADD CONSTRAINT "process_action_consumptions_source_completion_id_fkey"
  FOREIGN KEY ("source_completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_action_consumptions"
  ADD CONSTRAINT "process_action_consumptions_consumer_completion_id_fkey"
  FOREIGN KEY ("consumer_completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Automatic completion labor is split equally by time across every selected
-- participant. With indivisible product quantities, a participant may own
-- labor while their informational quantity share is zero.
ALTER TABLE "process_labor_claims"
  DROP CONSTRAINT IF EXISTS "process_labor_claims_values_valid";
ALTER TABLE "process_labor_claims"
  ADD CONSTRAINT "process_labor_claims_values_valid" CHECK (
    (
      "status" = 'REVERSAL'
      AND "quantity" <= 0
      AND "standard_labor_milliseconds" < 0
      AND "reversal_of_id" IS NOT NULL
    )
    OR
    (
      "status" IN ('ACTIVE', 'VOIDED')
      AND "quantity" >= 0
      AND "standard_labor_milliseconds" > 0
      AND "reversal_of_id" IS NULL
    )
  );
ALTER TABLE "process_labor_claims"
  DROP CONSTRAINT IF EXISTS "process_labor_claims_void_metadata_valid";
ALTER TABLE "process_labor_claims"
  ADD CONSTRAINT "process_labor_claims_void_metadata_valid" CHECK (
    "status" <> 'VOIDED'
    OR ("voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL)
  );

-- A named principal is valid for every reporting channel. Shared-terminal PIN
-- reports additionally require the terminal and credential-version evidence;
-- those two fields must remain absent for every other channel.
ALTER TABLE "process_completions"
  DROP CONSTRAINT IF EXISTS "process_completions_shared_terminal_attribution_check";
ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_shared_terminal_attribution_check" CHECK (
    (
      "report_source"::text = 'SHARED_TERMINAL_PIN'
      AND "principal_employee_id" IS NOT NULL
      AND "field_report_terminal_id" IS NOT NULL
      AND "pin_credential_version" IS NOT NULL
    )
    OR
    (
      "report_source"::text <> 'SHARED_TERMINAL_PIN'
      AND "field_report_terminal_id" IS NULL
      AND "pin_credential_version" IS NULL
    )
  );

ALTER TABLE "work_order_process_routes"
  ADD CONSTRAINT "work_order_process_routes_reporting_policy_check"
  CHECK ("reporting_policy" IN ('free_sequence', 'strict_sequence'));
ALTER TABLE "product_time_profiles"
  ADD CONSTRAINT "product_time_profiles_reporting_policy_check"
  CHECK ("reporting_policy" IN ('free_sequence', 'strict_sequence'));
ALTER TABLE "process_supplement_obligations"
  ADD CONSTRAINT "process_supplement_obligations_report_basis_check"
  CHECK ("report_quantity_basis" IN ('product', 'action'));
ALTER TABLE "process_supplement_obligations"
  ADD CONSTRAINT "process_supplement_obligations_reported_units_check"
  CHECK (
    "reported_unit_qty" >= 0
    AND "reported_good_unit_qty" >= 0
    AND "reported_defect_unit_qty" >= 0
    AND "reported_unit_qty" = "reported_good_unit_qty" + "reported_defect_unit_qty"
  );
ALTER TABLE "process_action_consumptions"
  ADD CONSTRAINT "process_action_consumptions_quantity_check" CHECK ("quantity" > 0);
