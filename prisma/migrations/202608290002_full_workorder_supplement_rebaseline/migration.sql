-- Product-time insertions on an already-started but still-open work order must
-- be reported for the complete work-order target.  Older deployments could
-- mark the downstream-covered quantity as SYSTEM_COVERED, leaving the visible
-- supplemental step at 0/0 and impossible to report.  Rebaseline only records
-- that still satisfy the zero-material supplemental contract.  Existing
-- completions and labor are preserved; no completion, movement, or labor row is
-- created by this migration.

CREATE TEMP TABLE "_hm_full_workorder_supplement_rebaseline" AS
SELECT
  obligation."id" AS "obligation_id",
  coverage."id" AS "coverage_id",
  obligation."work_order_id",
  obligation."route_id",
  obligation."display_step_id",
  obligation."process_code",
  obligation."process_name",
  obligation."required_qty",
  obligation."system_covered_qty" AS "old_obligation_system_covered_qty",
  obligation."fulfillment_mode"::TEXT AS "old_obligation_fulfillment_mode",
  obligation."status"::TEXT AS "old_obligation_status",
  obligation."version" AS "old_obligation_version",
  obligation."reported_qty",
  obligation."reported_good_unit_qty",
  obligation."report_quantity_basis",
  obligation."units_per_product",
  coverage."policy" AS "old_policy",
  coverage."system_covered_qty" AS "old_coverage_system_covered_qty",
  coverage."actual_required_qty" AS "old_actual_required_qty",
  step."status" AS "old_step_status",
  step."quantity_version" AS "old_step_quantity_version",
  route."version" AS "old_route_version",
  CASE
    WHEN obligation."reported_qty" >= obligation."required_qty"
      AND (
        obligation."report_quantity_basis" <> 'action'
        OR obligation."reported_good_unit_qty" >= obligation."required_qty" * obligation."units_per_product"
      )
    THEN TRUE
    ELSE FALSE
  END AS "fulfilled_after"
FROM "process_supplement_obligations" obligation
JOIN "process_supplement_coverages" coverage
  ON coverage."obligation_id" = obligation."id"
JOIN "work_order_process_steps" step
  ON step."id" = obligation."display_step_id"
JOIN "work_order_process_routes" route
  ON route."id" = obligation."route_id"
JOIN "work_orders" work_order
  ON work_order."id" = obligation."work_order_id"
JOIN "product_time_deployment_routes" deployment_route
  ON deployment_route."id" = obligation."deployment_route_id"
JOIN "product_time_deployments" deployment
  ON deployment."id" = deployment_route."deployment_id"
WHERE coverage."policy" IN ('AUTO_BY_PROGRESS', 'FUTURE_ONLY', 'RECALL_REWORK')
  AND obligation."required_qty" > 0
  AND coverage."route_target_qty" = obligation."required_qty"
  AND obligation."reported_qty" BETWEEN 0 AND obligation."required_qty"
  AND obligation."reported_good_unit_qty" BETWEEN 0 AND obligation."required_qty" * obligation."units_per_product"
  AND obligation."release_policy" = 'NONE'
  AND obligation."deployment_route_id" IS NOT NULL
  AND deployment."status" = 'ACTIVE'
  AND deployment_route."status" = 'SUCCEEDED'
  AND route."status" = 'in_progress'
  AND route."completed_at" IS NULL
  AND work_order."completed_at" IS NULL
  AND work_order."deleted_at" IS NULL
  AND work_order."branch_type" IS NULL
  AND step."execution_mode" = 'SUPPLEMENTAL_OBLIGATION'
  AND step."retired_at" IS NULL
  AND step."input_qty" = 0
  AND step."processed_qty" = 0
  AND step."good_output_qty" = 0
  AND step."defect_output_qty" = 0
  AND step."released_good_qty" = 0
  AND NOT EXISTS (
    SELECT 1
    FROM "process_quantity_movements" movement
    WHERE movement."voided_at" IS NULL
      AND (
        movement."source_step_id" = obligation."display_step_id"
        OR movement."target_step_id" = obligation."display_step_id"
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "process_completions" completion
    WHERE completion."step_id" = obligation."display_step_id"
      AND completion."voided_at" IS NULL
      AND completion."supplement_obligation_id" IS DISTINCT FROM obligation."id"
  )
  AND obligation."reported_qty" = COALESCE((
    SELECT SUM(completion."processed_qty")::INTEGER
    FROM "process_completions" completion
    WHERE completion."supplement_obligation_id" = obligation."id"
      AND completion."voided_at" IS NULL
  ), 0)
  AND obligation."reported_unit_qty" = COALESCE((
    SELECT SUM(completion."reported_unit_qty")::INTEGER
    FROM "process_completions" completion
    WHERE completion."supplement_obligation_id" = obligation."id"
      AND completion."voided_at" IS NULL
  ), 0)
  AND obligation."reported_good_unit_qty" = COALESCE((
    SELECT SUM(completion."reported_good_unit_qty")::INTEGER
    FROM "process_completions" completion
    WHERE completion."supplement_obligation_id" = obligation."id"
      AND completion."voided_at" IS NULL
  ), 0)
  AND obligation."reported_defect_unit_qty" = COALESCE((
    SELECT SUM(completion."reported_defect_unit_qty")::INTEGER
    FROM "process_completions" completion
    WHERE completion."supplement_obligation_id" = obligation."id"
      AND completion."voided_at" IS NULL
  ), 0);

CREATE UNIQUE INDEX "_hm_full_workorder_supplement_rebaseline_obligation"
  ON "_hm_full_workorder_supplement_rebaseline"("obligation_id");

-- Lock the exact business rows selected above before changing the projection.
SELECT obligation."id"
FROM "process_supplement_obligations" obligation
JOIN "_hm_full_workorder_supplement_rebaseline" candidate
  ON candidate."obligation_id" = obligation."id"
FOR UPDATE;

UPDATE "process_supplement_obligations" obligation
SET
  "system_covered_qty" = 0,
  "fulfillment_mode" = 'ACTUAL',
  "status" = CASE
    WHEN candidate."fulfilled_after" THEN 'FULFILLED'::"process_supplement_obligation_status"
    ELSE 'ACTIVE'::"process_supplement_obligation_status"
  END,
  "fulfilled_at" = CASE
    WHEN candidate."fulfilled_after"
      THEN COALESCE(obligation."last_reported_at", obligation."fulfilled_at", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  "version" = obligation."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_full_workorder_supplement_rebaseline" candidate
WHERE obligation."id" = candidate."obligation_id"
  AND obligation."version" = candidate."old_obligation_version";

UPDATE "process_supplement_coverages" coverage
SET
  "policy" = 'FULL_WORK_ORDER_REQUIRED',
  "fulfillment_mode" = 'ACTUAL',
  "system_covered_qty" = 0,
  "actual_required_qty" = candidate."required_qty",
  "evidence" = coverage."evidence" || jsonb_build_object(
    'fullWorkOrderRebaseline',
    jsonb_build_object(
      'source', 'v1.34.74_data_migration',
      'reason', 'open_work_order_inserted_process_requires_full_actual_reporting',
      'rebaselinedAt', CURRENT_TIMESTAMP,
      'oldPolicy', candidate."old_policy",
      'oldFulfillmentMode', candidate."old_obligation_fulfillment_mode",
      'oldSystemCoveredQty', candidate."old_obligation_system_covered_qty",
      'oldActualRequiredQty', candidate."old_actual_required_qty",
      'requiredQty', candidate."required_qty",
      'completionCountDelta', 0,
      'quantityMovementCountDelta', 0,
      'completedQtyDelta', 0,
      'laborRecordCountDelta', 0
    )
  )
FROM "_hm_full_workorder_supplement_rebaseline" candidate
WHERE coverage."id" = candidate."coverage_id";

UPDATE "work_order_process_steps" step
SET
  "status" = CASE WHEN candidate."fulfilled_after" THEN 'completed' ELSE 'current' END,
  "started_at" = CASE
    WHEN candidate."fulfilled_after" THEN step."started_at"
    ELSE COALESCE(step."started_at", CURRENT_TIMESTAMP)
  END,
  "completed_at" = CASE
    WHEN candidate."fulfilled_after" THEN COALESCE(step."completed_at", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  "completed_by_id" = CASE WHEN candidate."fulfilled_after" THEN step."completed_by_id" ELSE NULL END,
  "quantity_version" = step."quantity_version" + 1,
  "remark" = CONCAT_WS(
    '；',
    NULLIF(step."remark", ''),
    'V1.34.74 已按整单全套重置为实际补报义务；不改变物料流转、不重复释放后序数量'
  ),
  "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_full_workorder_supplement_rebaseline" candidate
WHERE step."id" = candidate."display_step_id"
  AND step."quantity_version" = candidate."old_step_quantity_version";

UPDATE "work_order_process_routes" route
SET
  "version" = route."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE route."id" IN (
  SELECT DISTINCT candidate."route_id"
  FROM "_hm_full_workorder_supplement_rebaseline" candidate
);

-- Mutable planning projections follow the new route version.  Historical
-- completed/carry-over/cancelled tasks remain frozen and no new plan or labor
-- assignment is fabricated by the migration.
UPDATE "daily_process_tasks" task
SET
  "route_version" = route."version",
  "available_qty" = 0,
  "status" = CASE
    WHEN candidate."fulfilled_after" THEN 'COMPLETED'::"daily_process_task_status"
    WHEN candidate."reported_qty" > 0 THEN 'IN_PROGRESS'::"daily_process_task_status"
    ELSE 'WAITING_UPSTREAM'::"daily_process_task_status"
  END,
  "version" = task."version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
FROM "_hm_full_workorder_supplement_rebaseline" candidate
JOIN "work_order_process_routes" route ON route."id" = candidate."route_id"
WHERE task."step_id" = candidate."display_step_id"
  AND task."status" NOT IN (
    'COMPLETED'::"daily_process_task_status",
    'CARRIED_OVER'::"daily_process_task_status",
    'CANCELLED'::"daily_process_task_status"
  );

INSERT INTO "process_route_activities" (
  "id", "route_id", "step_id", "action", "content", "detail", "actor_id", "created_at"
)
SELECT
  gen_random_uuid()::TEXT,
  candidate."route_id",
  candidate."display_step_id",
  'rebaseline_supplement_full_workorder',
  candidate."process_name" || '已改为整单全套实际补报；未生成报工、工时或物料流转',
  jsonb_build_object(
    'obligationId', candidate."obligation_id",
    'processCode', candidate."process_code",
    'processName', candidate."process_name",
    'requiredQty', candidate."required_qty",
    'reportedQty', candidate."reported_qty",
    'remainingQty', GREATEST(0, candidate."required_qty" - candidate."reported_qty"),
    'oldPolicy', candidate."old_policy",
    'newPolicy', 'FULL_WORK_ORDER_REQUIRED',
    'oldSystemCoveredQty', candidate."old_obligation_system_covered_qty",
    'newSystemCoveredQty', 0,
    'oldRouteVersion', candidate."old_route_version",
    'newRouteVersion', route."version",
    'completionCountDelta', 0,
    'quantityMovementCountDelta', 0,
    'completedQtyDelta', 0,
    'laborRecordCountDelta', 0
  ),
  NULL,
  CURRENT_TIMESTAMP
FROM "_hm_full_workorder_supplement_rebaseline" candidate
JOIN "work_order_process_routes" route ON route."id" = candidate."route_id";

INSERT INTO "operation_logs" (
  "id", "user_id", "action", "target_type", "target_id", "detail", "created_at"
)
SELECT
  gen_random_uuid()::TEXT,
  NULL,
  'rebaseline_supplement_full_workorder',
  'ProcessSupplementObligation',
  candidate."obligation_id",
  jsonb_build_object(
    'workOrderId', candidate."work_order_id",
    'routeId', candidate."route_id",
    'displayStepId', candidate."display_step_id",
    'processCode', candidate."process_code",
    'processName', candidate."process_name",
    'requiredQty', candidate."required_qty",
    'reportedQty', candidate."reported_qty",
    'oldPolicy', candidate."old_policy",
    'newPolicy', 'FULL_WORK_ORDER_REQUIRED',
    'oldFulfillmentMode', candidate."old_obligation_fulfillment_mode",
    'newFulfillmentMode', 'ACTUAL',
    'oldSystemCoveredQty', candidate."old_obligation_system_covered_qty",
    'newSystemCoveredQty', 0,
    'completionCountDelta', 0,
    'quantityMovementCountDelta', 0,
    'completedQtyDelta', 0,
    'laborRecordCountDelta', 0,
    'source', 'v1.34.74_data_migration'
  ),
  CURRENT_TIMESTAMP
FROM "_hm_full_workorder_supplement_rebaseline" candidate;

DROP TABLE "_hm_full_workorder_supplement_rebaseline";
