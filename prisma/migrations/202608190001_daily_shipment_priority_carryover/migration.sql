CREATE TYPE "daily_shipment_priority" AS ENUM (
  'URGENT',
  'PRIORITY',
  'NORMAL'
);

ALTER TYPE "daily_shipment_plan_status" ADD VALUE IF NOT EXISTS 'CLOSED_WITH_CARRYOVER';
ALTER TYPE "daily_shipment_item_status" ADD VALUE IF NOT EXISTS 'CARRIED_OVER';

ALTER TABLE "daily_shipment_plan_items"
  ADD COLUMN "shipment_priority" "daily_shipment_priority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "carryover_source_item_id" TEXT,
  ADD COLUMN "carryover_source_date" DATE,
  ADD COLUMN "carryover_day_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "carryover_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "daily_shipment_plan_items_carryover_day_count_check"
    CHECK ("carryover_day_count" >= 0),
  ADD CONSTRAINT "daily_shipment_plan_items_carryover_quantity_check"
    CHECK ("carryover_quantity" >= 0),
  ADD CONSTRAINT "daily_shipment_plan_items_carryover_shape_check"
    CHECK (
      ("carryover_source_item_id" IS NULL AND "carryover_source_date" IS NULL AND "carryover_day_count" = 0 AND "carryover_quantity" = 0)
      OR
      ("carryover_source_item_id" IS NOT NULL AND "carryover_source_date" IS NOT NULL AND "carryover_day_count" > 0 AND "carryover_quantity" > 0)
    );

CREATE UNIQUE INDEX "daily_shipment_plan_items_carryover_source_item_id_key"
  ON "daily_shipment_plan_items"("carryover_source_item_id");
CREATE INDEX "daily_shipment_plan_items_shipment_priority_status_planned_ship_at_idx"
  ON "daily_shipment_plan_items"("shipment_priority", "status", "planned_ship_at");
CREATE INDEX "daily_shipment_plan_items_carryover_source_date_idx"
  ON "daily_shipment_plan_items"("carryover_source_date");

ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_carryover_source_item_id_fkey"
  FOREIGN KEY ("carryover_source_item_id") REFERENCES "daily_shipment_plan_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
