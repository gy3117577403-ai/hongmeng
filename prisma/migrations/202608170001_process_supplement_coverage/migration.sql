CREATE TYPE "process_supplement_fulfillment_mode" AS ENUM (
  'ACTUAL',
  'MIXED',
  'SYSTEM_COVERED',
  'FUTURE_ONLY',
  'RECALL_REQUIRED'
);

ALTER TABLE "product_process_time_entries"
  ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "work_order_process_steps"
  ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "process_supplement_obligations"
  ADD COLUMN "system_covered_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fulfillment_mode" "process_supplement_fulfillment_mode" NOT NULL DEFAULT 'ACTUAL',
  ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "process_supplement_obligations"
  ADD CONSTRAINT "process_supplement_obligations_system_covered_qty_check"
  CHECK ("system_covered_qty" >= 0 AND "system_covered_qty" <= "required_qty");

CREATE TABLE "process_supplement_coverages" (
  "id" TEXT NOT NULL,
  "obligation_id" TEXT NOT NULL,
  "deployment_route_id" TEXT,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "display_step_id" TEXT NOT NULL,
  "policy" TEXT NOT NULL,
  "fulfillment_mode" "process_supplement_fulfillment_mode" NOT NULL,
  "route_target_qty" INTEGER NOT NULL,
  "system_covered_qty" INTEGER NOT NULL,
  "actual_required_qty" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "process_supplement_coverages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_supplement_coverages_quantity_check"
    CHECK (
      "route_target_qty" >= 0
      AND "system_covered_qty" >= 0
      AND "actual_required_qty" >= 0
      AND "system_covered_qty" + "actual_required_qty" <= "route_target_qty"
    )
);

CREATE UNIQUE INDEX "process_supplement_coverages_obligation_id_key"
  ON "process_supplement_coverages"("obligation_id");
CREATE INDEX "process_supplement_coverages_deployment_route_id_created_at_idx"
  ON "process_supplement_coverages"("deployment_route_id", "created_at");
CREATE INDEX "process_supplement_coverages_work_order_id_created_at_idx"
  ON "process_supplement_coverages"("work_order_id", "created_at");
CREATE INDEX "process_supplement_coverages_route_id_created_at_idx"
  ON "process_supplement_coverages"("route_id", "created_at");
CREATE INDEX "process_supplement_coverages_display_step_id_created_at_idx"
  ON "process_supplement_coverages"("display_step_id", "created_at");
CREATE INDEX "process_supplement_coverages_actor_id_idx"
  ON "process_supplement_coverages"("actor_id");

ALTER TABLE "process_supplement_coverages"
  ADD CONSTRAINT "process_supplement_coverages_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "process_supplement_obligations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_supplement_coverages"
  ADD CONSTRAINT "process_supplement_coverages_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
