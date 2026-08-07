CREATE TYPE "daily_shipment_plan_status" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE "daily_shipment_item_status" AS ENUM (
  'PLANNED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'CANCELLED'
);

CREATE TYPE "shipment_event_type" AS ENUM ('SHIPMENT', 'REVERSAL');

CREATE TABLE "daily_shipment_plans" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "ship_date" DATE NOT NULL,
  "status" "daily_shipment_plan_status" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_id" TEXT,
  "closed_at" TIMESTAMP(3),
  "closed_by_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_shipment_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_shipment_plans_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "daily_shipment_plan_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "plan_id" TEXT NOT NULL,
  "production_plan_batch_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "planned_quantity" INTEGER NOT NULL,
  "planned_ship_at" TIMESTAMP(3) NOT NULL,
  "status" "daily_shipment_item_status" NOT NULL DEFAULT 'PLANNED',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "source_snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_shipment_plan_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_shipment_plan_items_quantity_check" CHECK ("planned_quantity" > 0),
  CONSTRAINT "daily_shipment_plan_items_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "daily_shipment_plan_items_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "shipment_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "item_id" TEXT NOT NULL,
  "event_type" "shipment_event_type" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "shipped_at" TIMESTAMP(3) NOT NULL,
  "reversal_of_event_id" TEXT,
  "reason" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_events_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "shipment_events_reversal_shape_check" CHECK (
    ("event_type" = 'SHIPMENT' AND "reversal_of_event_id" IS NULL)
    OR
    ("event_type" = 'REVERSAL' AND "reversal_of_event_id" IS NOT NULL AND LENGTH(BTRIM(COALESCE("reason", ''))) > 0)
  )
);

CREATE TABLE "daily_shipment_revisions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "plan_id" TEXT NOT NULL,
  "item_id" TEXT,
  "action" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" TEXT,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_shipment_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_shipment_revisions_action_check" CHECK (LENGTH(BTRIM("action")) > 0),
  CONSTRAINT "daily_shipment_revisions_payload_hash_check" CHECK (LENGTH(BTRIM("payload_hash")) > 0)
);

CREATE UNIQUE INDEX "daily_shipment_plans_ship_date_key"
  ON "daily_shipment_plans"("ship_date");
CREATE INDEX "daily_shipment_plans_status_ship_date_idx"
  ON "daily_shipment_plans"("status", "ship_date");
CREATE INDEX "daily_shipment_plans_confirmed_by_id_idx"
  ON "daily_shipment_plans"("confirmed_by_id");
CREATE INDEX "daily_shipment_plans_closed_by_id_idx"
  ON "daily_shipment_plans"("closed_by_id");

CREATE UNIQUE INDEX "daily_shipment_plan_items_plan_id_production_plan_batch_id_key"
  ON "daily_shipment_plan_items"("plan_id", "production_plan_batch_id");
CREATE INDEX "daily_shipment_plan_items_production_plan_batch_id_status_idx"
  ON "daily_shipment_plan_items"("production_plan_batch_id", "status");
CREATE INDEX "daily_shipment_plan_items_work_order_id_status_idx"
  ON "daily_shipment_plan_items"("work_order_id", "status");
CREATE INDEX "daily_shipment_plan_items_planned_ship_at_status_idx"
  ON "daily_shipment_plan_items"("planned_ship_at", "status");

CREATE UNIQUE INDEX "shipment_events_idempotency_key_key"
  ON "shipment_events"("idempotency_key");
CREATE INDEX "shipment_events_item_id_created_at_idx"
  ON "shipment_events"("item_id", "created_at");
CREATE INDEX "shipment_events_reversal_of_event_id_idx"
  ON "shipment_events"("reversal_of_event_id");
CREATE INDEX "shipment_events_actor_id_idx"
  ON "shipment_events"("actor_id");

CREATE UNIQUE INDEX "daily_shipment_revisions_idempotency_key_key"
  ON "daily_shipment_revisions"("idempotency_key");
CREATE INDEX "daily_shipment_revisions_plan_id_created_at_idx"
  ON "daily_shipment_revisions"("plan_id", "created_at");
CREATE INDEX "daily_shipment_revisions_item_id_created_at_idx"
  ON "daily_shipment_revisions"("item_id", "created_at");
CREATE INDEX "daily_shipment_revisions_actor_id_idx"
  ON "daily_shipment_revisions"("actor_id");

ALTER TABLE "daily_shipment_plans"
  ADD CONSTRAINT "daily_shipment_plans_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plans"
  ADD CONSTRAINT "daily_shipment_plans_closed_by_id_fkey"
  FOREIGN KEY ("closed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plans"
  ADD CONSTRAINT "daily_shipment_plans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plans"
  ADD CONSTRAINT "daily_shipment_plans_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "daily_shipment_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_production_plan_batch_id_fkey"
  FOREIGN KEY ("production_plan_batch_id") REFERENCES "production_plan_batches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_plan_items"
  ADD CONSTRAINT "daily_shipment_plan_items_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipment_events"
  ADD CONSTRAINT "shipment_events_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "daily_shipment_plan_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_events"
  ADD CONSTRAINT "shipment_events_reversal_of_event_id_fkey"
  FOREIGN KEY ("reversal_of_event_id") REFERENCES "shipment_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_events"
  ADD CONSTRAINT "shipment_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "daily_shipment_revisions"
  ADD CONSTRAINT "daily_shipment_revisions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "daily_shipment_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_revisions"
  ADD CONSTRAINT "daily_shipment_revisions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "daily_shipment_plan_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_shipment_revisions"
  ADD CONSTRAINT "daily_shipment_revisions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
