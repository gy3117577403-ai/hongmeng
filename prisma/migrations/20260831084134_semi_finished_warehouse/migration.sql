CREATE TYPE "semi_finished_lot_kind" AS ENUM (
  'WAITING_PRODUCTION',
  'SEMI_FINISHED'
);

CREATE TYPE "semi_finished_physical_status" AS ENUM (
  'VIRTUAL',
  'STORED',
  'ISSUED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "semi_finished_schedule_status" AS ENUM (
  'UNSCHEDULED',
  'PARTIALLY_SCHEDULED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "wip_requirement_status" AS ENUM (
  'UNSCHEDULED',
  'PARTIALLY_SCHEDULED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "wip_week_allocation_status" AS ENUM (
  'ACTIVE',
  'IN_PROGRESS',
  'COMPLETED',
  'SUPERSEDED',
  'CANCELLED'
);

CREATE TABLE "semi_finished_lots" (
  "id" TEXT NOT NULL,
  "lot_no" TEXT NOT NULL,
  "kind" "semi_finished_lot_kind" NOT NULL DEFAULT 'SEMI_FINISHED',
  "production_plan_batch_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "route_version" INTEGER NOT NULL,
  "source_week_start_date" DATE NOT NULL,
  "source_week_end_date" DATE NOT NULL,
  "quantity" INTEGER NOT NULL,
  "completed_step_ids" JSONB NOT NULL DEFAULT '[]',
  "last_completed_position" INTEGER,
  "next_step_ids" JSONB NOT NULL DEFAULT '[]',
  "location_code" TEXT,
  "container_code" TEXT,
  "material_status_snapshot" TEXT,
  "physical_status" "semi_finished_physical_status" NOT NULL DEFAULT 'VIRTUAL',
  "schedule_status" "semi_finished_schedule_status" NOT NULL DEFAULT 'UNSCHEDULED',
  "reason_code" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "entered_by_id" TEXT NOT NULL,
  "closed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "semi_finished_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semi_finished_lots_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "semi_finished_lots_route_version_check" CHECK ("route_version" >= 0),
  CONSTRAINT "semi_finished_lots_week_check" CHECK ("source_week_end_date" >= "source_week_start_date"),
  CONSTRAINT "semi_finished_lots_version_check" CHECK ("version" >= 0),
  CONSTRAINT "semi_finished_lots_reason_check" CHECK (char_length(btrim("reason")) >= 2)
);

CREATE TABLE "semi_finished_lot_steps" (
  "id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "route_version" INTEGER NOT NULL,
  "process_code" TEXT NOT NULL,
  "process_name" TEXT NOT NULL,
  "stage_group" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "sequence_group" INTEGER NOT NULL,
  "time_basis" TEXT NOT NULL,
  "standard_milliseconds_per_unit" INTEGER NOT NULL,
  "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
  "units_per_product" INTEGER NOT NULL DEFAULT 1,
  "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
  "planned_qty" INTEGER NOT NULL,
  "processed_qty_at_entry" INTEGER NOT NULL DEFAULT 0,
  "good_output_qty_at_entry" INTEGER NOT NULL DEFAULT 0,
  "remaining_qty" INTEGER NOT NULL,
  "remaining_standard_milliseconds" BIGINT NOT NULL,
  "status" "wip_requirement_status" NOT NULL DEFAULT 'UNSCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "semi_finished_lot_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semi_finished_lot_steps_quantity_check" CHECK (
    "planned_qty" > 0
    AND "processed_qty_at_entry" >= 0
    AND "good_output_qty_at_entry" >= 0
    AND "remaining_qty" >= 0
    AND "remaining_qty" <= "planned_qty"
  ),
  CONSTRAINT "semi_finished_lot_steps_time_check" CHECK (
    "standard_milliseconds_per_unit" >= 0
    AND "setup_milliseconds" >= 0
    AND "units_per_product" > 0
    AND "remaining_standard_milliseconds" >= 0
    AND "time_basis" IN ('per_unit', 'per_batch')
  )
);

CREATE TABLE "wip_week_allocations" (
  "id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL,
  "source_allocation_id" TEXT,
  "target_week_start_date" DATE NOT NULL,
  "target_week_end_date" DATE NOT NULL,
  "team_id" TEXT,
  "quantity" INTEGER NOT NULL,
  "planned_standard_milliseconds" BIGINT NOT NULL,
  "completed_qty" INTEGER NOT NULL DEFAULT 0,
  "completed_standard_milliseconds" BIGINT NOT NULL DEFAULT 0,
  "status" "wip_week_allocation_status" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "scheduled_by_id" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wip_week_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wip_week_allocations_quantity_check" CHECK (
    "quantity" > 0
    AND "completed_qty" >= 0
    AND "completed_qty" <= "quantity"
  ),
  CONSTRAINT "wip_week_allocations_time_check" CHECK (
    "planned_standard_milliseconds" >= 0
    AND "completed_standard_milliseconds" >= 0
  ),
  CONSTRAINT "wip_week_allocations_week_check" CHECK ("target_week_end_date" >= "target_week_start_date"),
  CONSTRAINT "wip_week_allocations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "wip_week_allocations_reason_check" CHECK (char_length(btrim("reason")) >= 2)
);

CREATE TABLE "wip_week_allocation_steps" (
  "id" TEXT NOT NULL,
  "allocation_id" TEXT NOT NULL,
  "lot_step_id" TEXT NOT NULL,
  "planned_qty" INTEGER NOT NULL,
  "planned_standard_milliseconds" BIGINT NOT NULL,
  "completed_qty" INTEGER NOT NULL DEFAULT 0,
  "completed_standard_milliseconds" BIGINT NOT NULL DEFAULT 0,
  "status" "wip_requirement_status" NOT NULL DEFAULT 'SCHEDULED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wip_week_allocation_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wip_week_allocation_steps_quantity_check" CHECK (
    "planned_qty" > 0
    AND "completed_qty" >= 0
    AND "completed_qty" <= "planned_qty"
  ),
  CONSTRAINT "wip_week_allocation_steps_time_check" CHECK (
    "planned_standard_milliseconds" >= 0
    AND "completed_standard_milliseconds" >= 0
  )
);

CREATE TABLE "process_wip_credits" (
  "id" TEXT NOT NULL,
  "completion_id" TEXT NOT NULL,
  "allocation_step_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "standard_milliseconds" BIGINT NOT NULL,
  "work_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMP(3),

  CONSTRAINT "process_wip_credits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_wip_credits_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "process_wip_credits_time_check" CHECK ("standard_milliseconds" >= 0),
  CONSTRAINT "process_wip_credits_status_check" CHECK ("status" IN ('ACTIVE', 'VOIDED'))
);

CREATE TABLE "wip_inventory_movements" (
  "id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL,
  "movement_type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "from_location" TEXT,
  "to_location" TEXT,
  "reason" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wip_inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wip_inventory_movements_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "wip_inventory_movements_type_check" CHECK ("movement_type" IN ('ENTER', 'SCHEDULE', 'RESCHEDULE', 'ISSUE', 'COMPLETE', 'CANCEL')),
  CONSTRAINT "wip_inventory_movements_reason_check" CHECK (char_length(btrim("reason")) >= 2)
);

CREATE TABLE "wip_events" (
  "id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL,
  "allocation_id" TEXT,
  "event_type" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "actor_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wip_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wip_events_reason_check" CHECK (char_length(btrim("reason")) >= 2)
);

CREATE UNIQUE INDEX "semi_finished_lots_lot_no_key" ON "semi_finished_lots"("lot_no");
CREATE UNIQUE INDEX "semi_finished_lots_container_code_key" ON "semi_finished_lots"("container_code");
CREATE INDEX "semi_finished_lots_work_order_id_schedule_status_idx" ON "semi_finished_lots"("work_order_id", "schedule_status");
CREATE INDEX "semi_finished_lots_production_plan_batch_id_schedule_status_idx" ON "semi_finished_lots"("production_plan_batch_id", "schedule_status");
CREATE INDEX "semi_finished_lots_source_week_start_date_schedule_status_idx" ON "semi_finished_lots"("source_week_start_date", "schedule_status");
CREATE INDEX "semi_finished_lots_physical_schedule_entered_idx" ON "semi_finished_lots"("physical_status", "schedule_status", "entered_at");
CREATE INDEX "semi_finished_lots_entered_by_id_idx" ON "semi_finished_lots"("entered_by_id");

CREATE UNIQUE INDEX "semi_finished_lot_steps_lot_id_step_id_key" ON "semi_finished_lot_steps"("lot_id", "step_id");
CREATE INDEX "semi_finished_lot_steps_step_id_status_idx" ON "semi_finished_lot_steps"("step_id", "status");
CREATE INDEX "semi_finished_lot_steps_lot_id_status_position_idx" ON "semi_finished_lot_steps"("lot_id", "status", "position");

CREATE UNIQUE INDEX "wip_week_allocations_idempotency_key_key" ON "wip_week_allocations"("idempotency_key");
CREATE INDEX "wip_week_allocations_lot_id_status_idx" ON "wip_week_allocations"("lot_id", "status");
CREATE INDEX "wip_week_allocations_target_week_start_status_idx" ON "wip_week_allocations"("target_week_start_date", "status");
CREATE INDEX "wip_week_allocations_team_target_week_status_idx" ON "wip_week_allocations"("team_id", "target_week_start_date", "status");
CREATE INDEX "wip_week_allocations_source_allocation_id_idx" ON "wip_week_allocations"("source_allocation_id");
CREATE INDEX "wip_week_allocations_scheduled_by_id_idx" ON "wip_week_allocations"("scheduled_by_id");

CREATE UNIQUE INDEX "wip_week_allocation_steps_allocation_lot_step_key" ON "wip_week_allocation_steps"("allocation_id", "lot_step_id");
CREATE INDEX "wip_week_allocation_steps_lot_step_status_idx" ON "wip_week_allocation_steps"("lot_step_id", "status");

CREATE UNIQUE INDEX "process_wip_credits_idempotency_key_key" ON "process_wip_credits"("idempotency_key");
CREATE UNIQUE INDEX "process_wip_credits_completion_allocation_step_key" ON "process_wip_credits"("completion_id", "allocation_step_id");
CREATE INDEX "process_wip_credits_allocation_step_status_idx" ON "process_wip_credits"("allocation_step_id", "status");
CREATE INDEX "process_wip_credits_work_date_status_idx" ON "process_wip_credits"("work_date", "status");

CREATE UNIQUE INDEX "wip_inventory_movements_idempotency_key_key" ON "wip_inventory_movements"("idempotency_key");
CREATE INDEX "wip_inventory_movements_lot_created_idx" ON "wip_inventory_movements"("lot_id", "created_at");
CREATE INDEX "wip_inventory_movements_actor_id_idx" ON "wip_inventory_movements"("actor_id");

CREATE UNIQUE INDEX "wip_events_idempotency_key_key" ON "wip_events"("idempotency_key");
CREATE INDEX "wip_events_lot_created_idx" ON "wip_events"("lot_id", "created_at");
CREATE INDEX "wip_events_allocation_created_idx" ON "wip_events"("allocation_id", "created_at");
CREATE INDEX "wip_events_actor_id_idx" ON "wip_events"("actor_id");

ALTER TABLE "semi_finished_lots" ADD CONSTRAINT "semi_finished_lots_batch_id_fkey"
  FOREIGN KEY ("production_plan_batch_id") REFERENCES "production_plan_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "semi_finished_lots" ADD CONSTRAINT "semi_finished_lots_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "semi_finished_lots" ADD CONSTRAINT "semi_finished_lots_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "semi_finished_lots" ADD CONSTRAINT "semi_finished_lots_entered_by_id_fkey"
  FOREIGN KEY ("entered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "semi_finished_lot_steps" ADD CONSTRAINT "semi_finished_lot_steps_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "semi_finished_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semi_finished_lot_steps" ADD CONSTRAINT "semi_finished_lot_steps_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_week_allocations" ADD CONSTRAINT "wip_week_allocations_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "semi_finished_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wip_week_allocations" ADD CONSTRAINT "wip_week_allocations_source_id_fkey"
  FOREIGN KEY ("source_allocation_id") REFERENCES "wip_week_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wip_week_allocations" ADD CONSTRAINT "wip_week_allocations_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "production_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wip_week_allocations" ADD CONSTRAINT "wip_week_allocations_scheduled_by_id_fkey"
  FOREIGN KEY ("scheduled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_week_allocation_steps" ADD CONSTRAINT "wip_week_allocation_steps_allocation_id_fkey"
  FOREIGN KEY ("allocation_id") REFERENCES "wip_week_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wip_week_allocation_steps" ADD CONSTRAINT "wip_week_allocation_steps_lot_step_id_fkey"
  FOREIGN KEY ("lot_step_id") REFERENCES "semi_finished_lot_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_wip_credits" ADD CONSTRAINT "process_wip_credits_completion_id_fkey"
  FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_wip_credits" ADD CONSTRAINT "process_wip_credits_allocation_step_id_fkey"
  FOREIGN KEY ("allocation_step_id") REFERENCES "wip_week_allocation_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_inventory_movements" ADD CONSTRAINT "wip_inventory_movements_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "semi_finished_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wip_inventory_movements" ADD CONSTRAINT "wip_inventory_movements_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wip_events" ADD CONSTRAINT "wip_events_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "semi_finished_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wip_events" ADD CONSTRAINT "wip_events_allocation_id_fkey"
  FOREIGN KEY ("allocation_id") REFERENCES "wip_week_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wip_events" ADD CONSTRAINT "wip_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
