CREATE TYPE "process_completion_report_mode" AS ENUM ('SEQUENTIAL', 'ADVANCE');
CREATE TYPE "process_completion_coverage_status" AS ENUM ('PENDING', 'PARTIAL', 'COVERED', 'VOIDED');

ALTER TABLE "process_completions"
  ADD COLUMN "report_mode" "process_completion_report_mode" NOT NULL DEFAULT 'SEQUENTIAL',
  ADD COLUMN "coverage_status" "process_completion_coverage_status" NOT NULL DEFAULT 'COVERED',
  ADD COLUMN "covered_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "covered_good_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "covered_defect_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "coverage_updated_at" TIMESTAMP(3),
  ADD COLUMN "auto_assign_labor" BOOLEAN NOT NULL DEFAULT false;

UPDATE "process_completions"
SET
  "covered_qty" = "processed_qty",
  "covered_good_qty" = "good_qty",
  "covered_defect_qty" = "defect_qty",
  "coverage_updated_at" = COALESCE("updated_at", "completed_at");

ALTER TABLE "process_completions"
  ADD CONSTRAINT "process_completions_coverage_nonnegative_check"
    CHECK (
      "covered_qty" >= 0
      AND "covered_good_qty" >= 0
      AND "covered_defect_qty" >= 0
    ),
  ADD CONSTRAINT "process_completions_coverage_total_check"
    CHECK (
      "covered_qty" <= "processed_qty"
      AND "covered_good_qty" <= "good_qty"
      AND "covered_defect_qty" <= "defect_qty"
      AND "covered_qty" = "covered_good_qty" + "covered_defect_qty"
    );

CREATE INDEX "process_completions_step_id_coverage_status_completed_at_idx"
  ON "process_completions"("step_id", "coverage_status", "completed_at");

CREATE TABLE "process_completion_coverages" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "report_completion_id" TEXT NOT NULL,
  "trigger_completion_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "good_qty" INTEGER NOT NULL,
  "defect_qty" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMP(3),
  CONSTRAINT "process_completion_coverages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_completion_coverages_quantity_check" CHECK (
    "quantity" > 0
    AND "good_qty" >= 0
    AND "defect_qty" >= 0
    AND "quantity" = "good_qty" + "defect_qty"
  )
);

CREATE UNIQUE INDEX "process_completion_coverages_idempotency_key_key"
  ON "process_completion_coverages"("idempotency_key");
CREATE INDEX "process_completion_coverages_report_completion_id_created_at_idx"
  ON "process_completion_coverages"("report_completion_id", "created_at");
CREATE INDEX "process_completion_coverages_trigger_completion_id_created_at_idx"
  ON "process_completion_coverages"("trigger_completion_id", "created_at");
CREATE INDEX "process_completion_coverages_voided_at_idx"
  ON "process_completion_coverages"("voided_at");

ALTER TABLE "process_completion_coverages"
  ADD CONSTRAINT "process_completion_coverages_report_completion_id_fkey"
  FOREIGN KEY ("report_completion_id") REFERENCES "process_completions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "process_completion_coverages"
  ADD CONSTRAINT "process_completion_coverages_trigger_completion_id_fkey"
  FOREIGN KEY ("trigger_completion_id") REFERENCES "process_completions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "process_labor_claims"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- Existing open pools are converted once so the removed manual-claim screen
-- leaves no historical completed work stranded. Remaining quantity and labor
-- are shared deterministically across the recorded on-site participants.
WITH participant_rows AS (
  SELECT
    pool."id" AS pool_id,
    pool."remaining_qty" AS remaining_qty,
    pool."remaining_standard_labor_milliseconds" AS remaining_labor,
    completion."created_by_id" AS actor_id,
    participant."employee_id" AS employee_id,
    ROW_NUMBER() OVER (
      PARTITION BY pool."id"
      ORDER BY participant."position", participant."created_at", participant."id"
    ) AS participant_position,
    COUNT(*) OVER (PARTITION BY pool."id") AS participant_count
  FROM "process_labor_pools" pool
  JOIN "process_completions" completion ON completion."id" = pool."completion_id"
  JOIN "process_completion_participants" participant
    ON participant."completion_id" = completion."id"
  WHERE pool."status" IN ('OPEN', 'PARTIAL')
    AND pool."remaining_qty" > 0
    AND pool."standard_source" <> 'pending_standard'
    AND completion."voided_at" IS NULL
), quantity_allocations AS (
  SELECT
    participant_rows.*,
    (
      participant_rows.remaining_qty / participant_rows.participant_count
      + CASE
          WHEN participant_rows.participant_position
            <= participant_rows.remaining_qty % participant_rows.participant_count
          THEN 1 ELSE 0
        END
    )::INTEGER AS allocation_qty
  FROM participant_rows
), cumulative_allocations AS (
  SELECT
    quantity_allocations.*,
    SUM(quantity_allocations.allocation_qty) OVER (
      PARTITION BY quantity_allocations.pool_id
      ORDER BY quantity_allocations.participant_position
    ) AS cumulative_qty
  FROM quantity_allocations
  WHERE quantity_allocations.allocation_qty > 0
), inserted_claims AS (
  INSERT INTO "process_labor_claims" (
    "id",
    "pool_id",
    "employee_id",
    "quantity",
    "standard_labor_milliseconds",
    "work_date",
    "status",
    "source",
    "idempotency_key",
    "claimed_by_id",
    "claimed_at",
    "created_at"
  )
  SELECT
    gen_random_uuid()::text,
    allocation.pool_id,
    allocation.employee_id,
    allocation.allocation_qty,
    (
      allocation.remaining_labor * allocation.cumulative_qty::BIGINT / allocation.remaining_qty::BIGINT
      - allocation.remaining_labor * (allocation.cumulative_qty - allocation.allocation_qty)::BIGINT
        / allocation.remaining_qty::BIGINT
    ),
    pool."work_date",
    'ACTIVE',
    'completion_auto',
    'auto-backfill:' || allocation.pool_id || ':' || allocation.employee_id,
    allocation.actor_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM cumulative_allocations allocation
  JOIN "process_labor_pools" pool ON pool."id" = allocation.pool_id
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "pool_id", "quantity", "standard_labor_milliseconds"
), inserted_totals AS (
  SELECT
    "pool_id",
    SUM("quantity")::INTEGER AS assigned_qty,
    SUM("standard_labor_milliseconds") AS assigned_labor
  FROM inserted_claims
  GROUP BY "pool_id"
)
UPDATE "process_labor_pools" pool
SET
  "claimed_qty" = pool."claimed_qty" + totals.assigned_qty,
  "remaining_qty" = pool."remaining_qty" - totals.assigned_qty,
  "claimed_standard_labor_milliseconds" = pool."claimed_standard_labor_milliseconds" + totals.assigned_labor,
  "remaining_standard_labor_milliseconds" = pool."remaining_standard_labor_milliseconds" - totals.assigned_labor,
  "status" = CASE
    WHEN pool."remaining_qty" - totals.assigned_qty = 0 THEN 'EXHAUSTED'::"process_labor_pool_status"
    ELSE 'PARTIAL'::"process_labor_pool_status"
  END,
  "version" = pool."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM inserted_totals totals
WHERE pool."id" = totals.pool_id;
