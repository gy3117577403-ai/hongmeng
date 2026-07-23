-- Decouple supervisor-confirmed process output from employee labor claiming.
-- All new production facts are append-oriented and support soft void/reversal.

CREATE TYPE "work_order_branch_type" AS ENUM (
    'REWORK',
    'SCRAP_REPLENISH',
    'QUALITY_PENDING'
);

CREATE TYPE "work_order_branch_status" AS ENUM (
    'OPEN',
    'RELEASED',
    'IN_PROGRESS',
    'QUALITY_PENDING',
    'RESOLVED',
    'CANCELLED'
);

CREATE TYPE "process_defect_disposition" AS ENUM (
    'REWORK',
    'SCRAP_REPLENISH',
    'QUALITY_PENDING'
);

CREATE TYPE "process_movement_type" AS ENUM (
    'GOOD_TRANSFER',
    'FINISHED_GOOD',
    'REWORK_SPLIT',
    'SCRAP_REPLENISH_SPLIT',
    'QUALITY_HOLD',
    'REWORK_RETURN',
    'SCRAP',
    'ADJUSTMENT',
    'REVERSAL'
);

CREATE TYPE "process_labor_pool_status" AS ENUM (
    'OPEN',
    'PARTIAL',
    'EXHAUSTED',
    'LOCKED',
    'VOIDED'
);

CREATE TYPE "process_labor_claim_status" AS ENUM (
    'ACTIVE',
    'VOIDED',
    'REVERSAL'
);

ALTER TABLE "work_orders"
ADD COLUMN "parent_work_order_id" TEXT,
ADD COLUMN "root_work_order_id" TEXT,
ADD COLUMN "branch_type" "work_order_branch_type",
ADD COLUMN "branch_status" "work_order_branch_status",
ADD COLUMN "origin_completion_id" TEXT,
ADD COLUMN "origin_step_id" TEXT,
ADD COLUMN "rejoin_step_id" TEXT,
ADD COLUMN "branch_sequence" INTEGER;

ALTER TABLE "work_order_process_steps"
ADD COLUMN "input_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processed_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "good_output_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "defect_output_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "released_good_qty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "quantity_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "work_orders"
ADD CONSTRAINT "work_orders_branch_sequence_positive"
CHECK ("branch_sequence" IS NULL OR "branch_sequence" > 0),
ADD CONSTRAINT "work_orders_branch_not_self_parent"
CHECK ("parent_work_order_id" IS NULL OR "parent_work_order_id" <> "id"),
ADD CONSTRAINT "work_orders_branch_not_self_root"
CHECK ("root_work_order_id" IS NULL OR "root_work_order_id" <> "id"),
ADD CONSTRAINT "work_orders_branch_metadata_complete"
CHECK (
    (
        "branch_type" IS NULL
        AND "branch_status" IS NULL
        AND "parent_work_order_id" IS NULL
        AND "root_work_order_id" IS NULL
        AND "origin_completion_id" IS NULL
        AND "origin_step_id" IS NULL
        AND "rejoin_step_id" IS NULL
        AND "branch_sequence" IS NULL
    )
    OR
    (
        "branch_type" IS NOT NULL
        AND "branch_status" IS NOT NULL
        AND "parent_work_order_id" IS NOT NULL
        AND "root_work_order_id" IS NOT NULL
        AND "origin_completion_id" IS NOT NULL
        AND "origin_step_id" IS NOT NULL
        AND "branch_sequence" IS NOT NULL
    )
);

ALTER TABLE "work_order_process_steps"
ADD CONSTRAINT "process_steps_quantity_state_valid"
CHECK (
    "input_qty" >= 0
    AND "processed_qty" >= 0
    AND "good_output_qty" >= 0
    AND "defect_output_qty" >= 0
    AND "released_good_qty" >= 0
    AND "quantity_version" >= 0
    AND "processed_qty" = "good_output_qty" + "defect_output_qty"
    AND "processed_qty" <= "input_qty"
    AND "released_good_qty" <= "good_output_qty"
);

CREATE TABLE "process_completions" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_qty" INTEGER NOT NULL,
    "good_qty" INTEGER NOT NULL,
    "defect_qty" INTEGER NOT NULL,
    "defect_disposition" "process_defect_disposition",
    "route_version" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "standard_time_id" TEXT,
    "standard_version" INTEGER,
    "product_time_profile_id" TEXT,
    "product_time_entry_id" TEXT,
    "product_time_profile_version" INTEGER,
    "standard_source" TEXT NOT NULL,
    "time_basis" TEXT,
    "unit_label" TEXT,
    "standard_milliseconds_per_unit" INTEGER,
    "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "units_per_product" INTEGER NOT NULL DEFAULT 1,
    "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "process_completions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_completions_quantities_valid" CHECK (
        "processed_qty" > 0
        AND "good_qty" >= 0
        AND "defect_qty" >= 0
        AND "processed_qty" = "good_qty" + "defect_qty"
    ),
    CONSTRAINT "process_completions_defect_valid" CHECK (
        ("defect_qty" = 0 AND "defect_disposition" IS NULL)
        OR ("defect_qty" > 0 AND "defect_disposition" IS NOT NULL)
    ),
    CONSTRAINT "process_completions_route_version_valid" CHECK ("route_version" >= 0),
    CONSTRAINT "process_completions_standard_version_valid" CHECK (
        "standard_version" IS NULL OR "standard_version" > 0
    ),
    CONSTRAINT "process_completions_profile_version_valid" CHECK (
        "product_time_profile_version" IS NULL OR "product_time_profile_version" > 0
    ),
    CONSTRAINT "process_completions_time_basis_valid" CHECK (
        "time_basis" IS NULL OR "time_basis" IN ('per_unit', 'per_batch')
    ),
    CONSTRAINT "process_completions_standard_valid" CHECK (
        ("standard_milliseconds_per_unit" IS NULL OR "standard_milliseconds_per_unit" > 0)
        AND "setup_milliseconds" >= 0
        AND "units_per_product" > 0
    ),
    CONSTRAINT "process_completions_idempotency_nonempty" CHECK (
        LENGTH(BTRIM("idempotency_key")) > 0
    ),
    CONSTRAINT "process_completions_void_metadata_valid" CHECK (
        "voided_at" IS NULL
        OR ("voided_by_id" IS NOT NULL AND LENGTH(BTRIM(COALESCE("void_reason", ''))) > 0)
    )
);

CREATE TABLE "process_quantity_movements" (
    "id" TEXT NOT NULL,
    "completion_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "source_step_id" TEXT NOT NULL,
    "target_step_id" TEXT,
    "branch_work_order_id" TEXT,
    "type" "process_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source_sequence_group" INTEGER NOT NULL,
    "target_sequence_group" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    CONSTRAINT "process_quantity_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_movements_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "process_movements_sequence_valid" CHECK (
        "source_sequence_group" > 0
        AND ("target_sequence_group" IS NULL OR "target_sequence_group" > 0)
    ),
    CONSTRAINT "process_movements_idempotency_nonempty" CHECK (
        LENGTH(BTRIM("idempotency_key")) > 0
    )
);

CREATE TABLE "process_labor_pools" (
    "id" TEXT NOT NULL,
    "completion_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "eligible_qty" INTEGER NOT NULL,
    "claimed_qty" INTEGER NOT NULL DEFAULT 0,
    "remaining_qty" INTEGER NOT NULL,
    "status" "process_labor_pool_status" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "standard_milliseconds_per_unit" INTEGER NOT NULL,
    "setup_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "units_per_product" INTEGER NOT NULL DEFAULT 1,
    "total_standard_labor_milliseconds" BIGINT NOT NULL,
    "claimed_standard_labor_milliseconds" BIGINT NOT NULL DEFAULT 0,
    "remaining_standard_labor_milliseconds" BIGINT NOT NULL,
    "counts_for_efficiency" BOOLEAN NOT NULL DEFAULT true,
    "standard_source" TEXT NOT NULL,
    "product_time_profile_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    CONSTRAINT "process_labor_pools_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_labor_pools_quantity_valid" CHECK (
        "eligible_qty" > 0
        AND "claimed_qty" >= 0
        AND "remaining_qty" >= 0
        AND "claimed_qty" + "remaining_qty" = "eligible_qty"
    ),
    CONSTRAINT "process_labor_pools_standard_valid" CHECK (
        "standard_milliseconds_per_unit" > 0
        AND "setup_milliseconds" >= 0
        AND "units_per_product" > 0
        AND "total_standard_labor_milliseconds" > 0
        AND "claimed_standard_labor_milliseconds" >= 0
        AND "remaining_standard_labor_milliseconds" >= 0
        AND "claimed_standard_labor_milliseconds" + "remaining_standard_labor_milliseconds"
            = "total_standard_labor_milliseconds"
    ),
    CONSTRAINT "process_labor_pools_version_valid" CHECK ("version" >= 0),
    CONSTRAINT "process_labor_pools_profile_version_valid" CHECK (
        "product_time_profile_version" IS NULL OR "product_time_profile_version" > 0
    )
);

CREATE TABLE "process_labor_claims" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "standard_labor_milliseconds" BIGINT NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "process_labor_claim_status" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT NOT NULL,
    "claimed_by_id" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    "reversal_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "process_labor_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "process_labor_claims_values_valid" CHECK (
        (
            "status" = 'REVERSAL'
            AND "quantity" < 0
            AND "standard_labor_milliseconds" < 0
            AND "reversal_of_id" IS NOT NULL
        )
        OR
        (
            "status" IN ('ACTIVE', 'VOIDED')
            AND "quantity" > 0
            AND "standard_labor_milliseconds" > 0
            AND "reversal_of_id" IS NULL
        )
    ),
    CONSTRAINT "process_labor_claims_void_metadata_valid" CHECK (
        "status" <> 'VOIDED'
        OR (
            "voided_at" IS NOT NULL
            AND "voided_by_id" IS NOT NULL
            AND LENGTH(BTRIM(COALESCE("void_reason", ''))) > 0
        )
    ),
    CONSTRAINT "process_labor_claims_idempotency_nonempty" CHECK (
        LENGTH(BTRIM("idempotency_key")) > 0
    )
);

CREATE UNIQUE INDEX "work_orders_origin_completion_id_key"
ON "work_orders"("origin_completion_id");

CREATE UNIQUE INDEX "work_orders_parent_work_order_id_branch_sequence_key"
ON "work_orders"("parent_work_order_id", "branch_sequence");

CREATE INDEX "work_orders_parent_work_order_id_idx"
ON "work_orders"("parent_work_order_id");

CREATE INDEX "work_orders_root_work_order_id_idx"
ON "work_orders"("root_work_order_id");

CREATE INDEX "work_orders_branch_type_branch_status_idx"
ON "work_orders"("branch_type", "branch_status");

CREATE INDEX "work_orders_origin_step_id_idx"
ON "work_orders"("origin_step_id");

CREATE INDEX "work_orders_rejoin_step_id_idx"
ON "work_orders"("rejoin_step_id");

CREATE INDEX "work_order_process_steps_quantity_version_idx"
ON "work_order_process_steps"("quantity_version");

CREATE UNIQUE INDEX "process_completions_idempotency_key_key"
ON "process_completions"("idempotency_key");

CREATE INDEX "process_completions_work_order_id_work_date_idx"
ON "process_completions"("work_order_id", "work_date");

CREATE INDEX "process_completions_route_id_completed_at_idx"
ON "process_completions"("route_id", "completed_at");

CREATE INDEX "process_completions_step_id_completed_at_idx"
ON "process_completions"("step_id", "completed_at");

CREATE INDEX "process_completions_voided_at_idx"
ON "process_completions"("voided_at");

CREATE INDEX "process_completions_created_by_id_idx"
ON "process_completions"("created_by_id");

CREATE INDEX "process_completions_voided_by_id_idx"
ON "process_completions"("voided_by_id");

CREATE UNIQUE INDEX "process_quantity_movements_idempotency_key_key"
ON "process_quantity_movements"("idempotency_key");

CREATE INDEX "process_quantity_movements_completion_id_idx"
ON "process_quantity_movements"("completion_id");

CREATE INDEX "process_quantity_movements_work_order_id_created_at_idx"
ON "process_quantity_movements"("work_order_id", "created_at");

CREATE INDEX "process_quantity_movements_source_step_id_created_at_idx"
ON "process_quantity_movements"("source_step_id", "created_at");

CREATE INDEX "process_quantity_movements_target_step_id_created_at_idx"
ON "process_quantity_movements"("target_step_id", "created_at");

CREATE INDEX "process_quantity_movements_branch_work_order_id_idx"
ON "process_quantity_movements"("branch_work_order_id");

CREATE INDEX "process_quantity_movements_type_created_at_idx"
ON "process_quantity_movements"("type", "created_at");

CREATE INDEX "process_quantity_movements_voided_at_idx"
ON "process_quantity_movements"("voided_at");

CREATE UNIQUE INDEX "process_labor_pools_completion_id_key"
ON "process_labor_pools"("completion_id");

CREATE INDEX "process_labor_pools_work_order_id_work_date_idx"
ON "process_labor_pools"("work_order_id", "work_date");

CREATE INDEX "process_labor_pools_step_id_work_date_idx"
ON "process_labor_pools"("step_id", "work_date");

CREATE INDEX "process_labor_pools_status_work_date_idx"
ON "process_labor_pools"("status", "work_date");

CREATE INDEX "process_labor_pools_locked_at_idx"
ON "process_labor_pools"("locked_at");

CREATE UNIQUE INDEX "process_labor_claims_idempotency_key_key"
ON "process_labor_claims"("idempotency_key");

CREATE UNIQUE INDEX "process_labor_claims_reversal_of_id_key"
ON "process_labor_claims"("reversal_of_id");

CREATE INDEX "process_labor_claims_pool_id_status_idx"
ON "process_labor_claims"("pool_id", "status");

CREATE INDEX "process_labor_claims_employee_id_work_date_idx"
ON "process_labor_claims"("employee_id", "work_date");

CREATE INDEX "process_labor_claims_status_work_date_idx"
ON "process_labor_claims"("status", "work_date");

CREATE INDEX "process_labor_claims_claimed_by_id_idx"
ON "process_labor_claims"("claimed_by_id");

CREATE INDEX "process_labor_claims_voided_by_id_idx"
ON "process_labor_claims"("voided_by_id");

CREATE INDEX "process_labor_claims_voided_at_idx"
ON "process_labor_claims"("voided_at");

ALTER TABLE "work_orders"
ADD CONSTRAINT "work_orders_parent_work_order_id_fkey"
FOREIGN KEY ("parent_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "work_orders_root_work_order_id_fkey"
FOREIGN KEY ("root_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "work_orders_origin_completion_id_fkey"
FOREIGN KEY ("origin_completion_id") REFERENCES "process_completions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "work_orders_origin_step_id_fkey"
FOREIGN KEY ("origin_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "work_orders_rejoin_step_id_fkey"
FOREIGN KEY ("rejoin_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_completions"
ADD CONSTRAINT "process_completions_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_completions_route_id_fkey"
FOREIGN KEY ("route_id") REFERENCES "work_order_process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_completions_step_id_fkey"
FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_completions_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "process_completions_voided_by_id_fkey"
FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_quantity_movements"
ADD CONSTRAINT "process_movements_completion_id_fkey"
FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_movements_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_movements_source_step_id_fkey"
FOREIGN KEY ("source_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_movements_target_step_id_fkey"
FOREIGN KEY ("target_step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_movements_branch_work_order_id_fkey"
FOREIGN KEY ("branch_work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "process_labor_pools"
ADD CONSTRAINT "process_labor_pools_completion_id_fkey"
FOREIGN KEY ("completion_id") REFERENCES "process_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_pools_work_order_id_fkey"
FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_pools_step_id_fkey"
FOREIGN KEY ("step_id") REFERENCES "work_order_process_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "process_labor_claims"
ADD CONSTRAINT "process_labor_claims_pool_id_fkey"
FOREIGN KEY ("pool_id") REFERENCES "process_labor_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_claims_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_claims_claimed_by_id_fkey"
FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_claims_voided_by_id_fkey"
FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "process_labor_claims_reversal_of_id_fkey"
FOREIGN KEY ("reversal_of_id") REFERENCES "process_labor_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
