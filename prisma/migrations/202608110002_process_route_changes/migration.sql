ALTER TYPE "process_completion_source" ADD VALUE 'SUPPLEMENT_OBLIGATION';

CREATE TYPE "process_route_change_status" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ACTIVATING',
  'ACTIVE',
  'FAILED'
);

CREATE TYPE "process_route_change_scope" AS ENUM (
  'CURRENT_WORK_ORDER_AND_FUTURE_PRODUCT',
  'CURRENT_WORK_ORDER_ONLY',
  'FUTURE_PRODUCT_ONLY'
);

CREATE TYPE "process_route_change_diff_kind" AS ENUM (
  'INSERT_STEP',
  'UPDATE_TIME',
  'MOVE_STEP'
);

CREATE TYPE "process_route_change_step_source" AS ENUM ('EXISTING', 'NEW');
CREATE TYPE "process_step_execution_mode" AS ENUM ('NORMAL', 'SUPPLEMENTAL_OBLIGATION');
CREATE TYPE "process_supplement_obligation_status" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED');
CREATE TYPE "process_route_change_outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

ALTER TABLE "work_order_process_steps"
  ADD COLUMN "execution_mode" "process_step_execution_mode" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "change_source" "process_route_change_step_source" NOT NULL DEFAULT 'EXISTING',
  ADD CONSTRAINT "work_order_process_steps_supplement_zero_quantity_check"
    CHECK (
      "execution_mode" <> 'SUPPLEMENTAL_OBLIGATION'
      OR (
        "input_qty" = 0
        AND "processed_qty" = 0
        AND "good_output_qty" = 0
        AND "defect_output_qty" = 0
        AND "released_good_qty" = 0
      )
    );

ALTER TABLE "process_completions"
  ADD COLUMN "supplement_obligation_id" TEXT;

CREATE TABLE "process_route_changes" (
  "id" TEXT NOT NULL,
  "change_request_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "status" "process_route_change_status" NOT NULL DEFAULT 'DRAFT',
  "scope" "process_route_change_scope" NOT NULL DEFAULT 'CURRENT_WORK_ORDER_AND_FUTURE_PRODUCT',
  "base_route_version" INTEGER NOT NULL,
  "activated_route_version" INTEGER,
  "source_product_time_profile_id" TEXT,
  "published_product_time_profile_id" TEXT,
  "base_product_profile_version" INTEGER,
  "published_product_profile_version" INTEGER,
  "route_snapshot" JSONB NOT NULL,
  "impact_snapshot" JSONB,
  "historical_labor_recalculation_pending" BOOLEAN NOT NULL DEFAULT false,
  "labor_correction_summary" JSONB,
  "review_decision" TEXT,
  "review_note" TEXT,
  "activation_error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "reviewed_by_id" TEXT,
  "activated_by_id" TEXT,
  "submitted_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "activation_started_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "process_route_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_route_change_diffs" (
  "id" TEXT NOT NULL,
  "change_id" TEXT NOT NULL,
  "kind" "process_route_change_diff_kind" NOT NULL,
  "source" "process_route_change_step_source" NOT NULL DEFAULT 'EXISTING',
  "position" INTEGER NOT NULL,
  "target_step_id" TEXT,
  "process_definition_id" TEXT,
  "before_data" JSONB,
  "after_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "process_route_change_diffs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_supplement_obligations" (
  "id" TEXT NOT NULL,
  "change_id" TEXT NOT NULL,
  "diff_id" TEXT NOT NULL,
  "work_order_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "display_step_id" TEXT NOT NULL,
  "insert_before_step_id" TEXT,
  "process_definition_id" TEXT NOT NULL,
  "source" "process_route_change_step_source" NOT NULL DEFAULT 'NEW',
  "process_code" TEXT NOT NULL,
  "process_name" TEXT NOT NULL,
  "stage_group" TEXT NOT NULL,
  "display_position" INTEGER NOT NULL,
  "intended_sequence_group" INTEGER NOT NULL,
  "required_qty" INTEGER NOT NULL,
  "reported_qty" INTEGER NOT NULL DEFAULT 0,
  "status" "process_supplement_obligation_status" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 0,
  "release_policy" TEXT NOT NULL DEFAULT 'NONE',
  "time_basis" TEXT NOT NULL DEFAULT 'per_unit',
  "unit_label" TEXT NOT NULL DEFAULT '件',
  "standard_milliseconds_per_unit" INTEGER NOT NULL,
  "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
  "units_per_product" INTEGER NOT NULL DEFAULT 1,
  "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
  "last_reported_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "process_supplement_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_supplement_obligations_quantity_check"
    CHECK ("required_qty" > 0 AND "reported_qty" >= 0 AND "reported_qty" <= "required_qty"),
  CONSTRAINT "process_supplement_obligations_release_check"
    CHECK ("release_policy" = 'NONE')
);

CREATE TABLE "process_route_change_events" (
  "id" TEXT NOT NULL,
  "change_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "from_status" "process_route_change_status",
  "to_status" "process_route_change_status",
  "actor_id" TEXT,
  "actor_snapshot" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "process_route_change_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "process_route_change_outbox" (
  "id" TEXT NOT NULL,
  "change_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WECOM_ROBOT',
  "dedupe_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "process_route_change_outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "process_route_change_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "process_route_changes_change_request_id_key" ON "process_route_changes"("change_request_id");
CREATE INDEX "process_route_changes_work_order_status_updated_idx" ON "process_route_changes"("work_order_id", "status", "updated_at");
CREATE INDEX "process_route_changes_route_status_idx" ON "process_route_changes"("route_id", "status");
CREATE INDEX "process_route_changes_status_updated_idx" ON "process_route_changes"("status", "updated_at");
CREATE INDEX "process_route_changes_created_by_idx" ON "process_route_changes"("created_by_id");
CREATE INDEX "process_route_changes_reviewed_by_idx" ON "process_route_changes"("reviewed_by_id");
CREATE INDEX "process_route_changes_activated_by_idx" ON "process_route_changes"("activated_by_id");

CREATE UNIQUE INDEX "process_route_change_diffs_change_position_key" ON "process_route_change_diffs"("change_id", "position");
CREATE INDEX "process_route_change_diffs_change_kind_idx" ON "process_route_change_diffs"("change_id", "kind");
CREATE INDEX "process_route_change_diffs_target_step_idx" ON "process_route_change_diffs"("target_step_id");
CREATE INDEX "process_route_change_diffs_process_definition_idx" ON "process_route_change_diffs"("process_definition_id");

CREATE UNIQUE INDEX "process_supplement_obligations_diff_id_key" ON "process_supplement_obligations"("diff_id");
CREATE UNIQUE INDEX "process_supplement_obligations_display_step_id_key" ON "process_supplement_obligations"("display_step_id");
CREATE INDEX "process_supplement_obligations_work_order_status_idx" ON "process_supplement_obligations"("work_order_id", "status", "display_position");
CREATE INDEX "process_supplement_obligations_route_status_idx" ON "process_supplement_obligations"("route_id", "status", "display_position");
CREATE INDEX "process_supplement_obligations_process_definition_idx" ON "process_supplement_obligations"("process_definition_id");
CREATE INDEX "process_supplement_obligations_change_id_idx" ON "process_supplement_obligations"("change_id");

CREATE UNIQUE INDEX "process_route_change_events_idempotency_key_key" ON "process_route_change_events"("idempotency_key");
CREATE INDEX "process_route_change_events_change_created_idx" ON "process_route_change_events"("change_id", "created_at");
CREATE INDEX "process_route_change_events_action_created_idx" ON "process_route_change_events"("action", "created_at");
CREATE INDEX "process_route_change_events_actor_idx" ON "process_route_change_events"("actor_id");

CREATE UNIQUE INDEX "process_route_change_outbox_dedupe_key_key" ON "process_route_change_outbox"("dedupe_key");
CREATE INDEX "process_route_change_outbox_status_available_idx" ON "process_route_change_outbox"("status", "available_at");
CREATE INDEX "process_route_change_outbox_change_created_idx" ON "process_route_change_outbox"("change_id", "created_at");

CREATE INDEX "work_order_process_steps_route_execution_status_idx" ON "work_order_process_steps"("route_id", "execution_mode", "status");
CREATE INDEX "work_order_process_steps_route_change_source_idx" ON "work_order_process_steps"("route_id", "change_source");
CREATE INDEX "process_completions_supplement_voided_idx" ON "process_completions"("supplement_obligation_id", "voided_at");

ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_source_profile_id_fkey" FOREIGN KEY ("source_product_time_profile_id") REFERENCES "product_time_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_published_profile_id_fkey" FOREIGN KEY ("published_product_time_profile_id") REFERENCES "product_time_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_changes" ADD CONSTRAINT "process_route_changes_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_route_change_diffs" ADD CONSTRAINT "process_route_change_diffs_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "process_route_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_route_change_diffs" ADD CONSTRAINT "process_route_change_diffs_target_step_id_fkey" FOREIGN KEY ("target_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_route_change_diffs" ADD CONSTRAINT "process_route_change_diffs_process_definition_id_fkey" FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "process_route_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_diff_id_fkey" FOREIGN KEY ("diff_id") REFERENCES "process_route_change_diffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_display_step_id_fkey" FOREIGN KEY ("display_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_insert_before_step_id_fkey" FOREIGN KEY ("insert_before_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "process_supplement_obligations" ADD CONSTRAINT "process_supplement_obligations_process_definition_id_fkey" FOREIGN KEY ("process_definition_id") REFERENCES "process_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_route_change_events" ADD CONSTRAINT "process_route_change_events_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "process_route_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_route_change_events" ADD CONSTRAINT "process_route_change_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "process_route_change_outbox" ADD CONSTRAINT "process_route_change_outbox_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "process_route_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_completions" ADD CONSTRAINT "process_completions_supplement_obligation_id_fkey" FOREIGN KEY ("supplement_obligation_id") REFERENCES "process_supplement_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
