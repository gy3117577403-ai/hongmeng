CREATE TYPE "daily_shipment_association_type" AS ENUM (
    'AUTO_DUE_DATE',
    'MANUAL',
    'CARRYOVER',
    'DUE_DATE_CHANGE'
);

ALTER TABLE "daily_shipment_plan_items"
ADD COLUMN "association_type" "daily_shipment_association_type" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "association_key" TEXT,
ADD COLUMN "due_date_snapshot" DATE,
ADD COLUMN "delivery_version_snapshot" INTEGER;

UPDATE "daily_shipment_plan_items" AS item
SET
    "association_type" = CASE
        WHEN item."carryover_source_item_id" IS NOT NULL THEN 'CARRYOVER'::"daily_shipment_association_type"
        ELSE 'MANUAL'::"daily_shipment_association_type"
    END,
    "due_date_snapshot" = plan_order."customer_due_date",
    "delivery_version_snapshot" = plan_order."delivery_version"
FROM "production_plan_batches" AS batch
JOIN "production_plan_orders" AS plan_order
  ON plan_order."id" = batch."plan_order_id"
WHERE batch."id" = item."production_plan_batch_id";

CREATE UNIQUE INDEX "daily_shipment_plan_items_association_key_key"
ON "daily_shipment_plan_items"("association_key");

CREATE INDEX "daily_shipment_plan_items_status_planned_ship_at_idx"
ON "daily_shipment_plan_items"("status", "planned_ship_at");

CREATE INDEX "daily_shipment_plan_items_association_type_status_idx"
ON "daily_shipment_plan_items"("association_type", "status");

CREATE INDEX "daily_shipment_plan_items_due_date_snapshot_status_idx"
ON "daily_shipment_plan_items"("due_date_snapshot", "status");
